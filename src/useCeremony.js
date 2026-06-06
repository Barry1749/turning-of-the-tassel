// Client hook for the ceremony control plane. Connects to the WebSocket backend,
// mirrors the authoritative ceremony state, exposes a send() for commands, and keeps
// the high-frequency tassel stream in a ref (so canvases can read it every frame
// without triggering React re-renders).
//
// Identity comes from the server, not the URL: we send our access token on connect and the
// server replies with the role + name it resolves the token to (or `unauthorized`). So the
// client can't pick its own role/name — editing the link just yields an unknown token.
import { useCallback, useEffect, useRef, useState } from 'react';
import { REST_ANGLE } from './tassel';

const WS_URL = (() => {
  // ?ws=wss://... overrides everything (e.g. a deployed app pointed at a tunnel)
  const override = new URLSearchParams(location.search).get('ws');
  if (override) return override;
  // Production (static host) must set this to the deployed wss:// server.
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  // Dev / tunnel: reach the server same-origin at /ws (Vite proxies it to :3001).
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
})();

export function useCeremony({ token, enabled = true }) {
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState(null);
  const [myRole, setMyRole] = useState(null); // resolved from the token by the server
  const [myName, setMyName] = useState(null);
  const [authError, setAuthError] = useState(false); // token missing / unknown → locked out
  const [cstate, setCstate] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [eventTick, setEventTick] = useState(0);

  const tasselRef = useRef({ angle: REST_ANGLE, engaged: false, studentId: null });
  const eventRef = useRef(null);
  const signalRef = useRef(null); // P2P signaling handler, set by useP2P
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
        ws.send(JSON.stringify({ type: 'hello', token }));
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
          // The post-hello welcome carries our resolved identity; the initial one doesn't.
          if (msg.role) {
            setMyRole(msg.role);
            setAuthError(false);
          }
          if (msg.name) setMyName(msg.name);
          setCstate(msg.state);
          tasselRef.current = { ...msg.state.tassel, studentId: msg.state.currentId };
        } else if (msg.type === 'unauthorized') {
          setAuthError(true);
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
        } else if (msg.type === 'signal') {
          signalRef.current?.({ from: msg.from, data: msg.data });
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
  }, [enabled, token]);

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  return { connected, myId, myRole, myName, authError, cstate, participants, tasselRef, eventRef, eventTick, send, signalRef };
}
