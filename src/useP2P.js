// Free peer-to-peer mesh video, signaled over the existing WebSocket server.
// Each on-camera participant connects to every other on-camera participant; guests
// connect to on-camera participants to watch. No third-party service / account.
//
// Notes: STUN handles most home networks; a free public TURN relay is included for
// restrictive networks (best-effort). Mesh suits a small on-camera group.
import { useEffect, useRef, useState } from 'react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const ON_CAMERA = ['student', 'professor', 'host'];
const onCam = (role) => ON_CAMERA.includes(role);

export function useP2P({ enabled, myId, myRole, participants, selfStream, send, signalRef }) {
  const [remote, setRemote] = useState({}); // peerId -> { stream }
  const S = useRef({ pcs: {}, senders: {}, pending: {} });
  const ctx = useRef({});
  ctx.current = { myId, myRole, selfStream, send };

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
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    delete S.current.pcs[peerId];
    delete S.current.senders[peerId];
    delete S.current.pending[peerId];
    setRemote((r) => {
      if (!r[peerId]) return r;
      const n = { ...r };
      delete n[peerId];
      return n;
    });
  }

  function makePc(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    S.current.pcs[peerId] = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) ctx.current.send({ type: 'signal', to: peerId, data: { candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      setRemote((r) => ({ ...r, [peerId]: { stream } }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanupPeer(peerId);
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
    ctx.current.send({ type: 'signal', to: peerId, data: { sdp: pc.localDescription } });
  }

  async function onSignal({ from, data }) {
    const St = S.current;
    try {
      let pc = St.pcs[from];
      if (data.sdp) {
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

  // push our stream into every connection once it's available
  useEffect(() => {
    Object.keys(S.current.pcs).forEach((peerId) => attachLocal(peerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfStream]);

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
    };
  }, []);

  return { remote, count: Object.keys(remote).length };
}
