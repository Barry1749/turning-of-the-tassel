import { useEffect, useRef } from 'react';
import { renderNameCard } from '../drawCap';
import { REST_ANGLE } from '../tassel';

// One participant. If a MediaStream is present (self-composited or remote Daily video),
// show it; otherwise draw a name-card placeholder whose tassel reflects the live angle.
export default function ParticipantTile({
  stream,
  name,
  flag = '',
  role,
  isSelf,
  isCurrent,
  turned,
  getAngle,
  big,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const getAngleRef = useRef(getAngle);
  getAngleRef.current = getAngle;

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (stream) return undefined;
    let raf;
    const loop = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const a = getAngleRef.current ? getAngleRef.current() : REST_ANGLE;
        renderNameCard(canvas, { name, flag, angle: a, turned });
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [stream, name, flag, turned]);

  const isProf = role === 'host' || role === 'professor';

  return (
    <div className={`tile ${isCurrent ? 'current' : ''} ${big ? 'big' : ''}`}>
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted={isSelf} />
      ) : (
        <canvas ref={canvasRef} />
      )}
      <div className="tile-cap">
        {flag && <span className="flag">{flag}</span>} {name}
        {isProf && <span className="prof-badge">Prof</span>}
        {turned && <span className="grad-badge">🎓</span>}
      </div>
    </div>
  );
}
