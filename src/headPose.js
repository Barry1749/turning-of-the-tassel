// Convert MediaPipe face landmarks (+ the optional 4x4 facial transformation matrix) into
// a cap transform, in NORMALIZED video coords ([0..1] image space, un-mirrored). The
// renderer mirrors these for the selfie display.
//
// We return a stable HEAD PIVOT (midpoint between the eyes) plus the head orientation
// (yaw/pitch/roll). The renderer offsets the cap up+back from this pivot in the head's
// own rotated frame, so the cap orbits onto the crown in 3D as the head turns.
//
// Scale comes from a 3D landmark distance (forehead<->chin), which is rotation-invariant,
// so the cap doesn't shrink when you turn your head to profile (its 2D width foreshortens,
// but the true 3D distance does not). Yaw/pitch come from the head-pose matrix; roll from
// the landmarks.
import { Matrix4, Euler } from 'three';

const IDX = {
  foreheadTop: 10,
  chin: 152,
  eyeOuterRight: 33,
  eyeOuterLeft: 263,
};

const _m = new Matrix4();
const _e = new Euler(0, 0, 0, 'YXZ');

export function computeCapTransform(lm, matrix) {
  if (!lm) return null;

  const top = lm[IDX.foreheadTop];
  const chin = lm[IDX.chin];
  const er = lm[IDX.eyeOuterRight];
  const el = lm[IDX.eyeOuterLeft];

  const roll = Math.atan2(el.y - er.y, el.x - er.x);

  // rotation-invariant size: 3D forehead<->chin distance (doesn't foreshorten on turn)
  const dz = (top.z || 0) - (chin.z || 0);
  const faceSize3D = Math.hypot(top.x - chin.x, top.y - chin.y, dz) || Math.hypot(top.x - chin.x, top.y - chin.y);

  // Head pivot: midpoint between the eyes (central + stable under rotation).
  const refX = (er.x + el.x) / 2;
  const refY = (er.y + el.y) / 2;

  // Yaw + pitch from the head-pose matrix (column-major 16-float array).
  let yaw = 0;
  let pitch = 0;
  if (matrix && matrix.length >= 16) {
    _m.fromArray(matrix);
    _e.setFromRotationMatrix(_m, 'YXZ');
    pitch = _e.x;
    yaw = _e.y;
  }

  return {
    nx: refX,
    ny: refY,
    nWidth: faceSize3D,
    roll,
    yaw,
    pitch,
  };
}
