// Optional media-plane integration with Daily.co. When a room URL is provided we join,
// publish the composited self-stream (camera + cap baked in) as the camera input, and
// expose remote participants' video streams keyed by user name. With no room URL the
// app runs in "local mode" (only the self tile is live; others are name cards).
//
// NOTE: this layer requires a Daily account/room to fully exercise and could not be
// run headlessly here. The one API detail to confirm against your Daily version is the
// custom-track publish call (setInputDevicesAsync with a MediaStreamTrack videoSource).
import { useEffect, useRef, useState } from 'react';

export function useDaily({ roomUrl, name, selfStream }) {
  const [remote, setRemote] = useState({});
  const [joined, setJoined] = useState(false);
  const callRef = useRef(null);

  useEffect(() => {
    if (!roomUrl) return undefined;
    let cancelled = false;
    let call;

    (async () => {
      let Daily;
      try {
        Daily = (await import('@daily-co/daily-js')).default;
      } catch (e) {
        console.error('Failed to load Daily SDK', e);
        return;
      }
      call = Daily.createCallObject();
      callRef.current = call;

      const updateRemotes = () => {
        const ps = call.participants();
        const map = {};
        Object.values(ps).forEach((p) => {
          if (p.local) return;
          const vt = p.tracks?.video;
          if (vt?.persistentTrack && (vt.state === 'playable' || vt.state === 'sendable')) {
            map[p.user_name || p.session_id] = { stream: new MediaStream([vt.persistentTrack]) };
          }
        });
        setRemote(map);
      };

      call
        .on('participant-joined', updateRemotes)
        .on('participant-updated', updateRemotes)
        .on('participant-left', updateRemotes)
        .on('joined-meeting', () => {
          setJoined(true);
          updateRemotes();
        });

      try {
        await call.join({ url: roomUrl, userName: name });
        await publishSelf(call, selfStream);
      } catch (e) {
        console.error('Daily join failed', e);
      }
      if (cancelled) {
        call.leave();
      }
    })();

    return () => {
      cancelled = true;
      try {
        call?.leave();
        call?.destroy();
      } catch (e) {
        /* ignore */
      }
      callRef.current = null;
      setJoined(false);
      setRemote({});
    };
  }, [roomUrl, name]);

  // (re)publish the self stream once it (or the join) becomes available
  useEffect(() => {
    if (joined && callRef.current && selfStream) publishSelf(callRef.current, selfStream);
  }, [joined, selfStream]);

  return { remote, joined };
}

async function publishSelf(call, selfStream) {
  if (!call || !selfStream) return;
  const videoTrack = selfStream.getVideoTracks()[0];
  const audioTrack = selfStream.getAudioTracks()[0];
  if (!videoTrack) return;
  try {
    await call.setInputDevicesAsync({ videoSource: videoTrack, audioSource: audioTrack || false });
  } catch (e) {
    console.warn('Daily setInputDevicesAsync failed (verify against your SDK version)', e);
  }
}
