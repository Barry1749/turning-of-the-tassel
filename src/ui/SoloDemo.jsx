import { useEffect, useRef, useState } from 'react';
import { createLandmarkers } from '../vision';
import { computeCapTransform } from '../headPose';
import { createGestureTracker } from '../gesture';
import { TasselController } from '../tassel';
import { drawScene } from '../drawCap';
import { celebrate, initAudio } from '../effects';

// Standalone AR sandbox (no backend, no video call): your own hand turns your own tassel.
// Handy for tuning the cap placement, pinch sensitivity, and physics.
export default function SoloDemo({ onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const loop = useRef({});
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [hud, setHud] = useState({ face: false, hand: false, pinch: false, state: 'idle' });
  const [graduated, setGraduated] = useState(false);

  async function handleStart() {
    try {
      setStatus('starting');
      initAudio();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      const { faceLandmarker, handLandmarker } = await createLandmarkers();
      const s = loop.current;
      s.faceLandmarker = faceLandmarker;
      s.handLandmarker = handLandmarker;
      s.gesture = createGestureTracker();
      s.tassel = new TasselController();
      s.running = true;
      s.lastTs = 0;
      s.lastNow = 0;
      s.frame = 0;
      setStatus('running');
      requestAnimationFrame(tick);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
      setStatus('error');
    }
  }

  function tick(now) {
    const s = loop.current;
    if (!s.running) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && video.readyState >= 2 && s.faceLandmarker && s.handLandmarker) {
      const ts = Math.max((s.lastTs || 0) + 1, Math.floor(now));
      s.lastTs = ts;
      let faceRes;
      let handRes;
      try { faceRes = s.faceLandmarker.detectForVideo(video, ts); } catch (e) { /* */ }
      try { handRes = s.handLandmarker.detectForVideo(video, ts); } catch (e) { /* */ }

      const faceLm = faceRes?.faceLandmarks?.[0] || null;
      const handLm = handRes?.landmarks?.[0] || null;
      const cap = computeCapTransform(faceLm);
      const g = s.gesture.update(handLm);

      const dt = Math.min(0.05, s.lastNow ? (now - s.lastNow) / 1000 : 0.016);
      s.lastNow = now;
      const ev = s.tassel.update(g, dt);
      if (ev === 'commit') {
        celebrate();
        setGraduated(true);
        clearTimeout(s.bannerTimer);
        s.bannerTimer = setTimeout(() => setGraduated(false), 3500);
      }

      drawScene(canvas, video, cap, s.tassel.angle, g);

      if (s.frame++ % 6 === 0) {
        setHud({ face: !!faceLm, hand: !!handLm, pinch: !!g?.pinching, state: s.tassel.state });
      }
    }
    requestAnimationFrame(tick);
  }

  useEffect(() => () => {
    const s = loop.current;
    s.running = false;
    clearTimeout(s.bannerTimer);
    const v = videoRef.current;
    if (v?.srcObject) v.srcObject.getTracks().forEach((t) => t.stop());
  }, []);

  return (
    <div className="stage">
      <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
      <canvas ref={canvasRef} className="view" />

      {status !== 'running' && (
        <div className="overlay">
          <h1>🎓 Solo AR demo</h1>
          <p>Your own hand turns your own tassel.</p>
          {status === 'error' ? (
            <p className="error">Could not start: {error}</p>
          ) : (
            <p className="hint">Allow camera access, then pinch thumb + index to grab the tassel, sweep right → left, and release on the left.</p>
          )}
          <button onClick={handleStart} disabled={status === 'starting'}>
            {status === 'starting' ? 'Starting…' : 'Start camera'}
          </button>
          <button className="link" onClick={onBack}>← Back</button>
        </div>
      )}

      {status === 'running' && (
        <>
          <div className="hud">
            <span className={hud.face ? 'ok' : 'no'}>face</span>
            <span className={hud.hand ? 'ok' : 'no'}>hand</span>
            <span className={hud.pinch ? 'ok' : 'no'}>pinch</span>
            <span className="state">{hud.state}</span>
          </div>
          <div className="tip">Pinch → sweep right to left → release</div>
          <div className="controls">
            <button onClick={() => loop.current.tassel?.forceTurn()}>Turn tassel (manual)</button>
            <button onClick={() => { loop.current.tassel?.reset(); setGraduated(false); }}>Reset</button>
            <button onClick={onBack}>← Back</button>
          </div>
        </>
      )}

      {graduated && <div className="banner">🎓 Graduated! Congratulations! 🎉</div>}
    </div>
  );
}
