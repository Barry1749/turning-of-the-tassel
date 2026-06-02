import { useState } from 'react';
import JoinScreen from './ui/JoinScreen';
import CeremonyApp from './ui/CeremonyApp';
import SoloDemo from './ui/SoloDemo';

export default function App() {
  const [session, setSession] = useState(null); // null | 'solo' | {name, role, roomUrl}

  if (session === 'solo') return <SoloDemo onBack={() => setSession(null)} />;
  if (!session) return <JoinScreen onJoin={setSession} onSolo={() => setSession('solo')} />;
  return <CeremonyApp {...session} onLeave={() => setSession(null)} />;
}
