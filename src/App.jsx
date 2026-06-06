import { useState } from 'react';
import LeftScreen from './ui/LeftScreen';
import CeremonyApp from './ui/CeremonyApp';
import SoloDemo from './ui/SoloDemo';

const params = new URLSearchParams(location.search);
const roomUrl = (params.get('room') || import.meta.env.VITE_DAILY_ROOM_URL || '').trim();

// Resolve who is opening the app straight from the URL:
//   • a personal link (?autojoin=1&name=…&role=…) → that named student / professor
//   • the shared guest link (?role=guest&autojoin=1) → an anonymous watch-only guest
//   • ?solo=1 → the no-room AR-cap demo
//   • the bare app URL → the Master of Ceremony, dropped straight into the control panel
// Everyone but the MC arrives through a link the MC shares from the panel, so the bare URL
// is the MC's own entry point and never shows a role picker.
function initialSession() {
  if (params.get('solo')) return 'solo';
  const role = params.get('role');
  const name = (params.get('name') || '').trim();
  // Student/professor links carry a name; the guest link is shared and nameless.
  if (params.get('autojoin') && (name || role === 'guest')) {
    return { name: name || 'Guest', role: role || 'student', roomUrl };
  }
  return { name: name || 'Master of Ceremony', role: 'mc', roomUrl };
}

export default function App() {
  const [session, setSession] = useState(initialSession); // null | 'solo' | {name, role, roomUrl}

  if (session === 'solo') return <SoloDemo onBack={() => setSession(null)} />;
  if (!session) return <LeftScreen onSolo={() => setSession('solo')} />;
  return <CeremonyApp {...session} onLeave={() => setSession(null)} />;
}
