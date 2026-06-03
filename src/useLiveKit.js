// SFU video via LiveKit (open-source; LiveKit Cloud now, self-hosted later). Active when
// VITE_LIVEKIT_URL is set; otherwise the app falls back to the built-in P2P mesh. The
// Node server signs join tokens at /token. Remote streams are keyed by participant
// identity, which we set to the ceremony participant id so the tiles line up.
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, setLogLevel } from 'livekit-client';

// Quiet LiveKit's verbose "connection state changed / signal connecting" info logs.
setLogLevel('warn');

function tokenUrl(room, identity, name) {
  const base = import.meta.env.VITE_WS_URL
    ? import.meta.env.VITE_WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '')
    : '';
  const q = `room=${encodeURIComponent(room)}&identity=${encodeURIComponent(identity)}&name=${encodeURIComponent(name)}`;
  return `${base}/token?${q}`;
}

async function publishLocal(room, stream, pub) {
  if (!room || !stream) return;
  const lp = room.localParticipant;
  const vt = stream.getVideoTracks()[0];
  const at = stream.getAudioTracks()[0];
  try {
    if (vt && !pub.video) {
      await lp.publishTrack(vt, { simulcast: true, name: 'camera' });
      pub.video = true;
    }
    if (at && !pub.audio) {
      await lp.publishTrack(at, { name: 'mic' });
      pub.audio = true;
    }
  } catch (e) {
    console.warn('LiveKit publish failed', e);
  }
}

export function useLiveKit({ enabled, url, room = 'ceremony', identity, name, selfStream }) {
  const [remote, setRemote] = useState({});
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState(null);
  const roomRef = useRef(null);
  const published = useRef({ video: false, audio: false });
  const ctx = useRef({});
  ctx.current = { selfStream };

  useEffect(() => {
    if (!enabled || !url || !identity) return undefined;
    let cancelled = false;
    let rm;

    const rebuild = (participant) => {
      const tracks = [];
      participant.trackPublications.forEach((pub) => {
        if (pub.track?.mediaStreamTrack) tracks.push(pub.track.mediaStreamTrack);
      });
      setRemote((r) => ({ ...r, [participant.identity]: { stream: new MediaStream(tracks) } }));
    };
    const drop = (participant) => {
      setRemote((r) => {
        if (!r[participant.identity]) return r;
        const n = { ...r };
        delete n[participant.identity];
        return n;
      });
    };

    (async () => {
      try {
        const res = await fetch(tokenUrl(room, identity, name || 'Guest'));
        const body = await res.text();
        if (!res.ok) throw new Error(`token ${res.status}: ${body.slice(0, 140)}`);
        let token;
        try {
          token = JSON.parse(body).token;
        } catch {
          throw new Error(`token response not JSON: ${body.slice(0, 80)}`);
        }
        if (cancelled) return;

        rm = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = rm;
        rm
          .on(RoomEvent.TrackSubscribed, (_t, _p, participant) => rebuild(participant))
          .on(RoomEvent.TrackUnsubscribed, (_t, _p, participant) => rebuild(participant))
          .on(RoomEvent.ParticipantDisconnected, (participant) => drop(participant))
          .on(RoomEvent.Disconnected, () => setJoined(false));

        await rm.connect(url, token);
        if (cancelled) {
          rm.disconnect();
          return;
        }
        setJoined(true);
        published.current = { video: false, audio: false };
        await publishLocal(rm, ctx.current.selfStream, published.current);
        rm.remoteParticipants.forEach((p) => rebuild(p));
      } catch (e) {
        if (!cancelled) {
          console.error('LiveKit error:', e);
          setError(e?.message || String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        rm?.disconnect();
      } catch {
        /* ignore */
      }
      roomRef.current = null;
      published.current = { video: false, audio: false };
      setJoined(false);
      setRemote({});
    };
  }, [enabled, url, identity, room, name]);

  // publish our stream once it (or the connection) becomes available
  useEffect(() => {
    if (roomRef.current && selfStream) publishLocal(roomRef.current, selfStream, published.current);
  }, [selfStream]);

  return { remote, joined, error, count: Object.keys(remote).length };
}
