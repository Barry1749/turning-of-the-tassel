import { useEffect, useRef, useState } from 'react';
import { renderNameCard } from '../drawCap';
import { REST_ANGLE } from '../tassel';

// One participant. If a MediaStream is present (self-composited or remote video),
// show it; otherwise draw a name-card placeholder whose tassel reflects the live angle.
export default function ParticipantTile({
  stream,
  selfCanvas,
  name,
  flag = '',
  role,
  isSelf,
  isCurrent,
  turned,
  degree,
  getAngle,
  big,
  onPin,
  pinned,
  spotlighted,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // The owner's own tile mounts the self-view's composite <canvas> directly (see useSelfView): a
  // <canvas> never gets iOS's "main content" play/pause overlay, unlike a <video>. display:contents
  // on the host so the canvas sizes to the .tile (via the .tile canvas rule) without an extra box.
  const selfHostRef = (el) => {
    if (el && selfCanvas && selfCanvas.parentNode !== el) el.appendChild(selfCanvas);
  };
  const getAngleRef = useRef(getAngle);
  getAngleRef.current = getAngle;
  const [needsUnmute, setNeedsUnmute] = useState(false);

  // Attach the stream and start playback. Remote tiles carry audio, so browsers block
  // autoplay unless the page has a user gesture — and students auto-join from a
  // personalized link without ever clicking, so they have none. When play() is blocked,
  // fall back to MUTED playback (always allowed) so the face is still visible, and show a
  // one-tap control to turn the sound on. (Self is always muted to avoid echo.)
  useEffect(() => {
    const v = videoRef.current;
    if (!stream || !v) return undefined;
    v.srcObject = stream;
    v.muted = isSelf;
    let cancelled = false;
    // These are live streams — they should never sit paused. iOS can still surface a system pause
    // control on a large "main-content" video (we hide it / block its taps via CSS, but as a final
    // safety net): if anything pauses us, resume at once so the view can't be frozen.
    const onPause = () => { if (!cancelled) v.play().catch(() => {}); };
    v.addEventListener('pause', onPause);
    (async () => {
      try {
        await v.play();
        if (!cancelled) setNeedsUnmute(false);
      } catch {
        if (cancelled) return;
        v.muted = true;
        setNeedsUnmute(!isSelf);
        try {
          await v.play();
        } catch {
          /* a later user gesture (the tap-for-sound button) will retry */
        }
      }
    })();
    return () => {
      cancelled = true;
      v.removeEventListener('pause', onPause);
    };
  }, [stream, isSelf]);

  useEffect(() => {
    if (stream) return undefined;
    let raf;
    // A name card's picture only changes when the tassel ANGLE moves — everything else (name, flag,
    // turned, degree) re-runs this effect through the deps below. Re-rendering the full 3D cap every
    // frame for a card that's just sitting at rest is pure waste, and a gallery can hold many of them
    // (each one was a full WebGL cap render/frame through the shared card renderer). So render only
    // when the angle changed, plus a short "settle" tail afterwards so the soft tassel still comes to
    // rest before we stop. Idle cards then cost ~nothing; the canvas simply keeps its last frame.
    let lastAngle = null;
    let settle = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const a = getAngleRef.current ? getAngleRef.current() : REST_ANGLE;
        if (lastAngle === null || Math.abs(a - lastAngle) > 1e-4) {
          lastAngle = a;
          settle = 18; // ~0.3s @60fps: keep drawing so the pendulum settles after the angle stops
        }
        if (settle > 0) {
          renderNameCard(canvas, { name, flag, angle: a, turned, degree });
          settle--;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [stream, name, flag, turned, degree]);

  const enableAudio = () => {
    const v = videoRef.current;
    if (v) {
      v.muted = false;
      v.play().catch(() => {});
    }
    setNeedsUnmute(false);
  };

  const isProf = role === 'host' || role === 'professor';

  return (
    <div className={`tile ${isCurrent ? 'current' : ''} ${big ? 'big' : ''}`}>
      {isSelf && selfCanvas ? (
        <div style={{ display: 'contents' }} ref={selfHostRef} />
      ) : stream ? (
        <video ref={videoRef} autoPlay playsInline />
      ) : (
        <canvas ref={canvasRef} />
      )}
      {/* Pin-to-fill (Google-Meet style, local to this viewer): the ⤢ button is the ONLY way to
          pin, so a stray tap on a tile never resizes it. A host "spotlight for everyone" shows a
          static badge here instead — local pinning is disabled while that's in force. */}
      {spotlighted ? (
        <span className="pin-btn spotlighted" title="Spotlighted by the host — shown on every screen">★ Spotlight</span>
      ) : onPin ? (
        <button
          type="button"
          className={`pin-btn ${pinned ? 'pinned' : ''}`}
          onClick={onPin}
          title={pinned ? 'Unpin — back to the grid' : `Pin ${name} to fill the screen`}
        >
          {pinned ? '✕ Unpin' : '⤢'}
        </button>
      ) : null}
      {needsUnmute && (
        <button type="button" className="unmute-btn" onClick={enableAudio}>
          🔇 Tap for sound
        </button>
      )}
      <div className="tile-cap">
        {flag && <span className="flag">{flag}</span>} {name}
        {isProf && <span className="prof-badge">Prof</span>}
        {turned && <span className="grad-badge">🎓</span>}
      </div>
    </div>
  );
}
