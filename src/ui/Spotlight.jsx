import ParticipantTile from './ParticipantTile';
import { REST_ANGLE } from '../tassel';

// Ceremony mode: zoom to the professor + the current student, with the ceremony title
// caption (set by the MC).
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
          <div className="spot-label">Professor</div>
        </div>

        <div className="spot-vs">turning the tassel of</div>

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
          {current && (
            <div className="spot-caption">
              <div className="spot-name">{current.name}</div>
              {cstate.title && <div className="spot-sub">{cstate.title}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
