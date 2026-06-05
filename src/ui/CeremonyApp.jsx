import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCeremony } from '../useCeremony';
import { useSelfView } from '../useSelfView';
import { useDaily } from '../daily';
import { useP2P } from '../useP2P';
import { useLiveKit } from '../useLiveKit';
import { REST_ANGLE, ANGLE_MAX } from '../tassel';
import { setSelfDegree } from '../drawCap';
import { celebrate, initAudio } from '../effects';
import Stage from './Stage';
import MCPanel from './MCPanel';
import Countdown from './Countdown';

export default function CeremonyApp({ name, role, roomUrl, onLeave }) {
  const isProfessor = role === 'professor' || role === 'host'; // performs the gesture (camera)
  const canEditRoster = role === 'mc' || role === 'host'; // edits the program order
  const isController = role === 'mc' || role === 'professor' || role === 'host';

  const { connected, myId, cstate, participants, tasselRef, eventRef, eventTick, send, signalRef } = useCeremony({ role, name });

  const [gestureOn, setGestureOn] = useState(true);
  const [banner, setBanner] = useState(null);

  const roster = cstate?.roster || [];
  const currentStudent = roster.find((s) => s.id === cstate?.currentId) || null;

  // My own degree drives my self-view tassel colour. Find my roster entry by name and push it
  // into the cap renderer; it re-applies live whenever the MC changes my degree.
  const myDegree = useMemo(
    () => roster.find((s) => s.name.toLowerCase() === name.toLowerCase())?.degree || 'bachelor',
    [roster, name],
  );
  useEffect(() => {
    setSelfDegree(myDegree);
  }, [myDegree]);

  const amCurrentRef = useRef(false);
  amCurrentRef.current = !!(role === 'student' && currentStudent && currentStudent.name.toLowerCase() === name.toLowerCase());
  const gestureOnRef = useRef(false);
  gestureOnRef.current = isProfessor && cstate?.mode === 'ceremony';

  const getDrawAngle = useCallback(() => (amCurrentRef.current ? tasselRef.current.angle : REST_ANGLE), [tasselRef]);
  const onTassel = useCallback((angle, engaged) => {
    if (gestureOnRef.current) send({ type: 'tassel', angle, engaged });
  }, [send]);
  const onCommit = useCallback(() => {
    if (gestureOnRef.current) send({ type: 'commit' });
  }, [send]);

  // MC needs no camera (phone-friendly); professor + students do.
  const needCamera = isProfessor || role === 'student';
  const { stream: selfStream, status: camStatus, error: camError, arReady, arError, faceOk, handOk, pinching, resetGesture, forceTurnGesture } = useSelfView({
    active: needCamera,
    isHost: isProfessor,
    gestureEnabled: gestureOn,
    turnKey: cstate?.currentId,
    getDrawAngle,
    onTassel,
    onCommit,
  });

  // Video transport: LiveKit (SFU) when configured, else Daily if a room URL is set,
  // else the built-in P2P mesh. Switching is just env vars; the rest of the app is the same.
  const liveKitUrl = import.meta.env.VITE_LIVEKIT_URL;
  const liveKitEnabled = !!liveKitUrl;
  const dailyEnabled = !liveKitEnabled && !!roomUrl;
  const p2pEnabled = !liveKitEnabled && !dailyEnabled;

  const lk = useLiveKit({ enabled: liveKitEnabled, url: liveKitUrl, identity: myId, name, selfStream });
  const daily = useDaily({ roomUrl: dailyEnabled ? roomUrl : '', name, selfStream });
  const p2p = useP2P({ enabled: p2pEnabled, myId, myRole: role, participants, selfStream, send, signalRef });

  const video = liveKitEnabled ? lk : dailyEnabled ? daily : p2p;
  const remote = video.remote;
  const videoCount = video.count;
  const videoError = liveKitEnabled || dailyEnabled ? video.error : null;
  const videoJoined = liveKitEnabled || dailyEnabled ? video.joined : true;

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
    // Professor: drive the controller (its ~25Hz stream would override a backend tween)
    if (isProfessor) {
      forceTurnGesture();
      return;
    }
    // MC (no local controller): tween the tassel over the backend
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
  }, [send, isProfessor, forceTurnGesture]);

  const actions = useMemo(() => ({
    setMode: (mode) => send({ type: 'setMode', mode }),
    next: () => send({ type: 'next' }),
    prev: () => send({ type: 'prev' }),
    select: (id) => send({ type: 'selectStudent', id }),
    reorder: (id, dir) => send({ type: 'reorder', id, dir }),
    addStudent: (s) => send({ type: 'addStudent', ...s }),
    addProfessor: (p) => send({ type: 'addProfessor', ...p }),
    setInfo: (info) => send({ type: 'setInfo', ...info }),
    setDegree: (id, degree) => send({ type: 'updateStudent', id, fields: { degree } }),
    removeStudent: (id) => send({ type: 'removeStudent', id }),
    removeProfessor: (id) => send({ type: 'removeProfessor', id }),
    countdown: (n) => send({ type: 'startCountdown', n }),
    resetTassel: () => {
      if (isProfessor) resetGesture();
      else send({ type: 'resetTassel' });
    },
    commit: () => send({ type: 'commit' }),
    resetAll: () => send({ type: 'resetAll' }),
    manualTurn,
  }), [send, manualTurn, resetGesture, isProfessor]);

  if (!cstate) {
    return <div className="center-msg">{connected ? 'Loading ceremony…' : 'Connecting to ceremony server…'}</div>;
  }

  const roleLabel = role === 'host' ? 'professor + mc' : role;
  const videoLabel = liveKitEnabled
    ? videoError
      ? 'Video error'
      : videoJoined
        ? `LiveKit ${videoCount}`
        : 'LiveKit…'
    : dailyEnabled
      ? videoError
        ? 'Video error'
        : videoJoined
          ? `Video ${videoCount}`
          : 'Video…'
      : `P2P ${p2p.count}`;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🎓 Turning of the Tassel</span>
        <span className={`mode-pill ${cstate.mode}`}>{cstate.mode === 'ceremony' ? 'Ceremony' : 'Gallery'}</span>
        <span className="video-pill" title={videoError || ''}>{videoLabel}</span>
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
          canEditRoster={canEditRoster}
          isProfessor={isProfessor}
          gestureOn={gestureOn}
          setGestureOn={setGestureOn}
          camStatus={camStatus}
          arReady={arReady}
          faceOk={faceOk}
          handOk={handOk}
          pinching={pinching}
        />
      )}

      <Countdown n={cstate.countdown} />
      {banner && <div className="banner">🎓 {banner} — Congratulations! 🎉</div>}

      {needCamera && camStatus !== 'ready' && (
        <div className="cam-hint">{camStatus === 'error' ? `Camera: ${camError}` : 'Starting camera…'}</div>
      )}
      {needCamera && camStatus === 'ready' && arError && (
        <div className="cam-hint">AR cap unavailable: {arError} — video still works.</div>
      )}
      {videoError && <div className="cam-hint">Video error: {videoError}</div>}
    </div>
  );
}
