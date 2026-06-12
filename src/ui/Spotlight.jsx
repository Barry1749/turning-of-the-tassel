import { useState } from 'react';
import ParticipantTile from './ParticipantTile';
import { REST_ANGLE } from '../tassel';

// Ceremony mode: a clean two-up of just the professor + the current student. Each viewer can
// locally pin either one to (almost) fill the screen (via the ⤢ button); a host "spotlight for
// everyone" (cstate.spotlightName) overrides that and pins the named person on every screen.
export default function Spotlight({ cstate, participants, myId, selfStream, selfCanvas, remote, tasselRef }) {
  const [pinKey, setPinKey] = useState(null); // 'host' | 'student' | null — local to this viewer
  const roster = cstate.roster || [];
  const professors = cstate.professors || [];
  const current = roster.find((s) => s.id === cstate.currentId) || null;

  const streamFor = (p) => {
    if (!p) return null;
    return p.id === myId ? selfStream : remote[p.id]?.stream || remote[p.name]?.stream;
  };
  const participantByName = (n) =>
    participants.find((p) => p.name.toLowerCase() === (n || '').toLowerCase()) || null;

  // The professor on screen is whichever one the MC has spotlighted. With none selected (e.g. no
  // named professors yet) fall back to the first connected professor/host so the tile isn't empty.
  const currentProf = professors.find((p) => p.id === cstate.currentProfessorId) || null;
  const host = currentProf
    ? participantByName(currentProf.name)
    : participants.find((p) => p.role === 'host' || p.role === 'professor') || null;
  const hostName = currentProf?.name || host?.name || 'Professor';

  const studentP = current ? participantByName(current.name) : null;
  const studentName = current?.name || '—';

  // Host "spotlight for everyone" only applies here if the named person is one of the two on the
  // ceremony stage; otherwise the normal two-up stays (the gallery is where it pins anyone).
  const spot = (cstate.spotlightName || '').toLowerCase();
  const forcedKey = !spot
    ? null
    : spot === hostName.toLowerCase()
      ? 'host'
      : spot === studentName.toLowerCase()
        ? 'student'
        : null;
  const forced = !!forcedKey;
  const activeKey = forcedKey || pinKey; // who fills the screen: host's choice, else this viewer's

  const togglePin = (key) => setPinKey((k) => (k === key ? null : key));
  const pinProps = (key) => (forced ? {} : { onPin: () => togglePin(key) }); // no local pin while forced

  const hostTile = (isMain) => (
    <ParticipantTile
      key="host"
      big
      stream={streamFor(host)}
      selfCanvas={host?.id === myId ? selfCanvas : null}
      name={hostName}
      role="host"
      isSelf={host?.id === myId}
      getAngle={() => REST_ANGLE}
      pinned={isMain && !forced}
      spotlighted={isMain && forced}
      {...pinProps('host')}
    />
  );
  const studentTile = (isMain) => (
    <ParticipantTile
      key="student"
      big
      stream={streamFor(studentP)}
      selfCanvas={studentP?.id === myId ? selfCanvas : null}
      name={studentName}
      role="student"
      isSelf={studentP?.id === myId}
      isCurrent
      turned={current?.turned}
      degree={current?.degree}
      getAngle={() => tasselRef.current.angle}
      pinned={isMain && !forced}
      spotlighted={isMain && forced}
      {...pinProps('student')}
    />
  );

  // One person pinned → big view + the other as a single filmstrip thumbnail.
  if (activeKey) {
    const main = activeKey === 'host' ? hostTile(true) : studentTile(true);
    const strip = activeKey === 'host' ? studentTile(false) : hostTile(false);
    return (
      <div className="spotlight">
        <div className="pinned-view">
          <div className="pin-main">{main}</div>
          <div className="pin-strip">{strip}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="spotlight">
      <div className="spot-tiles">
        <div className="spot-col">{hostTile(false)}</div>
        <div className="spot-col">{studentTile(false)}</div>
      </div>
    </div>
  );
}
