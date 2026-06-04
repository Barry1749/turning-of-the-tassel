// Mortarboard + tassel rendering. Used three ways:
//   drawScene()      - composite a mirrored camera frame + 3D cap (the self/published view)
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

const BOARD = '#16183b';
const BOARD_EDGE = '#2b2f6b';
const GOLD = '#f2c14e';
const GOLD_DK = '#c9962f';

// Live-tunable placement — adjust with the sliders in the Solo demo while watching your
// camera; values persist in localStorage. Offsets are × the cap scale. The selfie view is
// mirrored, so yaw + roll are sign-flipped here.
export const capConfig = {
  width: 0.85, // cap size (multiplier on the head's rotation-invariant 3D size)
  crownUp: 0.55, // how far above the head pivot the board sits
  crownBack: 0.3, // how far back toward the crown (profile)
  skullHeight: 0.35, // height of the cylindrical crown (bigger = taller cap)
  yawSign: -1, // flip if turning your head moves the cap the wrong way
  pitchSign: 1,
  rollSign: 1,
  // Depth-only head proxy: makes the board/brim visible from OUTSIDE but hidden from INSIDE (your
  // head blocks the underside when you look up, so your face shows instead of a brim over it).
  headHide: true, // turn the occluder on/off
  headScale: 1.0, // head width vs the crown radius (>1 starts to eat the crown wall)
  headLong: 2.0, // how far DOWN it reaches to cover the face (bigger covers more brim)
  headDrop: 0.0, // gap of the proxy's TOP below the board bottom (its top is anchored, not centred)
};
// Expose for live tuning from the browser console, e.g. `capConfig.width = 0.9` (applies
// next frame). Lets you dial size/seat without any UI in the camera code.
if (typeof window !== 'undefined') window.capConfig = capConfig;

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

    // 3D crown anchor: offset up + back from the head pivot in the head's rotated frame,
    // so the cap orbits onto the crown as the head turns (rides on the head, not the face).
    _euler.set(pitch, yaw, roll, 'YXZ');
    _off.set(0, capConfig.crownUp * scale, -capConfig.crownBack * scale).applyEuler(_euler);
    const cx = (1 - cap.nx) * vw + _off.x; // mirror the pivot; offset already in screen space
    const cy = cap.ny * vh - _off.y; // screen y is down, offset y is up

    const r = getSceneRenderer(vw, vh);
    if (r) {
      r.render({
        cx, cy, scale, yaw, pitch, roll, tasselAngle,
        skullHeight: capConfig.skullHeight,
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

export function renderNameCard(canvas, { name = '', flag = '🎓', angle = REST_ANGLE, turned = false }) {
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
    // headHide off here: the name card has no real head/video behind the cap, so an occluder would
    // just punch a transparent hole in the board. Show the board solid instead.
    r.render({ cx, cy: capY, scale, yaw: 0, pitch: 0, roll: 0, tasselAngle: angle, skullHeight: capConfig.skullHeight, headHide: false });
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
