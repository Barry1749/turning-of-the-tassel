import { useState } from 'react';
import { DEGREE_TASSELS, tasselColorFor } from '../drawCap';

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
