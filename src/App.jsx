import { useState } from 'react';
import LeftScreen from './ui/LeftScreen';
import CeremonyApp from './ui/CeremonyApp';
import SoloDemo from './ui/SoloDemo';

const params = new URLSearchParams(location.search);
const roomUrl = (params.get('room') || import.meta.env.VITE_DAILY_ROOM_URL || '').trim();

// Everyone enters through a per-person ?t=<token> link the Master of Ceremony shares from the
// panel (the MC's own link is printed by the server at startup). The token — not editable URL
// params — is what tells the server who you are, so role/name can't be changed by editing the URL.
//   • ?t=<token> → that person (student / professor / guest / MC), resolved server-side
//   • ?solo=1    → the no-room AR-cap demo
//   • no token   → CeremonyApp connects, the server rejects it, and a locked "invite-only" screen shows
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
