import { useRef, useState } from 'react';
import { DEGREE_TASSELS, tasselColorFor } from '../drawCap';

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
  const [newDegree, setNewDegree] = useState('bachelor'); // degree for the next student added
  const [newProf, setNewProf] = useState(''); // name for the next professor added
  const [uni, setUni] = useState(cstate.university || '');
  const [dept, setDept] = useState(cstate.department || '');
  const [copied, setCopied] = useState(null);
  const [dragIndex, setDragIndex] = useState(null); // student row being dragged
  const [overIndex, setOverIndex] = useState(null); // row it's hovering over
  const fileRef = useRef(null); // hidden CSV file input, opened by the Import button
  const [csvNote, setCsvNote] = useState(null); // one-line result summary after an import

  const roster = cstate.roster || [];
  const professors = cstate.professors || [];
  const ceremony = cstate.mode === 'ceremony';
  const current = roster.find((s) => s.id === cstate.currentId) || null;

  const addStudent = () => {
    if (!newName.trim()) return;
    actions.addStudent({ name: newName.trim(), degree: newDegree });
    setNewName(''); // keep newDegree so several same-degree students can be added in a row
  };
  const addProfessor = () => {
    if (!newProf.trim()) return;
    actions.addProfessor({ name: newProf.trim() });
    setNewProf('');
  };
  // Auto-save the ceremony info when the MC finishes a field (blur / Enter); only push
  // if it actually changed, so tabbing through unchanged fields doesn't spam the room.
  const saveInfo = () => {
    const university = uni.trim();
    const department = dept.trim();
    if (university !== (cstate.university || '') || department !== (cstate.department || '')) {
      actions.setInfo({ university, department });
    }
  };

  // Drag-to-reorder the student program: grab a row's handle, drop it on another row,
  // and we send the whole new id order to the server.
  const onRowDragStart = (e, i) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* some browsers */ }
  };
  const onRowDragOver = (e, i) => {
    if (dragIndex === null) return;
    e.preventDefault(); // required so the drop is allowed
    e.dataTransfer.dropEffect = 'move';
    if (i !== overIndex) setOverIndex(i);
  };
  const onRowDrop = (e, i) => {
    e.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === i) return;
    const ids = roster.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(i, 0, moved);
    actions.reorderStudents(ids);
  };
  const onRowDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
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
  // Personal join link for a roster person — opens already named and auto-joins in their role.
  const joinLink = (pname, jrole) => makeLink({ role: jrole, name: pname, autojoin: '1' });
  // One shared watch-only link for guests — anonymous, so it carries no name (they're counted, not listed).
  const guestLink = () => makeLink({ role: 'guest', autojoin: '1' });
  const copyLink = async (id, link) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard blocked */
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
    for (const s of roster) rows.push([s.name, s.degree || 'bachelor', joinLink(s.name, 'student')]);
    for (const p of professors) rows.push([p.name, 'professor', joinLink(p.name, 'professor')]);
    rows.push(['Guest', 'guest', guestLink()]);
    const base = (cstate.university || cstate.department || 'ceremony')
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
          {canEditRoster && (
            <>
              <div className="mc-section">Ceremony</div>
              <input
                className="mc-in"
                placeholder="University"
                value={uni}
                onChange={(e) => setUni(e.target.value)}
                onBlur={saveInfo}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <input
                className="mc-in"
                placeholder="Department"
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                onBlur={saveInfo}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </>
          )}

          <div className="mc-seg">
            <button className={!ceremony ? 'sel' : ''} onClick={() => actions.setMode('normal')}>Gallery</button>
            <button className={ceremony ? 'sel' : ''} onClick={() => actions.setMode('ceremony')}>Ceremony</button>
          </div>

          <div className="mc-row">
            <button onClick={actions.prev}>◀ Prev</button>
            <button onClick={actions.next}>Next ▶</button>
          </div>

          <div className="mc-section">
            Students
            {canEditRoster && (
              <button className="mc-reset" onClick={actions.resetAll} title="Un-turn everyone and return to gallery">↺ reset all</button>
            )}
          </div>
          <ol className="mc-roster mc-roster-students">
            {roster.map((s, i) => (
              <li
                key={s.id}
                className={[
                  s.id === cstate.currentId ? 'cur' : '',
                  dragIndex === i ? 'dragging' : '',
                  overIndex === i && dragIndex !== i ? 'drag-over' : '',
                ].filter(Boolean).join(' ')}
                onDragOver={canEditRoster ? (e) => onRowDragOver(e, i) : undefined}
                onDrop={canEditRoster ? (e) => onRowDrop(e, i) : undefined}
              >
                <span className="r-name" onClick={() => actions.select(s.id)} title="Spotlight this student">
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
                      draggable
                      onDragStart={(e) => onRowDragStart(e, i)}
                      onDragEnd={onRowDragEnd}
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                    >
                      ⠿
                    </span>
                    <button onClick={() => copyLink(s.id, joinLink(s.name, 'student'))} title="Copy this student's personal join link">
                      {copied === s.id ? '✓' : '🔗'}
                    </button>
                    <button onClick={() => actions.removeStudent(s.id)} title="Remove">✕</button>
                  </span>
                )}
              </li>
            ))}
          </ol>

          {canEditRoster && (
            <div className="mc-add">
              <input
                className="mc-in"
                placeholder="Add student name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addStudent()}
              />
              <select
                className="mc-degree-new"
                value={newDegree}
                onChange={(e) => setNewDegree(e.target.value)}
                title="Degree for the new student — sets their tassel colour"
              >
                {DEGREE_TASSELS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <button onClick={addStudent}>Add</button>
            </div>
          )}

          {canEditRoster && (
            <>
              <div className="mc-section">Professors</div>
              <ol className="mc-roster mc-roster-profs">
                {professors.length === 0 && <li className="r-empty">No professors yet</li>}
                {professors.map((p) => (
                  <li key={p.id}>
                    <span className="r-name r-static">🎓 {p.name}</span>
                    <span className="r-actions">
                      <button onClick={() => copyLink(p.id, joinLink(p.name, 'professor'))} title="Copy this professor's personal join link">
                        {copied === p.id ? '✓' : '🔗'}
                      </button>
                      <button onClick={() => actions.removeProfessor(p.id)} title="Remove">✕</button>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mc-add">
                <input
                  className="mc-in"
                  placeholder="Add professor name"
                  value={newProf}
                  onChange={(e) => setNewProf(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addProfessor()}
                />
                <button onClick={addProfessor}>Add</button>
              </div>

              <div className="mc-section">
                Guests · {guestCount}
                <button
                  className="mc-reset"
                  onClick={() => copyLink('guest', guestLink())}
                  title="Copy the shared watch-only guest link"
                >
                  {copied === 'guest' ? '✓ copied' : '🔗 guest link'}
                </button>
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
