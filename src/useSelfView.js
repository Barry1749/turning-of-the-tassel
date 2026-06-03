// Manages the local camera. Shows the camera video IMMEDIATELY (as a captured canvas
// stream) and loads the MediaPipe models in parallel, so a slow/failed model load never
// blocks the video. For the host the tassel "controller" is the single source of truth:
// the hand gesture (when enabled), the manual-turn button, and reset all drive it, and
// its angle is streamed every frame so the spotlighted student's tassel follows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createLandmarkers } from './vision';
import { computeCapTransform } from './headPose';
import { createGestureTracker } from './gesture';
import { TasselController, REST_ANGLE } from './tassel';
import { drawScene } from './drawCap';

async function getCamera() {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true });
  } catch (e) {
    // No mic / mic blocked shouldn't kill the camera — retry video only.
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }
}

export function useSelfView({ active, isHost, gestureEnabled = true, turnKey, getDrawAngle, onTassel, onCommit }) {
  const [stream, setStream] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | starting | ready | error
  const [error, setError] = useState('');
  const [arReady, setArReady] = useState(false);
  const [arError, setArError] = useState('');
  const [faceOk, setFaceOk] = useState(false);
  const [handOk, setHandOk] = useState(false);
  const [pinching, setPinching] = useState(false);

  const ref = useRef({});
  const cb = useRef({});
  cb.current = { getDrawAngle, onTassel, onCommit, turnKey, gestureEnabled };

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

      Object.assign(R, {
        media,
        video,
        canvas,
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

      const out = canvas.captureStream(30);
      const audio = media.getAudioTracks()[0];
      if (audio) out.addTrack(audio);
      setStream(out);
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
      if (video && video.readyState >= 2) {
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
            cap = computeCapTransform(faceRes?.faceLandmarks?.[0] || null, faceRes?.facialTransformationMatrixes?.[0]?.data || null);
          }
          drawAngle = cb.current.getDrawAngle ? cb.current.getDrawAngle() : REST_ANGLE;
        }

        S.lastNow = now;
        drawScene(canvas, video, cap, drawAngle, gestureForMarker);

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

  return { stream, status, error, arReady, arError, faceOk, handOk, pinching, resetGesture, forceTurnGesture };
}
