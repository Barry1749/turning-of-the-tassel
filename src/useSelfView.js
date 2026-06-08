// Manages the local camera. Shows the camera video IMMEDIATELY (as a captured canvas
// stream) and loads the MediaPipe models in parallel, so a slow/failed model load never
// blocks the video. We expose TWO video streams: `stream` is the mirrored selfie (shown on
// the owner's own tile) and `publishStream` is the same composite un-mirrored (broadcast to
// peers, so others see the real, non-mirrored image). For the host the tassel "controller"
// is the single source of truth:
// the hand gesture (when enabled), the manual-turn button, and reset all drive it, and
// its angle is streamed every frame so the spotlighted student's tassel follows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLandmarkers } from './vision';
import { computeCapTransform } from './headPose';
import { createGestureTracker } from './gesture';
import { TasselController, REST_ANGLE } from './tassel';
import { drawScene, drawFlippedX, drawCameraOff } from './drawCap';

async function getCamera() {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true });
  } catch (e) {
    // No mic / mic blocked shouldn't kill the camera — retry video only.
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }
}

export function useSelfView({ active, isHost, gestureEnabled = true, turnKey, getDrawAngle, onTassel, onCommit, name = '' }) {
  const [stream, setStream] = useState(null); // mirrored composite — the owner's own tile
  const [publishStream, setPublishStream] = useState(null); // un-mirrored composite — sent to peers
  const [status, setStatus] = useState('idle'); // idle | starting | ready | error
  const [error, setError] = useState('');
  const [arReady, setArReady] = useState(false);
  const [arError, setArError] = useState('');
  const [faceOk, setFaceOk] = useState(false);
  const [handOk, setHandOk] = useState(false);
  const [pinching, setPinching] = useState(false);
  const [camOn, setCamOn] = useState(true); // Meet-style camera toggle
  const [micOn, setMicOn] = useState(true); // Meet-style mic toggle
  const [hasMic, setHasMic] = useState(false); // false until we confirm an audio track exists

  const ref = useRef({});
  const cb = useRef({});
  cb.current = { getDrawAngle, onTassel, onCommit, turnKey, gestureEnabled, camOn, name };

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const R = ref.current;

    async function start() {
      // 1) Camera first — show the video ASAP, independent of model loading.
      let media;
      try {
        setStatus('starting');
        media = await getCamera();
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setStatus('error');
        }
        return;
      }
      if (cancelled) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = document.createElement('video');
      video.srcObject = media;
      video.muted = true;
      video.playsInline = true;
      try {
        await video.play();
      } catch {
        /* autoplay quirk; the rAF loop still draws once frames arrive */
      }

      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;

      // Holds the un-mirrored composite (canvas flipped back each frame). Captured separately
      // and published to peers so others see the real image while we keep our mirrored selfie.
      const pubCanvas = document.createElement('canvas');
      pubCanvas.width = 1280;
      pubCanvas.height = 720;

      Object.assign(R, {
        media,
        video,
        canvas,
        pubCanvas,
        faceLandmarker: null,
        handLandmarker: null,
        gesture: createGestureTracker(),
        controller: new TasselController(),
        turnKey: cb.current.turnKey,
        lastTs: 0,
        lastNow: 0,
        lastSent: 0,
        frame: 0,
        running: true,
      });

      const out = canvas.captureStream(30); // mirrored — the owner's own self-view tile
      const audio = media.getAudioTracks()[0];
      if (audio) out.addTrack(audio);
      setStream(out);

      const pubOut = pubCanvas.captureStream(30); // un-mirrored — the feed broadcast to peers
      if (audio) pubOut.addTrack(audio); // a track can belong to both streams; audio is unflipped
      setPublishStream(pubOut);

      // Drive the mic toggle off the real track: enabled=false sends silence to peers (Meet-style
      // mute). With no mic granted there's nothing to toggle, so report it off + unavailable.
      setHasMic(!!audio);
      setMicOn(!!audio);

      setStatus('ready');
      requestAnimationFrame(loop);

      // 2) Models in parallel — the cap + gesture light up once these resolve.
      try {
        const lm = await createLandmarkers();
        if (cancelled) return;
        R.faceLandmarker = lm.faceLandmarker;
        R.handLandmarker = lm.handLandmarker;
        setArReady(true);
      } catch (e) {
        if (!cancelled) setArError(e?.message || String(e));
      }
    }

    function loop(now) {
      const S = ref.current;
      if (!S.running) return;
      const { video, canvas } = S;
      if (!cb.current.camOn) {
        // Camera off: keep feeding the SAME captured canvas track, but paint a placeholder
        // (avatar + "Camera off") onto it — the way Meet shows your tile when video is off, with
        // no track teardown/republish. Draw it on BOTH canvases directly (not via drawFlippedX)
        // so the label reads the right way round on the published, un-mirrored feed too.
        drawCameraOff(canvas, cb.current.name);
        if (S.pubCanvas) drawCameraOff(S.pubCanvas, cb.current.name);
        if (S.frame++ % 8 === 0) {
          setFaceOk(false);
          setHandOk(false);
          setPinching(false);
        }
      } else if (video && video.readyState >= 2) {
        const ts = Math.max((S.lastTs || 0) + 1, Math.floor(now));
        S.lastTs = ts;

        let cap = null;
        const gestureForMarker = null; // no overlay on the professor's own scene
        let drawAngle = REST_ANGLE;
        let hOk = false;
        let pinch = false;

        if (isHost && S.controller) {
          // reset the gesture when the spotlighted student changes
          if (S.turnKey !== cb.current.turnKey) {
            S.controller.reset();
            S.turnKey = cb.current.turnKey;
          }
          let g = null;
          if (S.handLandmarker) {
            let handRes;
            try {
              handRes = S.handLandmarker.detectForVideo(video, ts);
            } catch {
              /* transient */
            }
            const handLm = handRes?.landmarks?.[0] || null;
            hOk = !!handLm;
            // hand drives the controller only when the gesture is enabled
            g = cb.current.gestureEnabled ? S.gesture.update(handLm) : null;
          }
          pinch = !!(g && g.present && g.pinching);
          // The professor wears no cap, so nothing is drawn on their own view; the
          // controller's angle is still streamed so the STUDENT's tassel follows.
          const dt = Math.min(0.05, S.lastNow ? (now - S.lastNow) / 1000 : 0.016);
          const ev = S.controller.update(g, dt);
          if (!S.lastSent || now - S.lastSent > 40) {
            cb.current.onTassel?.(S.controller.angle, pinch);
            S.lastSent = now;
          }
          if (ev === 'commit') cb.current.onCommit?.();
        } else {
          // Students wear the cap; the tassel follows the incoming (streamed) angle.
          if (S.faceLandmarker) {
            let faceRes;
            try {
              faceRes = S.faceLandmarker.detectForVideo(video, ts);
            } catch {
              /* transient */
            }
            cap = computeCapTransform(faceRes?.faceLandmarks?.[0] || null, faceRes?.facialTransformationMatrixes?.[0]?.data || null, video.videoWidth, video.videoHeight);
          }
          drawAngle = cb.current.getDrawAngle ? cb.current.getDrawAngle() : REST_ANGLE;
        }

        S.lastNow = now;
        drawScene(canvas, video, cap, drawAngle, gestureForMarker);
        if (S.pubCanvas) drawFlippedX(S.pubCanvas, canvas); // un-mirror for the published feed

        S.frame += 1;
        if (S.frame % 8 === 0) {
          setFaceOk(isHost ? true : !!cap);
          setHandOk(hOk);
          setPinching(pinch);
        }
      }
      requestAnimationFrame(loop);
    }

    start();
    return () => {
      cancelled = true;
      const S = ref.current;
      S.running = false;
      S.media?.getTracks().forEach((t) => t.stop());
      setStream(null);
      setPublishStream(null);
      setStatus('idle');
      setArReady(false);
      setArError('');
    };
  }, [active, isHost]);

  const resetGesture = useCallback(() => {
    ref.current.controller?.reset();
  }, []);
  const forceTurnGesture = useCallback(() => {
    ref.current.controller?.forceTurn();
  }, []);

  // Mic: flip the audio track's enabled flag (peers hear silence while off).
  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      const next = !on;
      const track = ref.current.media?.getAudioTracks?.()[0];
      if (track) track.enabled = next;
      return next;
    });
  }, []);
  // Camera: the loop reads cb.current.camOn next frame and swaps in the placeholder. Also pause
  // the source capture (enabled=false) so the camera pipeline idles; the placeholder covers the
  // (now black) frames either way, and the published canvas track is untouched (no republish).
  const toggleCam = useCallback(() => {
    setCamOn((on) => {
      const next = !on;
      const track = ref.current.media?.getVideoTracks?.()[0];
      if (track) track.enabled = next;
      return next;
    });
  }, []);

  return { stream, publishStream, status, error, arReady, arError, faceOk, handOk, pinching, resetGesture, forceTurnGesture, camOn, micOn, hasMic, toggleCam, toggleMic };
}
