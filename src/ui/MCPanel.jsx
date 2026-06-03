import { useState } from 'react';

// Control panel for any controller (MC / professor / host).
//   - canEditRoster (MC / host): ceremony info, program order, add/remove, join links
//   - flow control (mode, prev/next, spotlight): all controllers
//   - tassel-turn controls: in ceremony mode; the hand-gesture toggle is the professor's
export default function MCPanel({
  cstate,
  actions,
  canEditRoster,
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
  const [uni, setUni] = useState(cstate.university || '');
  const [dept, setDept] = useState(cstate.department || '');
  const [copied, setCopied] = useState(null);

  const roster = cstate.roster || [];
  const ceremony = cstate.mode === 'ceremony';
  const current = roster.find((s) => s.id === cstate.currentId) || null;

  const addStudent = () => {
    if (!newName.trim()) return;
    actions.addStudent({ name: newName.trim() });
    setNewName('');
  };

  const joinLink = (s) =>
    `${location.origin}${location.pathname}?role=student&name=${encodeURIComponent(s.name)}&autojoin=1`;
  const copyLink = async (s) => {
    try {
      await navigator.clipboard.writeText(joinLink(s));
      setCopied(s.id);
      setTimeout(() => setCopied((c) => (c === s.id ? null : c)), 1500);
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
              <input className="mc-in" placeholder="University" value={uni} onChange={(e) => setUni(e.target.value)} />
              <input className="mc-in" placeholder="Department" value={dept} onChange={(e) => setDept(e.target.value)} />
              <button className="mc-save" onClick={() => actions.setInfo({ university: uni.trim(), department: dept.trim() })}>
                Save ceremony info
              </button>
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
          <ol className="mc-roster">
            {roster.map((s) => (
              <li key={s.id} className={s.id === cstate.currentId ? 'cur' : ''}>
                <span className="r-name" onClick={() => actions.select(s.id)} title="Spotlight this student">
                  {s.name} {s.turned ? <em>✓</em> : ''}
                </span>
                {canEditRoster && (
                  <span className="r-actions">
                    <button onClick={() => copyLink(s)} title="Copy this student's personal join link">
                      {copied === s.id ? '✓' : '🔗'}
                    </button>
                    <button onClick={() => actions.reorder(s.id, 'up')} title="Move up">↑</button>
                    <button onClick={() => actions.reorder(s.id, 'down')} title="Move down">↓</button>
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
              <button onClick={addStudent}>Add</button>
            </div>
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
