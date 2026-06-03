// Ceremony control-plane server: a single in-memory ceremony "room".
// Owns the ordered roster, the spotlighted student, the mode (normal/ceremony) and
// the 3-2-1 countdown, and relays the host's live tassel-angle stream to all clients
// over WebSocket. Daily handles the actual video; this server is pure control + sync.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3001;
const REST_ANGLE = 1.05; // tassel resting on the right (must match the client)

const SAMPLE_ROSTER = [
  { name: 'Mei-Ling Chen', university: 'ETH Zürich', country: 'Switzerland', countryCode: 'CH' },
  { name: 'Wei Kang', university: 'University of Tokyo', country: 'Japan', countryCode: 'JP' },
  { name: 'Sofia Rossi', university: 'TU Delft', country: 'Netherlands', countryCode: 'NL' },
  { name: 'Arjun Patel', university: 'UC Berkeley', country: 'United States', countryCode: 'US' },
].map((s) => ({ id: randomUUID(), turned: false, ...s }));

const state = {
  mode: 'normal', // 'normal' | 'ceremony'
  roster: SAMPLE_ROSTER,
  currentId: null, // spotlighted student
  tassel: { angle: REST_ANGLE, engaged: false },
  countdown: null,
};

const clients = new Map(); // ws -> { id, role, name }

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.url === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state, participants: participantList() }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Turning of the Tassel - ceremony server OK');
});

const wss = new WebSocketServer({ server });

function participantList() {
  return [...clients.values()].map(({ id, role, name }) => ({ id, role, name }));
}
function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients.keys()) if (ws.readyState === ws.OPEN) ws.send(msg);
}
function broadcastState() {
  broadcast({ type: 'state', state });
}
function broadcastParticipants() {
  broadcast({ type: 'participants', participants: participantList() });
}
function sendToId(targetId, obj) {
  for (const [ws, m] of clients) {
    if (m.id === targetId) {
      send(ws, obj);
      return;
    }
  }
}
// Controllers (MC / professor / combined host) may send ceremony commands.
const isHost = (m) => m && (m.role === 'host' || m.role === 'professor' || m.role === 'mc');
const orderedIds = () => state.roster.map((s) => s.id);

function setCurrentByOffset(offset) {
  const ids = orderedIds();
  if (ids.length === 0) {
    state.currentId = null;
    return;
  }
  let idx = ids.indexOf(state.currentId);
  if (idx === -1) idx = offset > 0 ? -1 : ids.length;
  idx = Math.min(ids.length - 1, Math.max(0, idx + offset));
  state.currentId = ids[idx];
  state.tassel = { angle: REST_ANGLE, engaged: false };
}

let countdownTimer = null;
function startCountdown(n) {
  clearInterval(countdownTimer);
  state.countdown = n;
  broadcastState();
  countdownTimer = setInterval(() => {
    state.countdown -= 1;
    if (state.countdown <= 0) {
      clearInterval(countdownTimer);
      state.countdown = null;
    }
    broadcastState();
  }, 1000);
}

wss.on('connection', (ws) => {
  const meta = { id: randomUUID(), role: 'guest', name: 'Guest' };
  clients.set(ws, meta);
  send(ws, { type: 'welcome', id: meta.id, state });
  broadcastParticipants();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const me = clients.get(ws);
    if (!me) return;

    switch (msg.type) {
      case 'hello': {
        me.role = msg.role || 'guest';
        me.name = msg.name || me.name;
        // auto-add a joining student to the program so they can be spotlighted/turned
        if (
          me.role === 'student' &&
          me.name &&
          !state.roster.some((s) => s.name.toLowerCase() === me.name.toLowerCase())
        ) {
          state.roster.push({
            id: randomUUID(),
            name: me.name,
            university: '',
            country: '',
            countryCode: '',
            turned: false,
          });
        }
        send(ws, { type: 'welcome', id: me.id, state });
        broadcastParticipants();
        broadcastState();
        break;
      }

      // ---- host-only controls ----
      case 'setMode': {
        if (!isHost(me)) break;
        state.mode = msg.mode === 'ceremony' ? 'ceremony' : 'normal';
        if (state.mode === 'ceremony' && !state.currentId) {
          const first = state.roster.find((s) => !s.turned) || state.roster[0];
          state.currentId = first ? first.id : null;
        }
        state.tassel = { angle: REST_ANGLE, engaged: false };
        broadcastState();
        break;
      }
      case 'selectStudent':
        if (!isHost(me)) break;
        if (state.roster.some((s) => s.id === msg.id)) {
          state.currentId = msg.id;
          state.tassel = { angle: REST_ANGLE, engaged: false };
          broadcastState();
        }
        break;
      case 'next':
        if (!isHost(me)) break;
        setCurrentByOffset(+1);
        broadcastState();
        break;
      case 'prev':
        if (!isHost(me)) break;
        setCurrentByOffset(-1);
        broadcastState();
        break;
      case 'reorder': {
        if (!isHost(me)) break;
        const i = state.roster.findIndex((s) => s.id === msg.id);
        const j = i + (msg.dir === 'up' ? -1 : 1);
        if (i !== -1 && j >= 0 && j < state.roster.length) {
          [state.roster[i], state.roster[j]] = [state.roster[j], state.roster[i]];
          broadcastState();
        }
        break;
      }
      case 'addStudent':
        if (!isHost(me)) break;
        state.roster.push({
          id: randomUUID(),
          name: msg.name || 'New Student',
          university: msg.university || '',
          country: msg.country || '',
          countryCode: msg.countryCode || '',
          turned: false,
        });
        broadcastState();
        break;
      case 'removeStudent':
        if (!isHost(me)) break;
        state.roster = state.roster.filter((s) => s.id !== msg.id);
        if (state.currentId === msg.id) state.currentId = null;
        broadcastState();
        break;
      case 'updateStudent': {
        if (!isHost(me)) break;
        const s = state.roster.find((x) => x.id === msg.id);
        if (s) Object.assign(s, msg.fields || {});
        broadcastState();
        break;
      }
      case 'startCountdown':
        if (!isHost(me)) break;
        startCountdown(Math.max(1, msg.n || 3));
        break;
      case 'tassel': {
        // high-frequency stream from the host; relay a lightweight message
        if (!isHost(me)) break;
        state.tassel = { angle: msg.angle, engaged: !!msg.engaged };
        broadcast({
          type: 'tassel',
          angle: msg.angle,
          engaged: !!msg.engaged,
          studentId: state.currentId,
        });
        break;
      }
      case 'commit': {
        if (!isHost(me)) break;
        const s = state.roster.find((x) => x.id === (msg.id || state.currentId));
        if (s) s.turned = true;
        broadcast({ type: 'event', event: 'celebrate', studentId: s ? s.id : state.currentId });
        broadcastState();
        break;
      }
      case 'resetTassel':
        if (!isHost(me)) break;
        state.tassel = { angle: REST_ANGLE, engaged: false };
        broadcast({ type: 'tassel', angle: REST_ANGLE, engaged: false, studentId: state.currentId });
        break;

      // WebRTC signaling relay between two peers (any role)
      case 'signal':
        if (msg.to && msg.data) sendToId(msg.to, { type: 'signal', from: me.id, data: msg.data });
        break;

      case 'resetAll':
        if (!isHost(me)) break;
        state.roster.forEach((s) => {
          s.turned = false;
        });
        state.mode = 'normal';
        state.currentId = null;
        state.tassel = { angle: REST_ANGLE, engaged: false };
        state.countdown = null;
        clearInterval(countdownTimer);
        broadcastState();
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastParticipants();
  });
});

server.listen(PORT, () => {
  console.log(`Ceremony server listening on http://localhost:${PORT}`);
});
