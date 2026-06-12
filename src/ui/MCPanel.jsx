import { useRef, useState } from 'react';
import { DEGREE_TASSELS, tasselColorFor } from '../drawCap';
import { VIDEO_QUALITIES, DEFAULT_QUALITY } from '../videoQuality';

// ---------------------------------------------------------------------------
// CSV roster import / export.
//   Import: column 1 = name, column 2 = role (bachelor | master | phd | professor).
//   Export: those two columns + a personal join link per person, with the one shared
//   guest link as the last row. A leading header row is auto-skipped, and a few common
//   spellings of each role map onto our four kinds so the MC's spreadsheet needn't match
//   exactly. Students carry a degree (→ tassel colour); professors are a separate list.
// ---------------------------------------------------------------------------
const ROLE_ALIASES = {
  bachelor: 'bachelor', bachelors: 'bachelor', ba: 'bachelor', bs: 'bachelor', bsc: 'bachelor',
  undergraduate: 'bachelor', undergrad: 'bachelor',
  master: 'master', masters: 'master', ma: 'master', ms: 'master', msc: 'master', meng: 'master',
  phd: 'phd', 'ph.d': 'phd', 'ph.d.': 'phd', doctor: 'phd', doctoral: 'phd', doctorate: 'phd', dphil: 'phd',
  professor: 'professor', prof: 'professor', faculty: 'professor',
};
function normalizeRole(raw) {
  const k = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ROLE_ALIASES[k] || null;
}

// Minimal RFC-4180-ish parser: handles quoted fields, embedded commas / quotes / newlines,
// CRLF or LF line endings, and a leading UTF-8 BOM (Excel). Returns an array of string rows.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Turn parsed rows into { students: [{name, degree}], professors: [{name}], skipped }.
const HEADER_ROLE_WORDS = new Set(['role', 'degree', 'type', 'kind']);
function rowsToImport(rows) {
  if (!rows.length) return { students: [], professors: [], skipped: 0 };
  const first = rows[0];
  const looksHeader =
    (first[0] || '').trim().toLowerCase() === 'name' ||
    HEADER_ROLE_WORDS.has((first[1] || '').trim().toLowerCase());
  const data = looksHeader ? rows.slice(1) : rows;
  const students = [];
  const professors = [];
  let skipped = 0;
  for (const r of data) {
    const name = (r[0] || '').trim();
    const role = normalizeRole(r[1]);
    if (!name) { skipped += 1; continue; }
    if (role === 'professor') professors.push({ name });
    else if (role) students.push({ name, degree: role });
    else skipped += 1;
  }
  return { students, professors, skipped };
}

// Drop names already present (in `have`) or repeated within the list (case-insensitive).
function dedupeByName(list, have) {
  const seen = new Set();
  return list.filter((item) => {
    const k = item.name.trim().toLowerCase();
    if (have.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// CSV writer: quote a cell only when it contains a comma, quote or newline.
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Control panel for any controller (MC / professor / host).
//   - canEditRoster (MC / host): ceremony info, program order, add/remove students &
//     professors, per-person join links
//   - flow control (mode, prev/next, spotlight): all controllers
//   - tassel-turn controls: in ceremony mode; the hand-gesture toggle is the professor's
export default function MCPanel({
  cstate,
  actions,
  participants = [],
  canEditRoster,
  guestCount,
  isProfessor,
  gestureOn,
  setGestureOn,
  camStatus,
  arReady,
  faceOk,
  handOk,
  pinching,
}) {
  const [open, setOpen] = useState(true);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('bachelor'); // role for the next person added: a degree id (student) or 'professor'
  // Video-relay override drafts. The committed value lives in cstate.turnServer (room-wide,
  // server-authoritative); these only hold what the MC is typing until Apply.
  const [turnHost, setTurnHost] = useState('');
  const [turnUser, setTurnUser] = useState('');
  const [turnPass, setTurnPass] = useState('');
  const [copied, setCopied] = useState(null);
  const [dragIndex, setDragIndex] = useState(null); // student row being dragged
  const [overIndex, setOverIndex] = useState(null); // row it's hovering over
  const fileRef = useRef(null); // hidden CSV file input, opened by the Import button
  const [csvNote, setCsvNote] = useState(null); // one-line result summary after an import

  const roster = cstate.roster || [];
  const professors = cstate.professors || [];
  const ceremony = cstate.mode === 'ceremony';
  const current = roster.find((s) => s.id === cstate.currentId) || null;
  const turnActive = cstate.turnServer || null; // the relay override currently in force (null = built-in)

  const applyTurn = () => {
    const host = turnHost.trim();
    if (!host) return;
    actions.setTurnServer({ host, username: turnUser.trim(), credential: turnPass });
  };
  const clearTurn = () => {
    setTurnHost('');
    setTurnUser('');
    setTurnPass('');
    actions.setTurnServer(null);
  };

  // "Spotlight for everyone": people who actually have a video tile (students + professor/host on
  // camera) are the candidates the host can pin onto every screen. Held by name (matches the tiles).
  const spotlightCandidates = participants.filter((p) => ['student', 'professor', 'host'].includes(p.role));
  const spotlightName = cstate.spotlightName || '';
  const spotlightKnown = spotlightCandidates.some((p) => p.name === spotlightName);

  // One add control for everyone: a student gets a degree (→ tassel colour); a professor (who
  // turns the tassel) is the fourth role. Keep newRole after adding so a run of the same role
  // can be entered quickly.
  const addParticipant = () => {
    const name = newName.trim();
    if (!name) return;
    if (newRole === 'professor') actions.addProfessor({ name });
    else actions.addStudent({ name, degree: newRole });
    setNewName('');
  };

  // Drag-to-reorder the student program: grab a row's handle, drop it on another row,
  // and we send the whole new id order to the server. We use pointer events rather than the
  // HTML5 drag API because native drag-and-drop never fires from touch — so on a phone the
  // handle did nothing. Pointer events fire the same for mouse, finger, and pen.
  //
  // The live from/over indices (and the last pointer position) are kept in a ref — the source
  // of truth for the drop and the auto-scroll loop — so they're correct even if React hasn't
  // flushed the last move's state update; dragIndex/overIndex state only paints the highlights.
  const dragRef = useRef({ from: null, over: null, x: 0, y: 0 });
  const scrollRef = useRef(null); // the scrollable <ol> of students
  const autoScrollRef = useRef(0); // rAF id while edge-scrolling, 0 when idle

  // Find the row under (x, y) and make it the drop target. Run on every move and after each
  // auto-scroll step, since scrolling slides a new row under a stationary finger.
  const hitTestRow = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const li = el && el.closest('li[data-row-index]');
    if (!li) return;
    const i = Number(li.dataset.rowIndex);
    if (!Number.isNaN(i) && i !== dragRef.current.over) {
      dragRef.current.over = i;
      setOverIndex(i);
    }
  };

  // While the finger sits near the top/bottom edge of the list, scroll it so rows that are
  // off-screen can still be reached — otherwise you can't drag to the very front or back of a
  // list that doesn't fully fit. The captured drag suppresses the browser's own scrolling, so
  // we drive it here, re-running the hit-test each frame as the content moves under the finger.
  const autoScroll = () => {
    const sc = scrollRef.current;
    if (dragRef.current.from === null || !sc) { autoScrollRef.current = 0; return; }
    const r = sc.getBoundingClientRect();
    const EDGE = 36; // px edge band that triggers scrolling
    const MAX = 12; // px per frame at the very edge
    const y = dragRef.current.y;
    let v = 0;
    if (y < r.top + EDGE) v = -Math.ceil(((r.top + EDGE - y) / EDGE) * MAX);
    else if (y > r.bottom - EDGE) v = Math.ceil(((y - (r.bottom - EDGE)) / EDGE) * MAX);
    const before = sc.scrollTop;
    if (v) sc.scrollTop += v;
    if (sc.scrollTop !== before) {
      hitTestRow(dragRef.current.x, dragRef.current.y);
      autoScrollRef.current = requestAnimationFrame(autoScroll);
    } else {
      autoScrollRef.current = 0; // out of the band, or already at an end — stop
    }
  };

  const onRowPointerDown = (e, i) => {
    if (!e.isPrimary || e.button > 0) return; // ignore extra fingers / right-click
    dragRef.current = { from: i, over: i, x: e.clientX, y: e.clientY };
    setDragIndex(i);
    setOverIndex(i);
    // Route every later move/up to the handle even as the finger slides onto other rows.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
  };
  const onRowPointerMove = (e) => {
    if (dragRef.current.from === null) return;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    // Capture keeps the events on the handle, so the event target is useless for telling which
    // row we're over — ask the document what's actually under the pointer instead.
    hitTestRow(e.clientX, e.clientY);
    if (!autoScrollRef.current) autoScroll(); // start edge-scrolling if we're in the band
  };
  const endDrag = () => {
    cancelAnimationFrame(autoScrollRef.current);
    autoScrollRef.current = 0;
    dragRef.current = { from: null, over: null, x: 0, y: 0 };
    setDragIndex(null);
    setOverIndex(null);
  };
  const onRowPointerUp = () => {
    const { from, over } = dragRef.current;
    endDrag();
    if (from === null || over === null || from === over) return;
    const ids = roster.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(over, 0, moved);
    actions.reorderStudents(ids);
  };

  // Build a join link, carrying over the MC's own connection context (ws / room) so
  // everyone lands on the SAME ceremony backend + video room the MC is on. In dev / tunnel
  // setups these live in the URL; in production they come from env, so the link stays clean.
  const makeLink = (extra) => {
    const p = new URLSearchParams();
    const cur = new URLSearchParams(location.search);
    for (const k of ['ws', 'room']) if (cur.get(k)) p.set(k, cur.get(k));
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${location.origin}${location.pathname}?${p.toString()}`;
  };
  // Personal join link for a roster person — their token is what admits them (and pins their
  // role + name). Editing the link just makes the token unknown, so it can't be tampered with.
  const joinLink = (tok) => makeLink({ t: tok });
  // One shared watch-only link for guests — its own token, anonymous (guests are counted, not listed).
  const guestLink = () => makeLink({ t: cstate.guestToken });
  const copyLink = async (id, link) => {
    const flash = (key, ms) => { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), ms); };
    // Try the async Clipboard API, then fall back to a legacy textarea + execCommand copy (works
    // where the async API is missing or blocked). Never fail silently — show a ⚠ if both fail.
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
        flash(id, 1500);
        return;
      }
      throw new Error('no clipboard api');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) { flash(id, 1500); return; }
      } catch {
        /* fall through to a visible failure */
      }
      flash('fail:' + id, 4000);
    }
  };

  // --- CSV import / export (MC only) ---------------------------------------
  const importCsv = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setCsvNote('Could not read that file.');
    reader.onload = () => {
      const parsed = rowsToImport(parseCsv(reader.result));
      // Dedupe so the summary reflects what's actually new: drop names already in the roster
      // and any repeats within the file itself. The server guards against dupes too.
      const haveS = new Set(roster.map((s) => s.name.trim().toLowerCase()));
      const haveP = new Set(professors.map((p) => p.name.trim().toLowerCase()));
      const students = dedupeByName(parsed.students, haveS);
      const profs = dedupeByName(parsed.professors, haveP);
      const dupes = parsed.students.length - students.length + (parsed.professors.length - profs.length);

      if (!students.length && !profs.length) {
        const why = parsed.skipped
          ? `${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} had no recognised role`
          : 'nothing new to add';
        setCsvNote(`Nothing imported — ${why}.`);
        return;
      }
      actions.importRoster({ students, professors: profs });
      const parts = [
        `${students.length} student${students.length === 1 ? '' : 's'}`,
        `${profs.length} professor${profs.length === 1 ? '' : 's'}`,
      ];
      const extra = [];
      if (dupes > 0) extra.push(`${dupes} duplicate${dupes === 1 ? '' : 's'} skipped`);
      if (parsed.skipped) extra.push(`${parsed.skipped} unrecognised`);
      setCsvNote(`Added ${parts.join(' + ')}${extra.length ? ` (${extra.join(', ')})` : ''}.`);
    };
    reader.readAsText(file);
  };
  const onCsvFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // let the MC re-pick the same file later
    importCsv(file);
  };
  // Download the roster as name,role,link — every student + professor, with the one shared
  // guest link as the last row. Reuses the exact links the per-row 🔗 buttons copy.
  const downloadCsv = () => {
    const rows = [['name', 'role', 'link']];
    for (const s of roster) rows.push([s.name, s.degree || 'bachelor', joinLink(s.token)]);
    for (const p of professors) rows.push([p.name, 'professor', joinLink(p.token)]);
    rows.push(['Guest', 'guest', guestLink()]);
    const base = (cstate.title || 'ceremony')
      .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ceremony';
    const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' }); // BOM → Excel reads UTF-8
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}-roster.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const gestureStat =
    camStatus !== 'ready'
      ? 'camera…'
      : !arReady
        ? 'loading AR…'
        : pinching
          ? '✊ grabbing'
          : handOk
            ? '✋ hand ready'
            : 'show your hand';

  return (
    <aside className={`mc ${open ? '' : 'collapsed'}`}>
      <div className="mc-head">
        <strong>{canEditRoster ? '🎛️ Master of Ceremony' : '🎓 Professor'}</strong>
        <button className="ghost" onClick={() => setOpen((o) => !o)}>{open ? '⟨' : '⟩'}</button>
      </div>

      {open && (
        <div className="mc-body">
          <div className="mc-seg">
            <button className={!ceremony ? 'sel' : ''} onClick={() => actions.setMode('normal')}>Gallery</button>
            <button className={ceremony ? 'sel' : ''} onClick={() => actions.setMode('ceremony')}>Ceremony</button>
          </div>

          {canEditRoster && (
            <label className="mc-quality" title="Broadcast video resolution for everyone on camera. Higher looks sharper but needs more bandwidth.">
              <span>Video quality</span>
              <select
                value={cstate.videoQuality || DEFAULT_QUALITY}
                onChange={(e) => actions.setVideoQuality(e.target.value)}
              >
                {VIDEO_QUALITIES.map((q) => (
                  <option key={q.id} value={q.id}>{q.label}</option>
                ))}
              </select>
            </label>
          )}

          {canEditRoster && (
            <details className="mc-turn">
              <summary title="The relay (TURN server) that carries video between participants whose networks can't connect directly">
                Video relay · {turnActive ? turnActive.host : 'built-in'}
              </summary>
              <p className="mc-tip">
                {turnActive
                  ? 'Everyone in the room is using this relay. Clear it to go back to the built-in one.'
                  : 'If nobody can see each other (relay offline), enter another relay server here — every participant switches automatically, no rebuild needed. To run your own: coturn/RUN-YOUR-OWN-SERVER.md.'}
              </p>
              <input
                className="mc-in"
                placeholder="Relay public IP, e.g. 203.0.113.45"
                value={turnHost}
                onChange={(e) => setTurnHost(e.target.value)}
              />
              <input
                className="mc-in"
                placeholder="Username (e.g. tassel)"
                value={turnUser}
                onChange={(e) => setTurnUser(e.target.value)}
              />
              <input
                className="mc-in"
                type="password"
                placeholder="Password"
                value={turnPass}
                onChange={(e) => setTurnPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyTurn()}
              />
              <div className="mc-row">
                <button onClick={applyTurn} disabled={!turnHost.trim()} title="Switch the whole room to this relay">
                  Use this relay
                </button>
                {turnActive && (
                  <button onClick={clearTurn} title="Back to the relay built into the app">
                    ↺ Built-in
                  </button>
                )}
              </div>
            </details>
          )}

          <div className="mc-row">
            <button onClick={actions.prev}>◀ Prev</button>
            <button onClick={actions.next}>Next ▶</button>
          </div>

          {canEditRoster && (
            <>
              <div className="mc-section">Spotlight for everyone</div>
              <div className="mc-spotlight">
                <select
                  value={spotlightName}
                  onChange={(e) => actions.setSpotlight(e.target.value || null)}
                  title="Pin one person big on EVERYONE's screen (overrides each viewer's own pin)"
                >
                  <option value="">— off (each viewer picks) —</option>
                  {spotlightName && !spotlightKnown && (
                    <option value={spotlightName}>{spotlightName} (offline)</option>
                  )}
                  {spotlightCandidates.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
                {spotlightName && (
                  <button
                    className="mc-reset"
                    onClick={() => actions.setSpotlight(null)}
                    title="Stop spotlighting — viewers control their own pin again"
                  >
                    Clear
                  </button>
                )}
              </div>
            </>
          )}

          <div className="mc-section">
            Students
            {canEditRoster && (
              <button className="mc-reset" onClick={actions.resetAll} title="Un-turn everyone and return to gallery">↺ reset all</button>
            )}
          </div>
          <ol className="mc-roster mc-roster-students" ref={scrollRef}>
            {roster.map((s, i) => (
              <li
                key={s.id}
                data-row-index={i}
                className={[
                  s.id === cstate.currentId ? 'cur' : '',
                  dragIndex === i ? 'dragging' : '',
                  overIndex === i && dragIndex !== i ? 'drag-over' : '',
                ].filter(Boolean).join(' ')}
              >
                <span className="r-name" onClick={() => actions.select(s.id)} title="Spotlight this student">
                  <span className="r-seq">{i + 1}</span>
                  <span className="r-dot" style={{ background: tasselColorFor(s.degree) }} title={`${s.degree || 'bachelor'} tassel`} />
                  {s.name} {s.turned ? <em>✓</em> : ''}
                </span>
                {canEditRoster && (
                  <select
                    className="r-degree"
                    value={s.degree || 'bachelor'}
                    onChange={(e) => actions.setDegree(s.id, e.target.value)}
                    title="Degree — sets the tassel colour"
                  >
                    {DEGREE_TASSELS.map((d) => (
                      <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                  </select>
                )}
                {canEditRoster && (
                  <span className="r-actions">
                    <span
                      className="r-drag"
                      onPointerDown={(e) => onRowPointerDown(e, i)}
                      onPointerMove={onRowPointerMove}
                      onPointerUp={onRowPointerUp}
                      onPointerCancel={endDrag}
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                    >
                      ⠿
                    </span>
                    <button onClick={() => copyLink(s.id, joinLink(s.token))} title="Copy this student's personal join link">
                      {copied === s.id ? '✓' : copied === 'fail:' + s.id ? '⚠' : '🔗'}
                    </button>
                    <button onClick={() => actions.removeStudent(s.id)} title="Remove">✕</button>
                  </span>
                )}
              </li>
            ))}
          </ol>

          {canEditRoster && (
            <>
              <div className="mc-section">Professors</div>
              <ol className="mc-roster mc-roster-profs">
                {professors.length === 0 && <li className="r-empty">No professors yet</li>}
                {professors.map((p) => (
                  <li key={p.id} className={p.id === cstate.currentProfessorId ? 'cur' : ''}>
                    <span className="r-name" onClick={() => actions.selectProfessor(p.id)} title="Spotlight this professor">
                      🎓 {p.name}
                    </span>
                    <span className="r-actions">
                      <button onClick={() => copyLink(p.id, joinLink(p.token))} title="Copy this professor's personal join link">
                        {copied === p.id ? '✓' : copied === 'fail:' + p.id ? '⚠' : '🔗'}
                      </button>
                      <button onClick={() => actions.removeProfessor(p.id)} title="Remove">✕</button>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mc-section">
                Guests · {guestCount}
                <button
                  className="mc-reset"
                  onClick={() => copyLink('guest', guestLink())}
                  title="Copy the shared watch-only guest link"
                >
                  {copied === 'guest' ? '✓ copied' : copied === 'fail:guest' ? '⚠ copy failed' : '🔗 guest link'}
                </button>
              </div>
            </>
          )}

          {canEditRoster && (
            <>
              <div className="mc-section">Add participant</div>
              <div className="mc-add">
                <input
                  className="mc-in"
                  placeholder="Add participant name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addParticipant()}
                />
                <select
                  className="mc-degree-new"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  title="Role — bachelor / master / phd set the tassel colour; a professor turns the tassel"
                >
                  {DEGREE_TASSELS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                  <option value="professor">Professor</option>
                </select>
                <button onClick={addParticipant}>Add</button>
              </div>
            </>
          )}

          {canEditRoster && (
            <>
              <div className="mc-section">Roster · CSV</div>
              <div className="mc-csv">
                <button
                  onClick={() => fileRef.current && fileRef.current.click()}
                  title="Import people from a CSV — column 1 name, column 2 role (bachelor / master / phd / professor)"
                >
                  ⬆ Import
                </button>
                <button
                  onClick={downloadCsv}
                  title="Download name, role and a personal join link for everyone (shared guest link last)"
                >
                  ⬇ Download
                </button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onCsvFile} />
              </div>
              {csvNote && <p className="mc-tip">{csvNote}</p>}
            </>
          )}

          {ceremony && (
            <>
              <div className="mc-section">Turn the tassel{current ? ` — ${current.name}` : ''}</div>
              {isProfessor && (
                <label className="mc-check">
                  <input type="checkbox" checked={gestureOn} onChange={(e) => setGestureOn(e.target.checked)} />
                  Use hand gesture
                  <span className="mc-camstat">{gestureStat}</span>
                </label>
              )}
              <div className="mc-row">
                <button onClick={() => actions.countdown(3)}>3·2·1</button>
                <button onClick={actions.manualTurn}>Turn (manual)</button>
              </div>
              <div className="mc-row">
                <button onClick={actions.resetTassel}>Reset tassel</button>
                <button className="commit" onClick={actions.commit}>Mark graduated ✓</button>
              </div>
              {isProfessor && <p className="mc-tip">Pinch → sweep right→left → release.</p>}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
