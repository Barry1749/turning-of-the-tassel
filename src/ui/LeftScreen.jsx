// Shown only after someone clicks "Leave" (or backs out of the solo demo). There is no
// name/role picker anywhere in the app: the Master of Ceremony decides who joins and sends
// each person a personal link, so this is just a calm exit screen with a way back in.
// "Rejoin" reloads the page, which re-resolves the same role from the URL (bare URL → MC,
// a personal link → that named student / professor / guest).
export default function LeftScreen({ onSolo }) {
  return (
    <div className="join">
      <div className="join-card">
        <h1>🎓 Turning of the Tassel</h1>
        <p className="sub">You've left the ceremony.</p>

        <button type="button" className="primary" onClick={() => location.reload()}>
          Rejoin
        </button>
        <button type="button" className="link" onClick={onSolo}>Try the AR cap solo (no room) →</button>

        <p className="note">
          Joining is by invitation — the host adds you to the program and sends a personal
          link that opens already named and joins automatically.
        </p>
      </div>
    </div>
  );
}
