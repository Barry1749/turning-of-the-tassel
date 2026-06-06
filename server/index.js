// Ceremony control-plane server: a single in-memory ceremony "room".
// Owns the ordered roster, the spotlighted student, the mode (normal/ceremony) and
// the 3-2-1 countdown, and relays the host's live tassel-angle stream to all clients
// over WebSocket. Daily handles the actual video; this server is pure control + sync.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { AccessToken } from 'livekit-server-sdk';

dotenv.config({ path: '.env.local' });
dotenv.config();

const PORT = process.env.PORT || 3001;
const REST_ANGLE = 1.05; // tassel resting on the right (must match the client)

// degree drives the tassel colour (bachelor | master | phd); the MC can change it per student.
const SAMPLE_ROSTER = ['Mei-Ling Chen', 'Wei Kang', 'Sofia Rossi', 'Arjun Patel'].map((name) => ({
  id: randomUUID(),
  name,
  turned: false,
  degree: 'bachelor',
}));

const state = {
  mode: 'normal', // 'normal' | 'ceremony'
  roster: SAMPLE_ROSTER,
  professors: [], // people who turn the tassel; the MC can add them + share join links
  currentId: null, // spotlighted student
  tassel: { angle: REST_ANGLE, engaged: false },
  countdown: null,
  university: '', // set by the MC at the start of the ceremony
  department: '',
};

const clients = new Map(); // ws -> { id, role, name }

const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  // Sign a LiveKit join token (only if LiveKit credentials are configured).
  if (req.url && req.url.startsWith('/token')) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const room = u.searchParams.get('room') || 'ceremony';
      const identity = u.searchParams.get('identity') || randomUUID();
      const pname = u.searchParams.get('name') || 'Guest';
      const key = process.env.LIVEKIT_API_KEY;
      const secret = process.env.LIVEKIT_API_SECRET;
      if (!key || !secret) {
        res.writeHead(501, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'LiveKit not configured' }));
        return;
      }
      const at = new AccessToken(key, secret, { identity, name: pname });
      at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
      const token = await at.toJwt();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
    return;
  }
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
  // Skip sockets that connected but haven't announced their role yet ('pending'),
  // so a connecting client is never miscounted (e.g. as a guest) before its hello.
  return [...clients.values()]
    .filter((m) => m.role !== 'pending')
    .map(({ id, role, name }) => ({ id, role, name }));
}
// Heartbeat marker: the client's pong (browsers auto-reply) proves it's still there.
function heartbeat() {
  this.isAlive = true;
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
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  // 'pending' until the client's hello says who it is — so it isn't counted yet.
  const meta = { id: randomUUID(), role: 'pending', name: 'Guest' };
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
          state.roster.push({ id: randomUUID(), name: me.name, turned: false, degree: 'bachelor' });
        }
        // auto-add a joining professor to the MC's list (so they can be tracked / re-invited)
        if (
          me.role === 'professor' &&
          me.name &&
          !state.professors.some((p) => p.name.toLowerCase() === me.name.toLowerCase())
        ) {
          state.professors.push({ id: randomUUID(), name: me.name });
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
      // Drag-to-reorder: the MC sends the full new order of student ids. Reorder the
      // roster to match; any student not listed (e.g. one who joined mid-drag) is kept
      // at the end so nobody is dropped.
      case 'reorderStudents': {
        if (!isHost(me) || !Array.isArray(msg.ids)) break;
        const byId = new Map(state.roster.map((s) => [s.id, s]));
        const ordered = msg.ids.map((id) => byId.get(id)).filter(Boolean);
        const missing = state.roster.filter((s) => !msg.ids.includes(s.id));
        state.roster = [...ordered, ...missing];
        broadcastState();
        break;
      }
      case 'addStudent':
        if (!isHost(me)) break;
        state.roster.push({ id: randomUUID(), name: msg.name || 'New Student', turned: false, degree: msg.degree || 'bachelor' });
        broadcastState();
        break;

      case 'setInfo':
        if (!isHost(me)) break;
        if (typeof msg.university === 'string') state.university = msg.university;
        if (typeof msg.department === 'string') state.department = msg.department;
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
      case 'addProfessor':
        if (!isHost(me)) break;
        state.professors.push({ id: randomUUID(), name: msg.name || 'New Professor' });
        broadcastState();
        break;
      case 'removeProfessor':
        if (!isHost(me)) break;
        state.professors = state.professors.filter((p) => p.id !== msg.id);
        broadcastState();
        break;
      // Bulk import from the MC's CSV: one atomic message instead of N add* messages
      // (a 200-person roster is a single broadcast, not 200). Names already present are
      // skipped (case-insensitive), so re-importing the same file is safe.
      case 'importRoster': {
        if (!isHost(me)) break;
        const validDegrees = new Set(['bachelor', 'master', 'phd']);
        const haveStudent = new Set(state.roster.map((s) => s.name.trim().toLowerCase()));
        for (const s of Array.isArray(msg.students) ? msg.students : []) {
          const name = String(s?.name || '').trim();
          const key = name.toLowerCase();
          if (!name || haveStudent.has(key)) continue;
          haveStudent.add(key);
          const degree = validDegrees.has(s?.degree) ? s.degree : 'bachelor';
          state.roster.push({ id: randomUUID(), name, turned: false, degree });
        }
        const haveProf = new Set(state.professors.map((p) => p.name.trim().toLowerCase()));
        for (const p of Array.isArray(msg.professors) ? msg.professors : []) {
          const name = String(p?.name || '').trim();
          const key = name.toLowerCase();
          if (!name || haveProf.has(key)) continue;
          haveProf.add(key);
          state.professors.push({ id: randomUUID(), name });
        }
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

// Reap dead connections every 30s: any socket that missed the previous ping's pong
// is gone (closed tab, dropped network, backgrounded phone). This keeps the
// participant list / guest count honest instead of accumulating zombies.
const HEARTBEAT_MS = 30000;
const heartbeatTimer = setInterval(() => {
  let reaped = false;
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      clients.delete(ws);
      ws.terminate();
      reaped = true;
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  if (reaped) broadcastParticipants();
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeatTimer));

server.listen(PORT, () => {
  console.log(`Ceremony server listening on http://localhost:${PORT}`);
});
