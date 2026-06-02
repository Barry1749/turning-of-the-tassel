import { useState } from 'react';
import { flagEmoji } from '../flags';

// Control panel. Two independent capabilities, shown per role:
//   canSequence (MC / host)  -> program order, mode toggle, next/prev
//   isProfessor (prof / host) -> the tassel-turn controls (gesture + manual + commit)
export default function MCPanel({ cstate, actions, canSequence, isProfessor, gestureOn, setGestureOn, camStatus, faceOk, handOk }) {
  const [open, setOpen] = useState(true);
  const [form, setForm] = useState({ name: '', university: '', country: '', countryCode: '' });
  const roster = cstate.roster || [];
  const ceremony = cstate.mode === 'ceremony';
  const current = roster.find((s) => s.id === cstate.currentId) || null;

  const addStudent = () => {
    if (!form.name.trim()) return;
    actions.addStudent(form);
    setForm({ name: '', university: '', country: '', countryCode: '' });
  };

  return (
    <aside className={`mc ${open ? '' : 'collapsed'}`}>
      <div className="mc-head">
        <strong>{canSequence ? '🎛️ Master of Ceremony' : '🎓 Professor'}</strong>
        <button className="ghost" onClick={() => setOpen((o) => !o)}>{open ? '⟨' : '⟩'}</button>
      </div>

      {open && (
        <div className="mc-body">
          {canSequence && (
            <>
              <div className="mc-seg">
                <button className={!ceremony ? 'sel' : ''} onClick={() => actions.setMode('normal')}>Gallery</button>
                <button className={ceremony ? 'sel' : ''} onClick={() => actions.setMode('ceremony')}>Ceremony</button>
              </div>

              <div className="mc-row">
                <button onClick={actions.prev}>◀ Prev</button>
                <button onClick={actions.next}>Next ▶</button>
              </div>

              <div className="mc-section">Program order</div>
              <ol className="mc-roster">
                {roster.map((s) => (
                  <li key={s.id} className={s.id === cstate.currentId ? 'cur' : ''}>
                    <span className="r-name" onClick={() => actions.select(s.id)} title="Spotlight this student">
                      {flagEmoji(s.countryCode)} {s.name} {s.turned ? <em>✓</em> : ''}
                    </span>
                    <span className="r-actions">
                      <button onClick={() => actions.reorder(s.id, 'up')} title="Move up">↑</button>
                      <button onClick={() => actions.reorder(s.id, 'down')} title="Move down">↓</button>
                      <button onClick={() => actions.removeStudent(s.id)} title="Remove">✕</button>
                    </span>
                  </li>
                ))}
              </ol>

              <details className="mc-add">
                <summary>+ Add student</summary>
                <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input placeholder="University" value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} />
                <input placeholder="Country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                <input placeholder="Country code (e.g. JP)" maxLength={2} value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} />
                <button onClick={addStudent}>Add</button>
              </details>
            </>
          )}

          {!canSequence && (
            <p className="mc-now">
              {current ? (
                <>Now: <strong>{flagEmoji(current.countryCode)} {current.name}</strong></>
              ) : (
                'Waiting for the MC to start the ceremony.'
              )}
            </p>
          )}

          {ceremony && (
            <>
              <div className="mc-section">Turn the tassel</div>
              {isProfessor && (
                <label className="mc-check">
                  <input type="checkbox" checked={gestureOn} onChange={(e) => setGestureOn(e.target.checked)} />
                  Use hand gesture
                  <span className="mc-camstat">
                    {camStatus === 'ready' ? (handOk ? 'hand ✓' : faceOk ? 'show your hand' : 'no face') : 'camera…'}
                  </span>
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
              {isProfessor && (
                <p className="mc-tip">Pinch → sweep right→left → release. Releasing on the left graduates the student.</p>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
