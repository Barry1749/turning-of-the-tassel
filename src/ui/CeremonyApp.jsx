import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCeremony } from '../useCeremony';
import { useSelfView } from '../useSelfView';
import { useDaily } from '../daily';
import { REST_ANGLE, ANGLE_MAX } from '../tassel';
import { celebrate, initAudio } from '../effects';
import Stage from './Stage';
import MCPanel from './MCPanel';
import Countdown from './Countdown';

export default function CeremonyApp({ name, role, roomUrl, onLeave }) {
  const isProfessor = role === 'professor' || role === 'host'; // performs the gesture (camera)
  const canSequence = role === 'mc' || role === 'host'; // controls the program
  const isController = canSequence || isProfessor;

  const { connected, myId, cstate, participants, tasselRef, eventRef, eventTick, send } = useCeremony({ role, name });

  const [gestureOn, setGestureOn] = useState(true);
  const [banner, setBanner] = useState(null);

  const roster = cstate?.roster || [];
  const currentStudent = roster.find((s) => s.id === cstate?.currentId) || null;

  // refs read inside the rAF loop / stable callbacks
  const amCurrentRef = useRef(false);
  amCurrentRef.current = !!(role === 'student' && currentStudent && currentStudent.name.toLowerCase() === name.toLowerCase());
  const gestureOnRef = useRef(false);
  gestureOnRef.current = gestureOn && isProfessor && cstate?.mode === 'ceremony';

  const getDrawAngle = useCallback(() => (amCurrentRef.current ? tasselRef.current.angle : REST_ANGLE), [tasselRef]);
  const onTassel = useCallback((angle, engaged) => {
    if (gestureOnRef.current) send({ type: 'tassel', angle, engaged });
  }, [send]);
  const onCommit = useCallback(() => {
    if (gestureOnRef.current) send({ type: 'commit' });
  }, [send]);

  // Only the professor / student devices need a camera. The MC can run on a phone with none.
  const needCamera = isProfessor || role === 'student';
  const { stream: selfStream, status: camStatus, error: camError, faceOk, handOk } = useSelfView({
    active: needCamera,
    isHost: isProfessor,
    getDrawAngle,
    onTassel,
    onCommit,
  });

  const { remote } = useDaily({ roomUrl, name, selfStream });

  // confetti + banner when the server broadcasts a graduation
  useEffect(() => {
    const ev = eventRef.current;
    if (ev?.event === 'celebrate') {
      initAudio();
      celebrate();
      const s = (cstate?.roster || []).find((x) => x.id === ev.studentId);
      setBanner(s ? s.name : 'Congratulations');
      const t = setTimeout(() => setBanner(null), 4200);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTick]);

  // manual turn: tween the tassel right -> left, then commit (fallback to the gesture)
  const manualRef = useRef(0);
  const manualTurn = useCallback(() => {
    initAudio();
    cancelAnimationFrame(manualRef.current);
    const dur = 1300;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      const angle = REST_ANGLE + (-ANGLE_MAX - REST_ANGLE) * e;
      send({ type: 'tassel', angle, engaged: true });
      if (t < 1) manualRef.current = requestAnimationFrame(step);
      else send({ type: 'commit' });
    };
    manualRef.current = requestAnimationFrame(step);
  }, [send]);

  const actions = useMemo(() => ({
    setMode: (mode) => send({ type: 'setMode', mode }),
    next: () => send({ type: 'next' }),
    prev: () => send({ type: 'prev' }),
    select: (id) => send({ type: 'selectStudent', id }),
    reorder: (id, dir) => send({ type: 'reorder', id, dir }),
    addStudent: (s) => send({ type: 'addStudent', ...s }),
    removeStudent: (id) => send({ type: 'removeStudent', id }),
    countdown: (n) => send({ type: 'startCountdown', n }),
    resetTassel: () => send({ type: 'resetTassel' }),
    commit: () => send({ type: 'commit' }),
    manualTurn,
  }), [send, manualTurn]);

  if (!cstate) {
    return <div className="center-msg">{connected ? 'Loading ceremony…' : 'Connecting to ceremony server…'}</div>;
  }

  const roleLabel = canSequence && isProfessor ? 'professor + mc' : canSequence ? 'mc' : isProfessor ? 'professor' : role;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🎓 Turning of the Tassel</span>
        <span className={`mode-pill ${cstate.mode}`}>{cstate.mode === 'ceremony' ? 'Ceremony' : 'Gallery'}</span>
        <span className="spacer" />
        <span className="me">{name} · {roleLabel}</span>
        <span className={`dot ${connected ? 'on' : 'off'}`} title={connected ? 'connected' : 'reconnecting…'} />
        <button className="ghost" onClick={onLeave}>Leave</button>
      </header>

      <Stage
        cstate={cstate}
        participants={participants}
        myId={myId}
        myName={name}
        selfStream={selfStream}
        remote={remote}
        tasselRef={tasselRef}
      />

      {isController && (
        <MCPanel
          cstate={cstate}
          actions={actions}
          canSequence={canSequence}
          isProfessor={isProfessor}
          gestureOn={gestureOn}
          setGestureOn={setGestureOn}
          camStatus={camStatus}
          faceOk={faceOk}
          handOk={handOk}
        />
      )}

      <Countdown n={cstate.countdown} />
      {banner && <div className="banner">🎓 {banner} — Congratulations! 🎉</div>}

      {needCamera && camStatus !== 'ready' && (
        <div className="cam-hint">{camStatus === 'error' ? `Camera: ${camError}` : 'Starting camera & AR…'}</div>
      )}
    </div>
  );
}
