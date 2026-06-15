// Mortarboard + tassel rendering. Used four ways:
//   drawScene()      - composite a mirrored camera frame + 3D cap (the local self-view)
//   drawFlippedX()   - un-mirror that composite onto a 2nd canvas (the feed published to peers)
//   renderNameCard() - a placeholder card (no video) with a cap, for remote students
//                      whose video isn't present (dev mode / no camera)
//   drawVectorCap()  - a flat fallback if WebGL is unavailable
//
// The cap is a real 3D mortarboard (see cap3d.js) rendered to an offscreen WebGL canvas
// and composited over the video. It's anchored in TRUE 3D: from a head pivot (between the
// eyes) we offset up+back in the head's own rotated frame, so the cap orbits onto the crown
// as the head turns/nods — it rides on the head, not pinned to the face. The same rotation
// drives the cap's orientation, and the tassel swings on its pendulum.
import { Euler, Vector3 } from 'three';
import { REST_ANGLE } from './tassel';
import { createCapRenderer } from './cap3d';

// Cap the per-frame AR pipeline (MediaPipe face/hand inference + the WebGL cap + the 2D composite)
// to this frame rate. requestAnimationFrame fires at the display's refresh — up to 120Hz on a
// ProMotion iPhone — but the published camera stream is only 30fps and a head-worn cap needs no more.
// Running the whole pipeline at 120Hz just burns battery and overheats the device. Both the ceremony
// self-view (useSelfView) and the solo demo gate their loops on this; the tassel physics is fixed-step,
// so it stays smooth no matter the render rate. Lower to 24 to shed even more load.
export const AR_FPS = 30;

const BOARD = '#16183b';
const BOARD_EDGE = '#2b2f6b';
const GOLD = '#f2c14e';
const GOLD_DK = '#c9962f';

// Live-tunable placement — adjust with the sliders in the Solo demo while watching your
// camera; values persist in localStorage. Offsets are × the cap scale. The selfie view is
// mirrored, so yaw + roll are sign-flipped here.
export const capConfig = {
  width: 0.85, // cap size (multiplier on the head's rotation-invariant 3D size)
  crownUp: 0.6, // how far above the head pivot the board sits
  crownBack: 0.3, // how far back toward the crown (profile)
  edgePull: 0.1, // anti-drift: pull the cap back toward frame center by this fraction of its
                  // off-center distance. The cap slides further OUT than your head at the
                  // edges/corners (more left when you're on the left); this counters it. Linear, so
                  // it's nil dead-center and grows toward the edges. 0 = off; raise if it still
                  // drifts out, lower (or go negative) if it now sits too far in.
  skullHeight: 0.35, // height of the cylindrical crown (bigger = taller cap)
  skullThick: 1.0, // overall crown radius (width) multiplier — keep at 1.0 (this is NOT material thickness)
  skullLong: 1.3, // crown oval at FRONTAL view: stretch along nose↔back (a real head is longer front-to-back than ear-to-ear). The self-view bends this with head yaw (see skullLongYaw); name cards use it as-is.
  skullLongYaw: -0.3, // how far skullLong shifts at FULL profile (a ±90° turn), scaled by sin(|yaw|). Negative pulls the oval toward round as you turn — counters the crown looking wider/bigger side-on, so the cap holds its apparent size instead of resizing on a turn; positive exaggerates the front↔back stretch; 0 = no turn response.
  skullWall: 0.02, // crown WALL thickness (material depth) in local units; 0 = paper-thin shell, bigger = chunkier band
  yawSign: -1, // flip if turning your head moves the cap the wrong way
  pitchSign: 1,
  rollSign: 1,
  // Depth-only head proxy: makes the board/brim visible from OUTSIDE but hidden from INSIDE (your
  // head blocks the underside when you look up, so your face shows instead of a brim over it).
  headHide: true, // turn the occluder on/off
  headScale: 1.0, // head width vs the crown radius (>1 starts to eat the crown wall)
  headLong: 1.5, // how far DOWN it reaches to cover the face (bigger covers more brim)
  headDrop: 0.0, // gap of the proxy's TOP below the board bottom (its top is anchored, not centred)
};
// Expose for live tuning from the browser console, e.g. `capConfig.width = 0.9` (applies
// next frame). Lets you dial size/seat without any UI in the camera code.
if (typeof window !== 'undefined') window.capConfig = capConfig;

// Tassel colour by academic degree. A ceremony can mix degrees, so each graduand carries
// their own `degree` in the roster (set by the MC in MCPanel); the cap colours its whole
// tassel + cord to match — bachelors, masters and doctors differ. `bachelor` keeps the
// established undergraduate look. Tunable live, e.g. `degreeTassels.master = '#7a1e3a'`.
export const DEGREE_TASSELS = [
  { id: 'bachelor', label: 'Bachelor', color: '#3a3a42' }, // 學士 — classic undergraduate black
  { id: 'master', label: 'Master', color: '#3a57c8' }, // 碩士 — academic blue
  { id: 'phd', label: 'PhD', color: '#f2c14e' }, // 博士 — gold (the doctoral prestige colour)
];
const degreeTassels = Object.fromEntries(DEGREE_TASSELS.map((d) => [d.id, d.color]));
if (typeof window !== 'undefined') window.degreeTassels = degreeTassels; // live-tunable palette

export function tasselColorFor(degree) {
  return degreeTassels[degree] || degreeTassels.bachelor;
}

// The local wearer's degree drives their self-view tassel colour. CeremonyApp pushes it
// here from the roster (so it updates live when the MC changes it). Name cards instead pass
// their own student's degree straight into renderNameCard().
let selfDegree = 'bachelor';
export function setSelfDegree(degree) {
  selfDegree = degree || 'bachelor';
}

const _euler = new Euler(0, 0, 0, 'YXZ');
const _off = new Vector3();

let sceneRenderer = null;
let sceneTried = false;
let cardRenderer = null;
let cardTried = false;

function getSceneRenderer(w, h) {
  if (!sceneRenderer && !sceneTried) {
    sceneTried = true;
    sceneRenderer = createCapRenderer(w, h);
  }
  if (sceneRenderer) sceneRenderer.resize(w, h);
  return sceneRenderer;
}

function getCardRenderer() {
  if (!cardRenderer && !cardTried) {
    cardTried = true;
    cardRenderer = createCapRenderer(640, 480);
  }
  return cardRenderer;
}

export function drawScene(canvas, video, cap, tasselAngle, gesture) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  if (canvas.width !== vw) canvas.width = vw;
  if (canvas.height !== vh) canvas.height = vh;

  const ctx = canvas.getContext('2d');

  // mirrored camera frame
  ctx.save();
  ctx.translate(vw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();

  if (cap) {
    const scale = cap.nWidth * vw * capConfig.width;
    const yaw = capConfig.yawSign * (cap.yaw || 0);
    const pitch = capConfig.pitchSign * (cap.pitch || 0);
    const roll = capConfig.rollSign * cap.roll;

    // Turning toward profile swings the crown's long (nose↔back) axis into the screen, so a fixed
    // skullLong makes the cap look wider/bigger side-on (this is the apparent "resizing on turn").
    // Hold the cap's overall size and bend skullLong with the yaw instead: sin(|yaw|) is 0 looking
    // straight on (where skullLong is all depth, invisible to width) and 1 at full profile.
    const turn = Math.sin(Math.min(Math.PI / 2, Math.abs(yaw)));
    const skullLong = Math.max(0.3, capConfig.skullLong + capConfig.skullLongYaw * turn);

    // 3D crown anchor: offset up + back from the head pivot in the head's rotated frame,
    // so the cap orbits onto the crown as the head turns (rides on the head, not the face).
    _euler.set(pitch, yaw, roll, 'YXZ');
    _off.set(0, capConfig.crownUp * scale, -capConfig.crownBack * scale).applyEuler(_euler);
    let cx = (1 - cap.nx) * vw + _off.x; // mirror the pivot; offset already in screen space
    let cy = cap.ny * vh - _off.y; // screen y is down, offset y is up

    // Anti-drift: the cap slides further OUT than your head at the edges/corners. Pull it back
    // toward frame center by a fraction of its off-center distance (linear → nil at center, grows
    // toward the edges). Tunable live: capConfig.edgePull. (|| 0 so a missing value can't NaN it.)
    const pull = capConfig.edgePull || 0;
    cx -= pull * (cx - vw / 2);
    cy -= pull * (cy - vh / 2);

    const r = getSceneRenderer(vw, vh);
    if (r) {
      r.setColors({ tassel: tasselColorFor(selfDegree) }); // bachelor / master / phd
      r.render({
        cx, cy, scale, yaw, pitch, roll, tasselAngle,
        skullHeight: capConfig.skullHeight,
        skullThick: capConfig.skullThick,
        skullLong, // yaw-bent (see above); holds apparent size on a turn instead of the oval ballooning
        skullWall: capConfig.skullWall,
        headHide: capConfig.headHide,
        headScale: capConfig.headScale,
        headLong: capConfig.headLong,
        headDrop: capConfig.headDrop,
      });
      ctx.drawImage(r.canvas, 0, 0);
    } else {
      drawVectorCap(ctx, cx, cy, scale, roll, tasselAngle);
    }
  }

  if (gesture && gesture.present && gesture.pinching) {
    ctx.save();
    ctx.fillStyle = 'rgba(242,193,78,0.85)';
    ctx.beginPath();
    ctx.arc(gesture.x * vw, vh * 0.5, Math.max(8, vw * 0.012), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Mirror a finished frame back onto another canvas. The self-view is mirrored (a selfie feels
// natural to the wearer), but remote viewers should see the real, un-mirrored image. We flip
// the WHOLE composite — camera + baked-in cap — as one unit, so the cap stays correctly seated
// on the head; the result is the stream useSelfView publishes to peers.
export function drawFlippedX(dst, src) {
  const w = src.width;
  const h = src.height;
  if (!w || !h) return;
  if (dst.width !== w) dst.width = w;
  if (dst.height !== h) dst.height = h;
  const ctx = dst.getContext('2d');
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

// "Camera off" placeholder painted onto the composite canvas when the wearer turns their video
// off (the Meet-style camera toggle). The captured canvas track keeps flowing, so peers see this
// avatar + label instead of a frozen frame. Self-contained (drawn un-mirrored on both the local
// and published canvases), so it carries no camera pixels and the text never comes out backwards.
export function drawCameraOff(canvas, name = '') {
  const w = canvas.width || 1280;
  const h = canvas.height || 720;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#1b1e44');
  g.addColorStop(1, '#0b0c1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.42;
  const r = Math.min(w, h) * 0.16;

  // avatar disc with the wearer's initial (falls back to a cap glyph when nameless)
  ctx.fillStyle = '#3a3f6e';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  const initial = (name || '').trim().charAt(0).toUpperCase();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${initial ? 'bold ' : ''}${Math.round(r * 1.1)}px system-ui, sans-serif`;
  ctx.fillText(initial || '🎓', cx, cy + r * 0.04);

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${Math.round(h * 0.045)}px system-ui, sans-serif`;
  ctx.fillText('Camera off', cx, cy + r + h * 0.12);
}

export function renderNameCard(canvas, { name = '', flag = '🎓', angle = REST_ANGLE, turned = false, degree = 'bachelor' }) {
  if (canvas.width !== 640) canvas.width = 640;
  if (canvas.height !== 480) canvas.height = 480;
  const ctx = canvas.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, 480);
  g.addColorStop(0, '#1b1e44');
  g.addColorStop(1, '#0b0c1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 480);

  const cx = 320;
  const headY = 250;
  const headR = 78;

  // shoulders
  ctx.fillStyle = '#2a2f5e';
  ctx.beginPath();
  ctx.ellipse(cx, headY + 180, 160, 110, 0, Math.PI, 0);
  ctx.fill();
  // head
  ctx.fillStyle = '#3a3f6e';
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  // 3D cap on top of the head (front-facing, no head pose)
  const capY = headY - headR * 0.95;
  const scale = headR * 2.3 * capConfig.width;
  const r = getCardRenderer();
  if (r) {
    // The card renderer is shared by every name-card tile, so set this student's tassel colour
    // each call (right before render) — consecutive tiles may be different degrees.
    r.setColors({ tassel: tasselColorFor(degree) });
    // headHide off here: the name card has no real head/video behind the cap, so an occluder would
    // just punch a transparent hole in the board. Show the board solid instead.
    r.render({ cx, cy: capY, scale, yaw: 0, pitch: 0, roll: 0, tasselAngle: angle, skullHeight: capConfig.skullHeight, skullThick: capConfig.skullThick, skullLong: capConfig.skullLong, skullWall: capConfig.skullWall, headHide: false });
    ctx.drawImage(r.canvas, 0, 0);
  } else {
    drawVectorCap(ctx, cx, capY, scale, 0, angle);
  }

  // name
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText(flag ? `${flag}  ${name}` : name, cx, 408);
  if (turned) {
    ctx.fillStyle = '#7cfc9b';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('🎓 graduated', cx, 444);
  }
}

// Flat hand-drawn cap — fallback when WebGL is unavailable.
function drawVectorCap(ctx, x, y, width, roll, angle) {
  const w = width;
  const boardH = w * 0.5;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll);

  ctx.fillStyle = BOARD;
  ctx.beginPath();
  ctx.moveTo(-w * 0.26, 0);
  ctx.lineTo(w * 0.26, 0);
  ctx.lineTo(w * 0.2, boardH * 0.55);
  ctx.lineTo(-w * 0.2, boardH * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = BOARD;
  ctx.strokeStyle = BOARD_EDGE;
  ctx.lineWidth = Math.max(2, w * 0.012);
  ctx.beginPath();
  ctx.moveTo(0, -boardH * 0.5);
  ctx.lineTo(w * 0.5, 0);
  ctx.lineTo(0, boardH * 0.5);
  ctx.lineTo(-w * 0.5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.045, 0, Math.PI * 2);
  ctx.fill();

  const Lc = w * 0.62;
  const ex = Math.sin(angle) * Lc;
  const ey = Math.cos(angle) * Lc;
  ctx.strokeStyle = GOLD_DK;
  ctx.lineWidth = Math.max(2, w * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(ex * 0.6, ey * 0.55, ex, ey);
  ctx.stroke();

  ctx.fillStyle = GOLD;
  const headW = w * 0.09;
  const headH = w * 0.1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(ex - headW / 2, ey, headW, headH, 3);
  else ctx.rect(ex - headW / 2, ey, headW, headH);
  ctx.fill();

  ctx.restore();
}
