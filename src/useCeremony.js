// Client hook for the ceremony control plane. Connects to the WebSocket backend,
// mirrors the authoritative ceremony state, exposes a send() for commands, and keeps
// the high-frequency tassel stream in a ref (so canvases can read it every frame
// without triggering React re-renders).
import { useCallback, useEffect, useRef, useState } from 'react';
import { REST_ANGLE } from './tassel';

const WS_URL = (() => {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.hostname}:3001`;
})();

export function useCeremony({ role, name, enabled = true }) {
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState(null);
  const [cstate, setCstate] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [eventTick, setEventTick] = useState(0);

  const tasselRef = useRef({ angle: REST_ANGLE, engaged: false, studentId: null });
  const eventRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let closed = false;
    let retry;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'hello', role, name }));
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          setMyId(msg.id);
          setCstate(msg.state);
          tasselRef.current = { ...msg.state.tassel, studentId: msg.state.currentId };
        } else if (msg.type === 'state') {
          setCstate(msg.state);
          tasselRef.current = { ...msg.state.tassel, studentId: msg.state.currentId };
        } else if (msg.type === 'participants') {
          setParticipants(msg.participants);
        } else if (msg.type === 'tassel') {
          tasselRef.current = { angle: msg.angle, engaged: msg.engaged, studentId: msg.studentId };
        } else if (msg.type === 'event') {
          eventRef.current = msg;
          setEventTick((t) => t + 1);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [enabled, role, name]);

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  return { connected, myId, cstate, participants, tasselRef, eventRef, eventTick, send };
}
