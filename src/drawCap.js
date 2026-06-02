// Mortarboard + tassel rendering. Used three ways:
//   drawCap()        - low-level: draw a cap at a position/scale/roll with a tassel angle
//   drawScene()      - composite a mirrored camera frame + cap (the self/published view)
//   renderNameCard() - a placeholder card (no video) with a cap, for remote students
//                      whose video isn't present (dev mode / no camera / photo fallback)
import { REST_ANGLE } from './tassel';

const BOARD = '#16183b';
const BOARD_EDGE = '#2b2f6b';
const GOLD = '#f2c14e';
const GOLD_DK = '#c9962f';

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
    const x = (1 - cap.nx) * vw; // mirror to screen space
    const y = cap.ny * vh;
    const width = cap.nWidth * vw;
    const roll = -cap.roll; // mirroring flips the roll sign
    drawCap(ctx, x, y, width, roll, tasselAngle);
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

  // cap on top of the head
  drawCap(ctx, cx, headY - headR * 0.72, headR * 2.3, 0, angle);

  // name + flag
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.fillText(`${flag}  ${name}`, cx, 408);
  if (turned) {
    ctx.fillStyle = '#7cfc9b';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('🎓 graduated', cx, 444);
  }
}

export function drawCap(ctx, x, y, width, roll, angle) {
  const w = width;
  const boardH = w * 0.5;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll);

  // head-band trapezoid
  ctx.fillStyle = BOARD;
  ctx.beginPath();
  ctx.moveTo(-w * 0.26, 0);
  ctx.lineTo(w * 0.26, 0);
  ctx.lineTo(w * 0.2, boardH * 0.55);
  ctx.lineTo(-w * 0.2, boardH * 0.55);
  ctx.closePath();
  ctx.fill();

  // mortarboard (flattened diamond)
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

  // top highlight
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(0, -boardH * 0.5);
  ctx.lineTo(w * 0.5, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  // button
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.045, 0, Math.PI * 2);
  ctx.fill();

  // tassel cord (pivot at button, angle from vertical, + = right)
  const Lc = w * 0.62;
  const ex = Math.sin(angle) * Lc;
  const ey = Math.cos(angle) * Lc;
  ctx.strokeStyle = GOLD_DK;
  ctx.lineWidth = Math.max(2, w * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(ex * 0.6, ey * 0.55, ex, ey);
  ctx.stroke();

  // slider bead
  ctx.fillStyle = GOLD_DK;
  ctx.beginPath();
  ctx.arc(ex * 0.5, ey * 0.5, w * 0.022, 0, Math.PI * 2);
  ctx.fill();

  drawTasselHead(ctx, ex, ey, w);
  ctx.restore();
}

function drawTasselHead(ctx, ex, ey, w) {
  const headW = w * 0.09;
  const headH = w * 0.1;
  const fringeLen = w * 0.16;

  ctx.fillStyle = GOLD;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(ex - headW / 2, ey, headW, headH, 3);
  else ctx.rect(ex - headW / 2, ey, headW, headH);
  ctx.fill();

  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(1.5, w * 0.008);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const fx = ex - headW / 2 + (i / (n - 1)) * headW;
    ctx.beginPath();
    ctx.moveTo(fx, ey + headH);
    ctx.lineTo(fx, ey + headH + fringeLen);
    ctx.stroke();
  }
}
