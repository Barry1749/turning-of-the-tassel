// Manages the local camera: runs face tracking (and hand tracking for the host),
// composites the mortarboard onto the mirrored camera frame in an offscreen canvas,
// and exposes that canvas as a MediaStream (camera + cap baked in) for display and
// for publishing to Daily. For the host, it also maps the grab->sweep->release gesture
// to a tassel angle and reports it via onTassel / onCommit.
import { useEffect, useRef, useState } from 'react';
import { createLandmarkers } from './vision';
import { computeCapTransform } from './headPose';
import { createGestureTracker } from './gesture';
import { TasselController, REST_ANGLE } from './tassel';
import { drawScene } from './drawCap';

export function useSelfView({ active, isHost, getDrawAngle, onTassel, onCommit }) {
  const [stream, setStream] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | starting | ready | error
  const [error, setError] = useState('');
  const [faceOk, setFaceOk] = useState(false);
  const [handOk, setHandOk] = useState(false);

  const ref = useRef({});
  const cb = useRef({});
  cb.current = { getDrawAngle, onTassel, onCommit };

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const R = ref.current;

    async function start() {
      try {
        setStatus('starting');
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: true,
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = document.createElement('video');
        video.srcObject = media;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;

        const { faceLandmarker, handLandmarker } = await createLandmarkers();
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        Object.assign(R, {
          media,
          video,
          canvas,
          faceLandmarker,
          handLandmarker,
          gesture: createGestureTracker(),
          controller: new TasselController(),
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
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setStatus('error');
        }
      }
    }

    function loop(now) {
      const S = ref.current;
      if (!S.running) return;
      const { video, canvas, faceLandmarker, handLandmarker } = S;
      if (video && video.readyState >= 2) {
        const ts = Math.max((S.lastTs || 0) + 1, Math.floor(now));
        S.lastTs = ts;

        let faceRes;
        try {
          faceRes = faceLandmarker.detectForVideo(video, ts);
        } catch {
          /* transient */
        }
        const faceLm = faceRes?.faceLandmarks?.[0] || null;
        const cap = computeCapTransform(faceLm);

        let hOk = false;
        if (isHost && handLandmarker) {
          let handRes;
          try {
            handRes = handLandmarker.detectForVideo(video, ts);
          } catch {
            /* transient */
          }
          const handLm = handRes?.landmarks?.[0] || null;
          hOk = !!handLm;
          const g = S.gesture.update(handLm);
          const dt = Math.min(0.05, S.lastNow ? (now - S.lastNow) / 1000 : 0.016);
          const ev = S.controller.update(g, dt);
          if (!S.lastSent || now - S.lastSent > 40) {
            cb.current.onTassel?.(S.controller.angle, !!(g.present && g.pinching));
            S.lastSent = now;
          }
          if (ev === 'commit') cb.current.onCommit?.();
        }
        S.lastNow = now;

        const angle = cb.current.getDrawAngle ? cb.current.getDrawAngle() : REST_ANGLE;
        drawScene(canvas, video, cap, angle, null);

        S.frame += 1;
        if (S.frame % 10 === 0) {
          setFaceOk(!!faceLm);
          setHandOk(hOk);
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
    };
  }, [active, isHost]);

  return { stream, status, error, faceOk, handOk };
}
