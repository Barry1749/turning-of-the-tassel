// Free peer-to-peer mesh video, signaled over the existing WebSocket server.
// Each on-camera participant connects to every other on-camera participant; guests
// connect to on-camera participants to watch. No third-party service / account.
//
// Notes: STUN handles most home networks; restrictive / symmetric-NAT networks need a TURN relay,
// configured via env (see .env.example) — the old bundled free relay is dead. Mesh suits a small
// on-camera group.
import { useEffect, useRef, useState } from 'react';
import { qualitySpec, DEFAULT_QUALITY } from './videoQuality';

// STUN is free and account-less; it suffices when at least one peer is behind a friendly (cone)
// NAT. But when a peer is behind a SYMMETRIC NAT (common on mobile / carrier-grade NAT / many
// campus + ISP networks) STUN can't help and the media MUST be relayed through a TURN server.
// The old bundled free relay (openrelay.metered.ca) is dead — it now hands back zero relay
// candidates — so TURN is brought in from the environment: use a free metered.ca tier,
// Cloudflare/Twilio, or self-hosted coturn. See .env.example for the exact vars.
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Read TURN servers from the build-time env, accepting two forms (first one present wins):
//   1) VITE_ICE_SERVERS — a JSON array of RTCIceServer objects (paste your provider's whole list).
//   2) VITE_TURN_URLS (comma/space-separated) + VITE_TURN_USERNAME + VITE_TURN_CREDENTIAL.
// With neither set the app runs STUN-only: fine on friendly NATs, but symmetric-NAT peers can't
// connect across the internet (you'd see "P2P 0").
function turnFromEnv() {
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch {
      console.warn('[p2p] VITE_ICE_SERVERS is not valid JSON — ignoring it');
    }
  }
  const urls = (import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || '')
    .split(/[,\s]+/)
    .filter(Boolean);
  const username = import.meta.env.VITE_TURN_USERNAME;
  const credential = import.meta.env.VITE_TURN_CREDENTIAL;
  if (urls.length && username && credential) return [{ urls, username, credential }];
  return [];
}

const TURN_SERVERS = turnFromEnv();
if (!TURN_SERVERS.length) {
  console.warn(
    '[p2p] No TURN relay configured (set VITE_TURN_* or VITE_ICE_SERVERS — see .env.example). ' +
      'Participants behind a symmetric NAT will fail to connect across the internet.',
  );
}

// ICE servers for a new connection. A room-wide override (state.turnServer, set by the MC in the
// panel when the built-in relay is offline) wins over the env/build default. `host` may carry an
// explicit :port; otherwise the standard 3478 is assumed, and the same trio every relay setup in
// coturn/ exposes (stun + turn/udp + turn/tcp) is derived from it.
function iceServersFor(turn) {
  if (turn && turn.host) {
    const hp = turn.host.includes(':') ? turn.host : `${turn.host}:3478`;
    const auth = { username: turn.username || '', credential: turn.credential || '' };
    return [
      ...STUN_SERVERS,
      { urls: `stun:${hp}` },
      { urls: `turn:${hp}`, ...auth },
      { urls: `turn:${hp}?transport=tcp`, ...auth },
    ];
  }
  return [...STUN_SERVERS, ...TURN_SERVERS];
}

const ON_CAMERA = ['student', 'professor', 'host'];
const onCam = (role) => ON_CAMERA.includes(role);

// Push WebRTC toward crisp, full-resolution video instead of its conservative defaults: lift the
// bitrate cap to the chosen quality's budget, forbid resolution downscaling, and — if the link
// tightens — shed frame rate rather than sharpness. Best-effort: getParameters can race the first
// negotiation, so any throw is safely ignored. Called after setLocalDescription (encodings exist by
// then) and again whenever the host changes quality, since replaceTrack keeps the old cap otherwise.
async function tuneVideoSender(sender, maxBitrate) {
  if (!sender) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) return;
    for (const enc of params.encodings) {
      enc.maxBitrate = maxBitrate; // per the host-chosen quality (SD / HD / Full HD)
      enc.scaleResolutionDownBy = 1; // never shrink the frame
    }
    params.degradationPreference = 'maintain-resolution'; // drop FPS, not resolution
    await sender.setParameters(params);
  } catch {
    /* best effort — defaults still apply */
  }
}

export function useP2P({ enabled, myId, myRole, participants, selfStream, send, signalRef, quality = DEFAULT_QUALITY, turn = null }) {
  const [remote, setRemote] = useState({}); // peerId -> { stream }
  const S = useRef({ pcs: {}, senders: {}, pending: {}, born: {}, synth: {} });
  const ctx = useRef({});
  ctx.current = { myId, myRole, selfStream, send, quality, turn };

  function attachLocal(peerId) {
    const stream = ctx.current.selfStream;
    const senders = S.current.senders[peerId];
    if (!senders || !stream) return;
    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];
    if (vt && senders.v) senders.v.replaceTrack(vt).catch(() => {});
    if (at && senders.a) senders.a.replaceTrack(at).catch(() => {});
  }

  function cleanupPeer(peerId) {
    const pc = S.current.pcs[peerId];
    // Unregister BEFORE closing: close() fires connectionstatechange('closed'), and the handler
    // uses "am I still the tracked pc?" to tell an intentional teardown from a real failure.
    delete S.current.pcs[peerId];
    delete S.current.senders[peerId];
    delete S.current.pending[peerId];
    delete S.current.born[peerId];
    delete S.current.synth[peerId];
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    setRemote((r) => {
      if (!r[peerId]) return r;
      const n = { ...r };
      delete n[peerId];
      return n;
    });
  }

  function makePc(peerId) {
    const pc = new RTCPeerConnection({ iceServers: iceServersFor(ctx.current.turn) });
    S.current.pcs[peerId] = pc;
    S.current.born[peerId] = Date.now(); // for the stuck-connection check in the reconcile tick
    pc.onicecandidate = (e) => {
      if (e.candidate) ctx.current.send({ type: 'signal', to: peerId, data: { candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => {
      // Tracks are attached with replaceTrack() on bare transceivers, so they arrive with NO
      // stream association (e.streams is empty) — never discard them for that. Collect loose
      // tracks into one synthesized per-peer stream; use the labeled stream when present.
      let stream = e.streams[0];
      if (!stream) {
        stream = S.current.synth[peerId] || (S.current.synth[peerId] = new MediaStream());
        stream.addTrack(e.track);
      }
      setRemote((r) => ({ ...r, [peerId]: { stream } }));
    };
    pc.onconnectionstatechange = () => {
      if (S.current.pcs[peerId] !== pc) return; // already replaced/torn down intentionally
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanupPeer(peerId);
        // Self-heal: only the lower id sends offers. If the dead link was ours to start, the
        // reconcile tick below re-initiates; otherwise ask the initiator to start over.
        if (ctx.current.myId > peerId) ctx.current.send({ type: 'signal', to: peerId, data: { reoffer: true } });
      }
    };
    return pc;
  }

  async function initiate(peerId) {
    const pc = makePc(peerId);
    const dir = onCam(ctx.current.myRole) ? 'sendrecv' : 'recvonly';
    const vTx = pc.addTransceiver('video', { direction: dir });
    const aTx = pc.addTransceiver('audio', { direction: dir });
    S.current.senders[peerId] = { v: vTx.sender, a: aTx.sender };
    attachLocal(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    tuneVideoSender(vTx.sender, qualitySpec(ctx.current.quality).maxBitrate);
    ctx.current.send({ type: 'signal', to: peerId, data: { sdp: pc.localDescription } });
  }

  async function onSignal({ from, data }) {
    const St = S.current;
    try {
      let pc = St.pcs[from];
      if (data.sdp) {
        // A fresh OFFER while we already hold a pc for this peer means the peer rebuilt its side
        // (failure recovery). Only the lower id ever sends offers, so this can't collide with an
        // outstanding offer of our own — replace our stale pc and answer the new one.
        if (data.sdp.type === 'offer' && pc) {
          cleanupPeer(from);
          pc = null;
        }
        if (!pc) pc = makePc(from);
        await pc.setRemoteDescription(data.sdp);
        // flush any ICE candidates that arrived before the description
        const queued = St.pending[from] || [];
        St.pending[from] = [];
        for (const c of queued) {
          try {
            await pc.addIceCandidate(c);
          } catch {
            /* ignore */
          }
        }
        if (data.sdp.type === 'offer') {
          const tx = pc.getTransceivers();
          const vTx = tx.find((t) => t.receiver?.track?.kind === 'video') || tx[0];
          const aTx = tx.find((t) => t.receiver?.track?.kind === 'audio') || tx[1];
          const dir = onCam(ctx.current.myRole) ? 'sendrecv' : 'recvonly';
          if (vTx) vTx.direction = dir;
          if (aTx) aTx.direction = dir;
          St.senders[from] = { v: vTx?.sender, a: aTx?.sender };
          attachLocal(from);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          tuneVideoSender(vTx?.sender, qualitySpec(ctx.current.quality).maxBitrate);
          ctx.current.send({ type: 'signal', to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch {
            /* ignore */
          }
        } else {
          (St.pending[from] = St.pending[from] || []).push(data.candidate);
        }
      } else if (data.reoffer) {
        // The peer's side of the link died and it can't send offers (higher id) — rebuild ours.
        if (St.pcs[from]) cleanupPeer(from);
        if (ctx.current.myId < from) initiate(from);
      }
    } catch (e) {
      console.warn('p2p signal error', e);
    }
  }

  // register the incoming-signal handler
  useEffect(() => {
    if (!enabled || !signalRef) return undefined;
    signalRef.current = onSignal;
    return () => {
      if (signalRef) signalRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // reconcile connections when the participant set changes
  const peerList = participants
    .filter((p) => p.id !== myId && (onCam(p.role) || onCam(myRole)))
    .map((p) => p.id);
  const peerKey = [...peerList].sort().join(',');
  ctx.current.peerList = peerList; // the reconcile tick below reads the latest roster from here

  useEffect(() => {
    if (!enabled || !myId) return undefined;
    const wanted = new Set(peerList);
    Object.keys(S.current.pcs).forEach((id) => {
      if (!wanted.has(id)) cleanupPeer(id);
    });
    // the lexicographically smaller id initiates (avoids glare)
    peerList.forEach((id) => {
      if (!S.current.pcs[id] && myId < id) initiate(id);
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, peerKey, myId]);

  // Self-heal. A dropped link (wifi blip, phone lock, tunnel hiccup) is cleaned up above, but with
  // an UNCHANGED roster nothing re-initiates — the room would sit at "P2P 0" until someone joins or
  // leaves. So sweep on a slow tick: re-initiate any wanted-but-missing connection (initiator side),
  // and rebuild connections stuck mid-negotiation (a lost offer/answer leaves 'new'/'connecting'
  // forever — WebRTC raises no failure event for those).
  const STUCK_MS = 15000; // relay negotiation legitimately takes a few seconds; 15s is well past it
  useEffect(() => {
    if (!enabled || !myId) return undefined;
    const tick = setInterval(() => {
      const now = Date.now();
      (ctx.current.peerList || []).forEach((id) => {
        const pc = S.current.pcs[id];
        if (pc) {
          const stuck =
            (pc.connectionState === 'new' || pc.connectionState === 'connecting') &&
            now - (S.current.born[id] || now) > STUCK_MS;
          if (!stuck) return;
          cleanupPeer(id);
          if (ctx.current.myId > id) {
            ctx.current.send({ type: 'signal', to: id, data: { reoffer: true } });
            return;
          }
        }
        if (!S.current.pcs[id] && ctx.current.myId < id) initiate(id);
      });
    }, 4000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, myId]);

  // push our stream into every connection once it's available
  useEffect(() => {
    Object.keys(S.current.pcs).forEach((peerId) => attachLocal(peerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfStream]);

  // Re-apply encoding params when the host changes broadcast quality. The running senders keep the
  // old bitrate cap across the stream swap (replaceTrack preserves parameters), so walk them and
  // lift/lower the cap to the new target; the resolution itself follows the freshly-captured stream.
  useEffect(() => {
    const max = qualitySpec(quality).maxBitrate;
    Object.values(S.current.senders).forEach((s) => tuneVideoSender(s?.v, max));
  }, [quality]);

  // teardown
  useEffect(() => {
    const store = S.current;
    return () => {
      Object.values(store.pcs).forEach((pc) => {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      });
      store.pcs = {};
      store.senders = {};
      store.pending = {};
      store.born = {};
      store.synth = {};
    };
  }, []);

  return { remote, count: Object.keys(remote).length };
}
