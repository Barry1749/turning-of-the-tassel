import { useState } from 'react';
import LeftScreen from './ui/LeftScreen';
import CeremonyApp from './ui/CeremonyApp';
import SoloDemo from './ui/SoloDemo';

const params = new URLSearchParams(location.search);
const roomUrl = (params.get('room') || import.meta.env.VITE_DAILY_ROOM_URL || '').trim();

// The bare app URL is the Master of Ceremony's console. Students, professors, and guests enter
// through a per-person ?t=<token> link the MC shares from the panel — the token, not editable URL
// params, tells the server who they are, so role/name can't be changed by editing the URL.
//   • no token   → the MC console (the host just opens the app)
//   • ?t=<token> → that student / professor / guest, resolved server-side
//   • ?solo=1    → the no-room AR-cap demo
// (An unknown / expired token is rejected with a locked screen, handled in CeremonyApp.)
function initialSession() {
  if (params.get('solo')) return 'solo';
  return { token: (params.get('t') || '').trim() || null, roomUrl };
}

export default function App() {
  const [session, setSession] = useState(initialSession); // null | 'solo' | {name, role, roomUrl}

  if (session === 'solo') return <SoloDemo onBack={() => setSession(null)} />;
  if (!session) return <LeftScreen onSolo={() => setSession('solo')} />;
  return <CeremonyApp {...session} onLeave={() => setSession(null)} />;
}
