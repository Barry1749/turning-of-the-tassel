import { useEffect, useRef, useState } from 'react';

const params = new URLSearchParams(location.search);

export default function JoinScreen({ onJoin, onSolo }) {
  const [name, setName] = useState(params.get('name') || '');
  const [role, setRole] = useState(params.get('role') || 'guest');
  const [roomUrl, setRoomUrl] = useState(params.get('room') || import.meta.env.VITE_DAILY_ROOM_URL || '');
  const autoDone = useRef(false);

  const submit = (e) => {
    if (e) e.preventDefault();
    if (name.trim()) onJoin({ name: name.trim(), role, roomUrl: roomUrl.trim() });
  };

  // A personalized link (?role=student&name=…&autojoin=1) joins straight away.
  useEffect(() => {
    if (autoDone.current) return;
    if (params.get('autojoin') && (params.get('name') || '').trim()) {
      autoDone.current = true;
      onJoin({
        name: params.get('name').trim(),
        role: params.get('role') || 'student',
        roomUrl: (params.get('room') || import.meta.env.VITE_DAILY_ROOM_URL || '').trim(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        <button type="submit" className="primary" disabled={!name.trim()}>Join ceremony</button>
        <button type="button" className="link" onClick={onSolo}>Try the AR cap solo (no room) →</button>

        <p className="note">
          Students usually open a personalized link from the host — it fills in your name and
          joins automatically. Use Chrome / Edge on desktop and allow your camera.
        </p>
      </form>
    </div>
  );
}
