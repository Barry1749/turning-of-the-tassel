// Convert MediaPipe face landmarks (+ the optional 4x4 facial transformation matrix) into
// a cap transform, in NORMALIZED video coords ([0..1] image space, un-mirrored). The
// renderer mirrors these for the selfie display.
//
// We return a stable HEAD PIVOT (midpoint between the eyes) plus the head orientation
// (yaw/pitch/roll). The renderer offsets the cap up+back from this pivot in the head's
// own rotated frame, so the cap orbits onto the crown in 3D as the head turns.
//
// Scale must track the true DISTANCE to the camera (nearer = bigger cap) but NOT change when
// you merely rotate your head. We size from the OUTER-EYE span (33<->263), along the head's
// local X (horizontal) axis: a NOD is a rotation ABOUT that axis, so the eye span does not
// foreshorten when you tip up/down — the cap holds its size on a nod. (Forehead<->chin, used
// before, leans forward, and the lean made the pitch correction asymmetric — up grew, down
// shrank. The eye corners are symmetric at equal depth, so their axis is cleanly horizontal.)
// The eye span DOES foreshorten on a turn (yaw); we divide that out from the head-pose matrix.
//
// The eye span is shorter than the old forehead<->chin span AND is width-normalized while the
// old span was height-normalized (drawCap multiplies by video WIDTH), so a fixed rescale can't
// match the old on-screen size across camera aspect ratios. Instead we CALIBRATE the rescale
// from the face itself: while near-frontal (both spans honest) we learn forehead<->chin / eye,
// which bakes in the aspect ratio for free, then size the (nod-invariant) eye span by it — so
// the cap lands at exactly the old size with no re-tuning. Yaw/pitch from the matrix; roll
// from the landmarks.
import { Matrix4, Euler } from 'three';

const IDX = {
  foreheadTop: 10,
  chin: 152,
  eyeOuterRight: 33,
  eyeOuterLeft: 263,
};

const _m = new Matrix4();
const _e = new Euler(0, 0, 0, 'YXZ');

// Cap-size calibration — live-tunable from the browser console as `window.capSize`.
// Normally `ratio` is LEARNED automatically (the resting forehead<->chin / eye-span ratio, in
// normalized coords so it carries the image aspect ratio): it snaps to the real value on the
// first near-frontal frame, then tracks slowly. To size by hand instead, set
// `capSize.autoCalibrate = false` and then set `capSize.ratio`. (For everyday "bigger/smaller"
// just use `capConfig.width` — it multiplies on top of this and is the normal size knob.)
const capSize = {
  autoCalibrate: true, // learn the size ratio from your face while you're near-frontal
  ratio: 3.0,          // current size ratio — read it live; write it after autoCalibrate=false
  pitchGate: 0.12,     // |pitch| (radians) below which a frame counts as "frontal" for learning
  ema: 0.05,           // how fast the learned ratio tracks (0 = frozen, 1 = instant but jittery)
};
if (typeof window !== 'undefined') window.capSize = capSize;

let restCalibrated = false;

export function computeCapTransform(lm, matrix) {
  if (!lm) return null;

  const top = lm[IDX.foreheadTop];
  const chin = lm[IDX.chin];
  const er = lm[IDX.eyeOuterRight];
  const el = lm[IDX.eyeOuterLeft];

  const roll = Math.atan2(el.y - er.y, el.x - er.x);

  // Eye span (local-X axis): immune to nodding; foreshortens only on a turn (corrected below).
  const eyeSpan2D = Math.hypot(el.x - er.x, el.y - er.y);
  // Forehead<->chin span: used ONLY to calibrate the resting size ratio when near-frontal.
  const faceSpan2D = Math.hypot(top.x - chin.x, top.y - chin.y);

  // Head pivot: midpoint between the eyes (central + stable under rotation).
  const refX = (er.x + el.x) / 2;
  const refY = (er.y + el.y) / 2;

  // Yaw + pitch from the head-pose matrix (column-major 16-float array), plus the
  // foreshortening of the eye (local-X) axis so a turn doesn't resize the cap.
  let yaw = 0;
  let pitch = 0;
  let foreshorten = 1;
  if (matrix && matrix.length >= 16) {
    _m.fromArray(matrix);
    _e.setFromRotationMatrix(_m, 'YXZ');
    pitch = _e.x;
    yaw = _e.y;
    // Column 0 is the head's local +X axis in camera space; its camera-Z component is how far
    // the eye line tilts out of the image plane on a turn. A segment along it projects to
    // sqrt(1 - axisZ^2) of its true length. (Normalize in case the matrix carries scale.)
    const xx = matrix[0], xy = matrix[1], xz = matrix[2];
    const len = Math.hypot(xx, xy, xz) || 1;
    const axisZ = xz / len;
    foreshorten = Math.sqrt(Math.max(0.25, 1 - axisZ * axisZ)); // clamp: never amplify >2x
  }

  // Yaw-corrected eye span: constant under ANY pure rotation, scales with real distance.
  const eyeSize = eyeSpan2D / foreshorten;

  // Calibrate restRatio only when near-frontal in PITCH (forehead<->chin foreshortens on a nod;
  // it's invariant to yaw/roll, and eyeSize is already yaw-corrected, so only pitch must be
  // small). Snap on the first good frame for an instantly-correct size, then track slowly. The
  // ratio is distance-invariant (both spans scale together), so leaning in/out doesn't disturb it.
  if (capSize.autoCalibrate && eyeSize > 1e-4 && Math.abs(pitch) < capSize.pitchGate && Math.abs(yaw) < 0.5) {
    const ratio = faceSpan2D / eyeSize;
    if (ratio > 1.2 && ratio < 4.5) {
      if (!restCalibrated) { capSize.ratio = ratio; restCalibrated = true; }
      else capSize.ratio += capSize.ema * (ratio - capSize.ratio);
    }
  }

  // Final size: nod-invariant eye size scaled to the old forehead<->chin magnitude.
  const faceSize = eyeSize * capSize.ratio;

  return {
    nx: refX,
    ny: refY,
    nWidth: faceSize,
    roll,
    yaw,
    pitch,
  };
}
