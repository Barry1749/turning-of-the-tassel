import ParticipantTile from './ParticipantTile';
import { REST_ANGLE } from '../tassel';

// Google-Meet-style grid of the people who are on camera (students + professor).
// The MC and guests are operators/viewers and don't get a tile.
const ON_CAMERA = ['student', 'professor', 'host'];

export default function Gallery({ cstate, participants, myId, myName, selfStream, remote, tasselRef }) {
  const roster = cstate.roster || [];
  const byName = (n) => roster.find((s) => s.name.toLowerCase() === (n || '').toLowerCase());

  let tiles = participants.filter((p) => ON_CAMERA.includes(p.role));
  // show myself even before my presence echo arrives, if I have a camera
  if (!tiles.some((p) => p.id === myId) && selfStream) {
    tiles = [{ id: myId, name: myName, role: 'student' }, ...tiles];
  }

  if (!tiles.length) {
    return <div className="center-msg">Waiting for participants to join the call…</div>;
  }

  return (
    <div className={`gallery count-${Math.min(tiles.length, 9)}`}>
      {tiles.map((p) => {
        const isSelf = p.id === myId;
        const stream = isSelf ? selfStream : remote[p.id]?.stream || remote[p.name]?.stream;
        const s = byName(p.name);
        const isCurrent = !!(s && s.id === cstate.currentId);
        return (
          <ParticipantTile
            key={p.id}
            stream={stream}
            name={p.name}
            role={p.role}
            isSelf={isSelf}
            isCurrent={isCurrent}
            turned={s?.turned}
            degree={s?.degree}
            getAngle={() => (isCurrent ? tasselRef.current.angle : REST_ANGLE)}
          />
        );
      })}
    </div>
  );
}
