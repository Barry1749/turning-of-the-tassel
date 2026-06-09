import ParticipantTile from './ParticipantTile';
import { REST_ANGLE } from '../tassel';

// Ceremony mode: a clean two-up of just the professor + the current student. Each video
// keeps its own in-tile name/role caption; there's no extra chrome around the tiles.
export default function Spotlight({ cstate, participants, myId, selfStream, selfCanvas, remote, tasselRef }) {
  const roster = cstate.roster || [];
  const current = roster.find((s) => s.id === cstate.currentId) || null;
  const host = participants.find((p) => p.role === 'host' || p.role === 'professor') || null;

  const streamFor = (p) => {
    if (!p) return null;
    return p.id === myId ? selfStream : remote[p.id]?.stream || remote[p.name]?.stream;
  };
  const participantByName = (n) =>
    participants.find((p) => p.name.toLowerCase() === (n || '').toLowerCase()) || null;

  const studentP = current ? participantByName(current.name) : null;

  return (
    <div className="spotlight">
      <div className="spot-tiles">
        <div className="spot-col">
          <ParticipantTile
            big
            stream={streamFor(host)}
            selfCanvas={host?.id === myId ? selfCanvas : null}
            name={host?.name || 'Professor'}
            role="host"
            isSelf={host?.id === myId}
            getAngle={() => REST_ANGLE}
          />
        </div>

        <div className="spot-col">
          <ParticipantTile
            big
            stream={streamFor(studentP)}
            selfCanvas={studentP?.id === myId ? selfCanvas : null}
            name={current?.name || '—'}
            role="student"
            isSelf={studentP?.id === myId}
            isCurrent
            turned={current?.turned}
            degree={current?.degree}
            getAngle={() => tasselRef.current.angle}
          />
        </div>
      </div>
    </div>
  );
}
