import ParticipantTile from './ParticipantTile';
import { REST_ANGLE } from '../tassel';
import { flagEmoji } from '../flags';

// Ceremony mode: zoom to the professor + the current student, with captions.
export default function Spotlight({ cstate, participants, myId, selfStream, remote, tasselRef }) {
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
            name={host?.name || 'Professor'}
            role="host"
            isSelf={host?.id === myId}
            flag="🎓"
            getAngle={() => REST_ANGLE}
          />
          <div className="spot-label">Professor</div>
        </div>

        <div className="spot-vs">turning the tassel of</div>

        <div className="spot-col">
          <ParticipantTile
            big
            stream={streamFor(studentP)}
            name={current?.name || '—'}
            role="student"
            isSelf={studentP?.id === myId}
            isCurrent
            flag={current ? flagEmoji(current.countryCode) : '🎓'}
            turned={current?.turned}
            getAngle={() => tasselRef.current.angle}
          />
          {current && (
            <div className="spot-caption">
              <div className="spot-name">
                {flagEmoji(current.countryCode)} {current.name}
              </div>
              {(current.university || current.country) && (
                <div className="spot-sub">
                  Studying at {current.university}
                  {current.university && current.country ? ', ' : ''}
                  {current.country}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
