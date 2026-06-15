import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import ParticipantTile from './ParticipantTile';
import { REST_ANGLE } from '../tassel';

// Google-Meet-style grid of the people who are on camera (students + professor).
// The MC and guests are operators/viewers and don't get a tile.
const ON_CAMERA = ['student', 'professor', 'host'];
const GAP = 10; // px — must match the `gap` on .gallery.grid in styles.css
const TILE_ASPECT = 4 / 3; // tiles keep a 4:3 shape (see .tile in styles.css)

// Largest tile width (px) such that `n` tiles of the given aspect ratio all fit inside a W×H box
// without scrolling. Tries every column count and keeps the split that yields the biggest tile —
// the same "maximise tile size for the viewport" idea Google Meet uses, so two phones-portrait
// tiles share the height instead of the second one falling below the fold.
function fitTileWidth(W, H, n, aspect, gap) {
  if (!(W > 0) || !(H > 0) || n < 1) return 0;
  // Never collapse to a single column once there are 3+ people: a tall 1-wide stack with big side
  // margins doesn't read as a grid. (Pure "biggest tile" would pick that on a narrow phone.) Two
  // people stay 1-wide in portrait — they just split the height — which is how Meet shows a pair on
  // a phone. With minCols ≥ 2 the chosen width always lets ≥2 tiles sit per row, so flex-wrap forms
  // a real grid (2×2 for four, etc.).
  const minCols = n >= 3 ? 2 : 1;
  let best = 0;
  for (let cols = minCols; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const byWidth = (W - gap * (cols - 1)) / cols;
    const byHeight = ((H - gap * (rows - 1)) / rows) * aspect;
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  // Floor so sub-pixel rounding can never let one extra tile sneak onto a row (which would
  // push the grid taller than the container and bring back the scrollbar).
  return Math.floor(best);
}

export default function Gallery({ cstate, participants, myId, myName, selfStream, selfCanvas, remote, tasselRef, controlsVisible }) {
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

  // A host "spotlight for everyone" (cstate.spotlightName) wins over each viewer's local pin: it
  // pins the named person on every screen and disables local pinning while it's in force.
  const spot = (cstate.spotlightName || '').toLowerCase();
  const forced = spot ? tiles.find((p) => p.name.toLowerCase() === spot) : null;
  const isForced = !!forced;
  const pinned = forced || (pinnedId ? tiles.find((p) => p.id === pinnedId) : null);

  const n = tiles.length;
  const inGrid = !pinned && n > 0;

  // Size the grid to fit the stage (no scrolling). We measure the grid's content box directly in a
  // layout effect (synchronous, before paint) rather than leaning on ResizeObserver's *initial*
  // callback — some embedded/headless browsers only deliver RO notifications on a later change, not
  // on observe. The observer + window listeners then handle subsequent resizes / orientation flips.
  const gridRef = useRef(null);
  const nRef = useRef(n);
  nRef.current = n;
  const [tileW, setTileW] = useState(0);
  const measure = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const W = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    setTileW(fitTileWidth(W, H, nRef.current, TILE_ASPECT, GAP));
  }, []);
  useLayoutEffect(() => {
    if (!inGrid) return undefined;
    measure();
    const el = gridRef.current;
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [inGrid, n, controlsVisible, measure]);

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

  if (!n) {
    return <div className="center-msg">Waiting for participants to join the call…</div>;
  }

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
    <div
      ref={gridRef}
      className={`gallery grid${controlsVisible ? ' has-controls' : ''}`}
      style={tileW ? { '--tile-w': `${tileW}px` } : undefined}
    >
      {tiles.map((p) => renderTile(p))}
    </div>
  );
}
