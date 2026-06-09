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
import MediaControls from './MediaControls';
import Countdown from './Countdown';

export default function CeremonyApp({ token, roomUrl, onLeave }) {
  // Identity is resolved by the server from our token (never the URL), so we read it back from
  // the hook rather than from props. role/name are null until the server's welcome arrives. We
  // always connect — a bare URL (no token) is the MC; the server decides who a token admits.
  const { connected, myId, myRole, myName, authError, cstate, participants, tasselRef, eventRef, eventTick, send, signalRef } = useCeremony({ token });
  const role = myRole;
  const name = myName;
  const identified = !!role; // we know who we are → safe to start camera / join video

  const isProfessor = role === 'professor' || role === 'host'; // performs the gesture (camera)
  const canEditRoster = role === 'mc' || role === 'host'; // edits the program order
  const isController = role === 'mc' || role === 'professor' || role === 'host';

  const [gestureOn, setGestureOn] = useState(true);
  const [banner, setBanner] = useState(null);
  const [titleDraft, setTitleDraft] = useState(null); // non-null only while the MC is editing the ceremony title

  const roster = cstate?.roster || [];
  const currentStudent = roster.find((s) => s.id === cstate?.currentId) || null;
  const guestCount = participants.filter((p) => p.role === 'guest').length; // watch-only; counted, not listed

  // My own degree drives my self-view tassel colour. Find my roster entry by name and push it
  // into the cap renderer; it re-applies live whenever the MC changes my degree.
  const myDegree = useMemo(
    () => (name ? roster.find((s) => s.name.toLowerCase() === name.toLowerCase())?.degree : null) || 'bachelor',
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
  const { stream: selfStream, selfCanvas, publishStream, status: camStatus, error: camError, arReady, arError, faceOk, handOk, pinching, resetGesture, forceTurnGesture, camOn, micOn, hasMic, toggleCam, toggleMic } = useSelfView({
    active: needCamera,
    isHost: isProfessor,
    gestureEnabled: gestureOn,
    turnKey: cstate?.currentId,
    getDrawAngle,
    onTassel,
    onCommit,
    name,
  });

  // Video transport. When LiveKit (SFU) is configured we run a HYBRID: default to the free P2P
  // mesh and let the SERVER promote the whole room to LiveKit once the headcount outgrows the mesh
  // (cstate.videoMode is server-authoritative, so every client flips together — no split-brain).
  // With no LiveKit configured we keep the original behaviour: Daily if a room URL is set, else
  // pure P2P. The hooks below are always mounted; only `enabled` flips, so the active one connects
  // and the other tears down at the switch.
  const liveKitUrl = import.meta.env.VITE_LIVEKIT_URL;
  const liveKitConfigured = !!liveKitUrl;
  const dailyEnabled = !liveKitConfigured && !!roomUrl;
  const liveKitEnabled = liveKitConfigured && cstate?.videoMode === 'livekit';
  const p2pEnabled = !liveKitEnabled && !dailyEnabled;

  // Publish the un-mirrored composite so remote peers see the real image; our own tile keeps
  // the mirrored `selfStream` (passed to Gallery/Spotlight below).
  // Hold off connecting any transport until the server has told us who we are.
  const lk = useLiveKit({ enabled: liveKitEnabled && identified, url: liveKitUrl, identity: myId, name, selfStream: publishStream });
  const daily = useDaily({ roomUrl: dailyEnabled && identified ? roomUrl : '', name, selfStream: publishStream });
  const p2p = useP2P({ enabled: p2pEnabled && identified, myId, myRole: role, participants, selfStream: publishStream, send, signalRef });

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
    if (ev?.event === 'resetTassel') {
      // Reset OUR controller — only the professor has a live one, and its stream is what would
      // otherwise re-assert the committed angle over the server's reset.
      if (isProfessor) resetGesture();
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
    selectProfessor: (id) => send({ type: 'selectProfessor', id }),
    reorderStudents: (ids) => send({ type: 'reorderStudents', ids }),
    addStudent: (s) => send({ type: 'addStudent', ...s }),
    addProfessor: (p) => send({ type: 'addProfessor', ...p }),
    setTitle: (title) => send({ type: 'setTitle', title }),
    setDegree: (id, degree) => send({ type: 'updateStudent', id, fields: { degree } }),
    removeStudent: (id) => send({ type: 'removeStudent', id }),
    removeProfessor: (id) => send({ type: 'removeProfessor', id }),
    importRoster: (payload) => send({ type: 'importRoster', ...payload }),
    countdown: (n) => send({ type: 'startCountdown', n }),
    resetTassel: () => {
      // The server is authoritative — reset there so every viewer (and late joiners) snap back,
      // even when the host has no camera/controller. Also reset the professor's local controller
      // so its ~25Hz stream doesn't immediately re-assert the committed angle over the reset.
      if (isProfessor) resetGesture();
      send({ type: 'resetTassel' });
    },
    commit: () => send({ type: 'commit' }),
    resetAll: () => send({ type: 'resetAll' }),
    manualTurn,
  }), [send, manualTurn, resetGesture, isProfessor]);

  // The server rejected our token (unknown or revoked). The bare URL is the MC and never lands
  // here — this is only reached by a tampered or expired participant link.
  if (authError) {
    return (
      <div className="join">
        <div className="join-card">
          <h1>🎓 Turning of the Tassel</h1>
          <p className="sub">This invite link isn't valid.</p>
          <p className="note">
            Ask the host (Master of Ceremony) for a new personal link — each one is unique to you
            and can't be edited or shared.
          </p>
          <button type="button" className="primary" onClick={onLeave}>OK</button>
        </div>
      </div>
    );
  }
  if (!cstate || !identified) {
    return <div className="center-msg">{connected ? 'Joining…' : 'Connecting to ceremony server…'}</div>;
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

  // The brand in the top bar IS the ceremony title — the MC/host edits it inline. Commit on
  // blur/Enter, and only when it actually changed; an empty title falls back to the app name.
  const saveTitle = () => {
    if (titleDraft === null) return; // wasn't editing
    const title = titleDraft.trim();
    setTitleDraft(null);
    if (title && title !== (cstate.title || '')) actions.setTitle(title);
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          🎓{' '}
          {canEditRoster ? (
            <input
              className="brand-edit"
              value={titleDraft ?? (cstate.title || '')}
              placeholder="Ceremony title"
              title="Click to rename the ceremony"
              onChange={(e) => setTitleDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          ) : (
            cstate.title || 'Turning of the Tassel'
          )}
        </span>
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
        selfCanvas={selfCanvas}
        remote={remote}
        tasselRef={tasselRef}
      />

      {isController && (
        <MCPanel
          cstate={cstate}
          actions={actions}
          canEditRoster={canEditRoster}
          guestCount={guestCount}
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

      {needCamera && camStatus === 'ready' && (
        <MediaControls
          camOn={camOn}
          micOn={micOn}
          hasMic={hasMic}
          onToggleCam={toggleCam}
          onToggleMic={toggleMic}
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
