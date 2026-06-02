import { useState } from 'react';

const params = new URLSearchParams(location.search);

export default function JoinScreen({ onJoin, onSolo }) {
  const [name, setName] = useState(params.get('name') || '');
  const [role, setRole] = useState(params.get('role') || 'guest');
  const [roomUrl, setRoomUrl] = useState(params.get('room') || import.meta.env.VITE_DAILY_ROOM_URL || '');

  const submit = (e) => {
    e.preventDefault();
    if (name.trim()) onJoin({ name: name.trim(), role, roomUrl: roomUrl.trim() });
  };

  return (
    <div className="join">
      <form className="join-card" onSubmit={submit}>
        <h1>🎓 Turning of the Tassel</h1>
        <p className="sub">Join the live graduation ceremony</p>

        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wei Kang" autoFocus />
        </label>

        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="mc">Master of Ceremony — controls only (phone OK)</option>
            <option value="professor">Professor — turns the tassel (needs camera)</option>
            <option value="host">Professor + MC on one device</option>
            <option value="student">Student (graduating)</option>
            <option value="guest">Guest (watch only)</option>
          </select>
        </label>

        <label>
          Daily room URL <span className="opt">— optional, blank = local mode</span>
          <input value={roomUrl} onChange={(e) => setRoomUrl(e.target.value)} placeholder="https://you.daily.co/ceremony" />
        </label>

        <button type="submit" className="primary" disabled={!name.trim()}>Join ceremony</button>
        <button type="button" className="link" onClick={onSolo}>Try the AR cap solo (no room) →</button>

        <p className="note">
          Students: use the same name as on the program so the professor can spotlight you.
          Use Chrome / Edge on desktop and allow your camera.
        </p>
      </form>
    </div>
  );
}
