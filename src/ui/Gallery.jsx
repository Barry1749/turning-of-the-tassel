import { useState } from 'react';
import ParticipantTile from './ParticipantTile';
import { REST_ANGLE } from '../tassel';

// Google-Meet-style grid of the people who are on camera (students + professor).
// The MC and guests are operators/viewers and don't get a tile.
const ON_CAMERA = ['student', 'professor', 'host'];

export default function Gallery({ cstate, participants, myId, myName, selfStream, selfCanvas, remote, tasselRef }) {
  // Which tile this viewer has pinned to (almost) fill the screen. Local-only, like Meet — pinning
  // changes only my own view and is never sent to the server.
  const [pinnedId, setPinnedId] = useState(null);
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

  // A host "spotlight for everyone" (cstate.spotlightName) wins over each viewer's local pin: it
  // pins the named person on every screen and disables local pinning while it's in force.
  const spot = (cstate.spotlightName || '').toLowerCase();
  const forced = spot ? tiles.find((p) => p.name.toLowerCase() === spot) : null;
  const isForced = !!forced;
  const pinned = forced || (pinnedId ? tiles.find((p) => p.id === pinnedId) : null);

  const renderTile = (p, isMain = false) => {
    const isSelf = p.id === myId;
    const stream = isSelf ? selfStream : remote[p.id]?.stream || remote[p.name]?.stream;
    const s = byName(p.name);
    const isCurrent = !!(s && s.id === cstate.currentId);
    return (
      <ParticipantTile
        key={p.id}
        stream={stream}
        selfCanvas={isSelf ? selfCanvas : null}
        name={p.name}
        role={p.role}
        isSelf={isSelf}
        isCurrent={isCurrent}
        turned={s?.turned}
        degree={s?.degree}
        getAngle={() => (isCurrent ? tasselRef.current.angle : REST_ANGLE)}
        pinned={isMain && !isForced}
        spotlighted={isMain && isForced}
        onPin={isForced ? undefined : () => setPinnedId((id) => (id === p.id ? null : p.id))}
      />
    );
  };

  // A pinned person (local pin, or the host's spotlight) → big view + a filmstrip of everyone else.
  if (pinned) {
    const others = tiles.filter((p) => p.id !== pinned.id);
    return (
      <div className="gallery pinned-view">
        <div className="pin-main">{renderTile(pinned, true)}</div>
        {others.length > 0 && <div className="pin-strip">{others.map((p) => renderTile(p))}</div>}
      </div>
    );
  }

  return (
    <div className={`gallery count-${Math.min(tiles.length, 9)}`}>
      {tiles.map((p) => renderTile(p))}
    </div>
  );
}
