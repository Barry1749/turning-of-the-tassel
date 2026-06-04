// A real 3D mortarboard (Taiwan 學士帽 / square academic cap) built with three.js and
// rendered to an offscreen canvas in screen space, so the 2D pipeline can drawImage() it
// over the (mirrored) video.
//
// render() takes screen-space placement (cx, cy, scale in px) + head orientation
// (yaw/pitch/roll, radians) + the tassel swing angle.
//
// It's black like a real undergraduate cap: a large flat square board on a shallow fabric
// crown, a covered button, and a soft tassel. The cord is pinned at the centre button and
// rests across the top of the board to the rim; only the part PAST the edge is a live soft
// pendulum that hangs and sways under gravity. The cord is just long enough to reach a corner
// and let the bunch dangle off it — so the tassel always "hangs by the edge", left or right.
// The rim anchor rides the front of the board (right corner -> front -> left corner) as the
// tassel is turned, so the flip is smooth and never jams. The bunch's individual strands are
// each their own little Verlet chain, so they flare out and sway on their own.
import * as THREE from 'three';
import { ANGLE_MAX } from './tassel';

const BOARD_COLOR = 0x141418; // black mortarboard
const SKULL_COLOR = 0x0e0e12; // black fabric crown
const TASSEL_COLOR = 0x3a3a42; // dark tassel (undergraduate = black)

const BOARD_SIZE = 1; // local units; the whole group is scaled to fit the head
const BOARD_THICK = 0.05;
const SKULL_R = BOARD_SIZE * 0.34; // crown (skull) cylinder radius
const BOARD_TOP = BOARD_THICK / 2; // top face of the board — the cord rests on this
const HALF_DIAG = BOARD_SIZE * Math.SQRT1_2; // centre -> corner of the 45°-rotated board
const PIN = new THREE.Vector3(0, BOARD_THICK * 1.25, 0); // button top: the cord's anchor
const CORD_RADIUS = 0.009; // visual thickness of the cord

// the hanging bunch: a crown where the strands gather, then many fine strands
const CROWN_H = 0.06; // crown height (cord end -> where the strands attach)
const RING_R = 0.04; // radius the strands attach around the crown bottom
const STRAND_N = 18; // number of strands
const STRAND_SEG = 2; // segments per strand (so each strand bends, not just swings)
const STRAND_PTS = STRAND_SEG + 1;
const STRAND_ITER = 8; // constraint passes per strand per step

// --- soft-tassel tuning — live-editable via window.tasselConfig ---------------------------
const HANG_N = 9; // particles in the hanging (past-the-edge) part of the cord
const tasselConfig = {
  // Length is "only long enough to hang by the edge": reach the corner (~HALF_DIAG) plus a
  // small drop so the bunch clears the rim and dangles. Same length works left or right.
  cordLen: HALF_DIAG + 0.12,
  gravity: 60, // pull strength (local units / s^2)
  damp: 0.9, // velocity kept per step (lower = more air-drag, settles sooner)
  iterations: 14, // constraint relaxation passes per step (the cord)
  strandLen: 0.35, // length of the hanging strands
  flare: 0, // outward push that splays the strands (0 = they hang straight down)
  crownScale: 0.6, // size of the bunch's head (the bound crown) + how tightly the strands gather
};
if (typeof window !== 'undefined') window.tasselConfig = tasselConfig;

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _iq = new THREE.Quaternion();
const _g = new THREE.Vector3(); // local-space gravity direction (unit)
const _tan = new THREE.Vector3(); // direction of the cord's last segment (the hang)
const _seg = new THREE.Vector3();
const _crownPos = new THREE.Vector3(); // crown bottom, where the strands attach
const _crownQuat = new THREE.Quaternion(); // crown frame (its -Y points down the cord)
const _root = new THREE.Vector3();
const _flareDir = new THREE.Vector3();

// deterministic per-strand jitter (no Math.random — keeps renders reproducible)
function pseudo(i) {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

// Where the cord crosses the board rim, as a function of side ∈ [-1,1]: +1 = right corner
// (rest), 0 = front corner, -1 = left corner. It rides the two FRONT edges of the diamond,
// so as the tassel is turned it sweeps around the rim and always hangs off an edge.
function rimAnchor(side, out) {
  const s = side < -1 ? -1 : side > 1 ? 1 : side;
  const H = HALF_DIAG;
  if (s >= 0) out.set(H * s, BOARD_TOP, H * (1 - s)); // right corner -> front corner
  else out.set(H * s, BOARD_TOP, H * (1 + s)); // front corner -> left corner
}

export function createCapRenderer(width = 640, height = 480) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // so we can drawImage() the result onto the 2D canvas
    });
  } catch (e) {
    return null; // no WebGL in this environment
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-0.6, 1.0, 0.7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88a0ff, 0.3);
  fill.position.set(0.6, 0.2, -0.5);
  scene.add(fill);

  const cap = new THREE.Group();
  scene.add(cap);

  const boardMat = new THREE.MeshStandardMaterial({ color: BOARD_COLOR, roughness: 0.55, metalness: 0.08 });
  const tasselMat = new THREE.MeshStandardMaterial({ color: TASSEL_COLOR, roughness: 0.8, metalness: 0.0 });

  // The crown is a hollow open-ended tube (see skullGeo) with FrontSide back-face culling, so you
  // never see its interior. It still reads SOLID via a depth-only back-face twin (skullDepth, below)
  // that occludes whatever is behind it without drawing the interior.
  const skullMat = new THREE.MeshStandardMaterial({
    color: SKULL_COLOR,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.FrontSide, // cull interior faces so you never see inside the cap
  });

  // large flat square board — rotated 45° so a CORNER points forward (worn like a diamond)
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE, BOARD_THICK, BOARD_SIZE), boardMat);
  board.rotation.y = Math.PI / 4;
  cap.add(board);

  // cylindrical crown (straight sides, not a bowl) sitting on the head, under the board.
  // Unit-height geometry with its TOP at the local origin, so scale.y grows it DOWNWARD;
  // the height is driven live by capConfig.skullHeight (passed to render()).
  const skullGeo = new THREE.CylinderGeometry(SKULL_R, SKULL_R, 1, 32, 1, true); // open-ended: no caps
  skullGeo.translate(0, -0.5, 0);
  const skull = new THREE.Mesh(skullGeo, skullMat);
  skull.position.y = -BOARD_THICK / 2; // top tucks just under the board
  skull.scale.y = 0.5;
  cap.add(skull);

  // FrontSide makes the crown see-through where its wall faces away — so looking up you'd see the
  // board's underside THROUGH the open tube. Fix: a depth-only back-face twin of the crown. It
  // writes DEPTH for the tube's far/inner wall (occluding the board behind it, so the band reads
  // solid) but draws no COLOR (so you still never see the hollow interior). renderOrder -1 so its
  // depth is laid down before the board, which then fails the depth test where the crown covers it.
  // polygonOffset nudges this twin's depth slightly BEHIND the visible crown so the two coincident
  // surfaces don't z-fight (flicker); it still occludes the board, which sits farther back.
  const skullDepthMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  // CLOSED cylinder (with end caps) so it also occludes the board through the open top/bottom of the
  // visible crown — otherwise the board leaks through where the tube is open.
  const skullDepthGeo = new THREE.CylinderGeometry(SKULL_R, SKULL_R, 1, 32);
  skullDepthGeo.translate(0, -0.5, 0);
  const skullDepth = new THREE.Mesh(skullDepthGeo, skullDepthMat);
  skullDepth.position.y = -BOARD_THICK / 2;
  skullDepth.scale.y = 0.5;
  skullDepth.renderOrder = -1;
  cap.add(skullDepth);

  // covered button at the board centre — the tassel cord is pinned to its top
  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(BOARD_SIZE * 0.045, BOARD_SIZE * 0.045, BOARD_THICK * 1.3, 18),
    boardMat,
  );
  button.position.y = BOARD_THICK * 0.6;
  cap.add(button);

  // --- soft tassel ------------------------------------------------------------------------
  // The cord lives directly in the cap's local frame. Two parts:
  //   1. an on-board span button(PIN) -> rim(anchor), resting on the board (deterministic)
  //   2. a Verlet pendulum hanging off the rim, simulated under gravity (the soft, swaying
  //      part). Only this part moves, so turning the tassel can never fold/jam the cord.
  const hang = []; // hang[0] is pinned to the rim anchor; the rest swing
  const hangPrev = [];
  for (let i = 0; i < HANG_N; i++) {
    hang.push(new THREE.Vector3());
    hangPrev.push(new THREE.Vector3());
  }

  const _C = new THREE.Vector3(); // current rim anchor
  const _A = new THREE.Vector3(); // mid on-board point (rests the cord onto the board)

  // length of cord left to hang past the rim (total minus the on-board span)
  function hangLen() {
    const onBoard = Math.hypot(_C.x - PIN.x, _C.y - PIN.y, _C.z - PIN.z);
    return Math.max(0.04, tasselConfig.cordLen - onBoard);
  }

  // lay the pendulum straight down from the rim anchor — startup + blow-up recovery
  function seedHang(side) {
    rimAnchor(side, _C);
    const seg = hangLen() / (HANG_N - 1);
    for (let i = 0; i < HANG_N; i++) {
      hang[i].set(_C.x, _C.y - seg * i, _C.z);
      hangPrev[i].copy(hang[i]);
    }
  }
  seedHang(1);

  // The crown frame: its origin sits where the strands attach (just below the cord's end),
  // and _crownQuat maps local DOWN -> the cord's hang direction, so "down the strands" follows
  // the cord. Recomputed from the cord's last segment.
  function crownFrame() {
    const end = hang[HANG_N - 1];
    _tan.subVectors(end, hang[HANG_N - 2]);
    if (_tan.lengthSq() < 1e-9) _tan.copy(DOWN);
    else _tan.normalize();
    _crownQuat.setFromUnitVectors(DOWN, _tan);
    _crownPos.copy(end).addScaledVector(_tan, CROWN_H * tasselConfig.crownScale); // strands attach below the crown
  }

  // each strand: its own little Verlet chain, rooted on the crown ring, hanging + flaring
  const strands = [];
  for (let i = 0; i < STRAND_N; i++) {
    strands.push({
      az: (i / STRAND_N) * Math.PI * 2 + pseudo(i + 13) * 0.25, // ring angle (jittered)
      lenK: 0.82 + pseudo(i) * 0.36, // per-strand length multiplier
      flareK: 0.6 + pseudo(i + 97) * 0.8, // per-strand flare multiplier
      pts: Array.from({ length: STRAND_PTS }, () => new THREE.Vector3()),
      prev: Array.from({ length: STRAND_PTS }, () => new THREE.Vector3()),
    });
  }

  // place a strand's root on the crown ring at its azimuth; also set _flareDir (outward unit)
  function strandRoot(s, out) {
    out.set(Math.cos(s.az), 0, Math.sin(s.az));
    _flareDir.copy(out).applyQuaternion(_crownQuat); // outward direction in the crown frame
    out.multiplyScalar(RING_R * tasselConfig.crownScale).applyQuaternion(_crownQuat).add(_crownPos);
  }

  function seedStrands() {
    crownFrame();
    for (const s of strands) {
      strandRoot(s, _root);
      const seg = (tasselConfig.strandLen * s.lenK) / STRAND_SEG;
      for (let k = 0; k < STRAND_PTS; k++) {
        s.pts[k].set(_root.x, _root.y - seg * k, _root.z);
        s.prev[k].copy(s.pts[k]);
      }
    }
  }
  seedStrands();

  // step every strand once: root pinned to its ring point, free points fall under gravity
  // plus an outward flare push, then relax to keep each segment's length.
  function stepStrands(h) {
    const G = tasselConfig.gravity;
    const damp = tasselConfig.damp;
    const flare = tasselConfig.flare;
    const h2 = h * h;
    crownFrame();
    for (const s of strands) {
      strandRoot(s, _root); // sets _root and _flareDir
      const fk = flare * s.flareK;
      const ax = _g.x * G + _flareDir.x * fk;
      const ay = _g.y * G + _flareDir.y * fk;
      const az = _g.z * G + _flareDir.z * fk;
      const seg = (tasselConfig.strandLen * s.lenK) / STRAND_SEG;
      const p = s.pts;
      const pr = s.prev;
      p[0].copy(_root);
      pr[0].copy(_root);
      for (let k = 1; k < STRAND_PTS; k++) {
        const pk = p[k];
        const prk = pr[k];
        const vx = (pk.x - prk.x) * damp;
        const vy = (pk.y - prk.y) * damp;
        const vz = (pk.z - prk.z) * damp;
        prk.copy(pk);
        pk.x += vx + ax * h2;
        pk.y += vy + ay * h2;
        pk.z += vz + az * h2;
      }
      for (let it = 0; it < STRAND_ITER; it++) {
        p[0].copy(_root);
        for (let k = 0; k < STRAND_PTS - 1; k++) {
          const a = p[k];
          const b = p[k + 1];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dz = b.z - a.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - seg) / d;
          if (k === 0) {
            b.x -= dx * diff; b.y -= dy * diff; b.z -= dz * diff;
          } else {
            dx *= diff * 0.5; dy *= diff * 0.5; dz *= diff * 0.5;
            a.x += dx; a.y += dy; a.z += dz;
            b.x -= dx; b.y -= dy; b.z -= dz;
          }
        }
      }
    }
  }

  // advance the hanging pendulum by one fixed sub-step (anchor follows the rim; the bunch
  // lags as the anchor moves, so the tassel swings during a turn and as the head moves).
  function stepHang(h, side) {
    const G = tasselConfig.gravity;
    const damp = tasselConfig.damp;
    rimAnchor(side, _C);
    const seg = hangLen() / (HANG_N - 1);
    const h2 = h * h;

    hang[0].copy(_C);
    hangPrev[0].copy(_C);
    for (let i = 1; i < HANG_N; i++) {
      const p = hang[i];
      const pr = hangPrev[i];
      const vx = (p.x - pr.x) * damp;
      const vy = (p.y - pr.y) * damp;
      const vz = (p.z - pr.z) * damp;
      pr.copy(p);
      p.x += vx + _g.x * G * h2;
      p.y += vy + _g.y * G * h2;
      p.z += vz + _g.z * G * h2;
    }

    const iters = tasselConfig.iterations;
    for (let k = 0; k < iters; k++) {
      hang[0].copy(_C);
      for (let i = 0; i < HANG_N - 1; i++) {
        const a = hang[i];
        const b = hang[i + 1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - seg) / d;
        if (i === 0) {
          // the rim anchor can't move — push all the correction onto b
          b.x -= dx * diff; b.y -= dy * diff; b.z -= dz * diff;
        } else {
          dx *= diff * 0.5; dy *= diff * 0.5; dz *= diff * 0.5;
          a.x += dx; a.y += dy; a.z += dz;
          b.x -= dx; b.y -= dy; b.z -= dz;
        }
      }
    }
  }

  function stepAll(h, side) {
    stepHang(h, side);
    stepStrands(h);
  }

  // persistent control points for the cord tube: [PIN, A, C, hang[1..HANG_N-1]]
  const ctrl = [];
  for (let i = 0; i < HANG_N + 2; i++) ctrl.push(new THREE.Vector3());
  const cordCurve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);

  const cord = new THREE.Mesh(new THREE.BufferGeometry(), tasselMat);
  cord.frustumCulled = false;
  cap.add(cord);

  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), tasselMat);
  cap.add(bead);

  // crown (the bound head of the bunch) — narrow at the cord, widening toward the strands
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.05, CROWN_H, 14), tasselMat);
  cap.add(crown);

  // strand segments: two tapered cylinders per strand, repositioned each frame (no realloc)
  const segGeoTop = new THREE.CylinderGeometry(0.0042, 0.005, 1, 5); // root -> mid
  const segGeoBot = new THREE.CylinderGeometry(0.0028, 0.0042, 1, 5); // mid -> tip
  const strandSegs = [];
  for (let i = 0; i < STRAND_N; i++) {
    for (let k = 0; k < STRAND_SEG; k++) {
      const m = new THREE.Mesh(k === 0 ? segGeoTop : segGeoBot, tasselMat);
      m.frustumCulled = false;
      cap.add(m);
      strandSegs.push(m);
    }
  }

  // orient a unit-Y cylinder to span a->b (its taper's +Y end points toward b)
  function placeSeg(mesh, a, b) {
    _seg.subVectors(b, a);
    const len = _seg.length();
    if (len < 1e-6) {
      mesh.scale.set(1, 1e-4, 1);
      return;
    }
    mesh.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
    _seg.multiplyScalar(1 / len);
    mesh.quaternion.setFromUnitVectors(UP, _seg);
    mesh.scale.set(1, len, 1);
  }

  // rebuild the cord tube, re-seat the bead, and re-place the crown + every strand segment
  function syncMeshes() {
    _A.set((PIN.x + _C.x) / 2, BOARD_TOP + CORD_RADIUS, (PIN.z + _C.z) / 2); // rests on board
    ctrl[0].copy(PIN);
    ctrl[1].copy(_A);
    ctrl[2].copy(_C);
    for (let i = 1; i < HANG_N; i++) ctrl[2 + i].copy(hang[i]);

    const geo = new THREE.TubeGeometry(cordCurve, ctrl.length * 3, CORD_RADIUS, 6, false);
    cord.geometry.dispose();
    cord.geometry = geo;

    // slider bead, a third of the way from the button to the rim
    bead.position.set(
      PIN.x + (_C.x - PIN.x) * 0.33,
      BOARD_TOP + CORD_RADIUS,
      PIN.z + (_C.z - PIN.z) * 0.33,
    );

    crownFrame();
    // crown: narrow end at the cord's end, widening down toward the strands; crownScale sets
    // the head size (and the ring the strands gather on, via crownFrame/strandRoot).
    const cs = tasselConfig.crownScale;
    crown.position.copy(hang[HANG_N - 1]).addScaledVector(_tan, CROWN_H * cs * 0.5);
    crown.quaternion.copy(_crownQuat);
    crown.scale.setScalar(cs);

    let m = 0;
    for (const s of strands) {
      for (let k = 0; k < STRAND_SEG; k++) placeSeg(strandSegs[m++], s.pts[k], s.pts[k + 1]);
    }
  }

  // pre-settle (rest state, head upright) so the first frame already hangs + flares right
  _g.set(0, -1, 0);
  for (let i = 0; i < 70; i++) stepAll(1 / 120, 1);
  syncMeshes();

  function place(cx, cy, scale) {
    const D = 6;
    const hH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * D;
    const hW = hH * camera.aspect;
    const ndcX = (cx / canvas.width) * 2 - 1;
    const ndcY = 1 - (cy / canvas.height) * 2;
    cap.position.set(ndcX * hW, ndcY * hH, -D);
    const s = (scale * hW * 2) / (canvas.width * BOARD_SIZE);
    cap.scale.setScalar(s);
  }

  let lastT = 0;
  let accT = 0;

  return {
    canvas,
    render({ cx, cy, scale, yaw = 0, pitch = 0, roll = 0, tasselAngle = 0, skullHeight = 0.5 }) {
      place(cx, cy, scale);
      cap.rotation.set(pitch, yaw, roll, 'YXZ');
      skull.scale.y = skullHeight; // taller/shorter crown, live-tunable
      skullDepth.scale.y = skullHeight; // depth twin follows the crown

      // gravity points to true screen-"down", expressed in the cap's local frame so head
      // tilt makes the tassel sway instead of dragging it around rigidly.
      _iq.copy(cap.quaternion).invert();
      _g.copy(DOWN).applyQuaternion(_iq).normalize();

      // which rim: + = right (rest), - = left (turned); magnitude eases the sweep across
      const side = THREE.MathUtils.clamp(tasselAngle / ANGLE_MAX, -1, 1);

      // fixed-step integration, decoupled from the (variable) frame rate
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      let dt = lastT ? (now - lastT) / 1000 : 0;
      lastT = now;
      if (dt > 0.1) dt = 0.1; // don't try to catch up across a long stall
      accT += dt;
      const h = 1 / 120;
      let steps = 0;
      while (accT >= h && steps < 8) {
        stepAll(h, side);
        accT -= h;
        steps++;
      }
      if (!Number.isFinite(hang[HANG_N - 1].x) || !Number.isFinite(strands[0].pts[STRAND_PTS - 1].x)) {
        seedHang(side); // recover from any blow-up
        seedStrands();
      }
      syncMeshes();

      renderer.render(scene, camera);
    },
    resize(w, h) {
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    setColors({ board: b, tassel: t } = {}) {
      if (b != null) boardMat.color.set(b);
      if (t != null) tasselMat.color.set(t);
    },
    dispose() {
      cord.geometry.dispose();
      segGeoTop.dispose();
      segGeoBot.dispose();
      renderer.dispose();
    },
  };
}
