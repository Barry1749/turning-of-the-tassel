// Big 3-2-1 overlay, driven by the server-authoritative countdown.
export default function Countdown({ n }) {
  if (n == null) return null;
  return (
    <div className="countdown">
      <span key={n}>{n > 0 ? n : '🎉'}</span>
    </div>
  );
}
