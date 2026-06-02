// Convert MediaPipe face landmarks into a cap transform, in NORMALIZED video coords
// ([0..1] image space, un-mirrored). The renderer mirrors these for the selfie display.

const IDX = {
  foreheadTop: 10,
  chin: 152,
  cheekRight: 234, // image-right edge of the face
  cheekLeft: 454, // image-left edge of the face
  eyeOuterRight: 33,
  eyeOuterLeft: 263,
};

export function computeCapTransform(lm) {
  if (!lm) return null;

  const top = lm[IDX.foreheadTop];
  const chin = lm[IDX.chin];
  const cr = lm[IDX.cheekRight];
  const cl = lm[IDX.cheekLeft];
  const er = lm[IDX.eyeOuterRight];
  const el = lm[IDX.eyeOuterLeft];

  const centerX = (cr.x + cl.x) / 2;
  const faceWidth = Math.hypot(cl.x - cr.x, cl.y - cr.y);
  const faceHeight = Math.abs(chin.y - top.y) || faceWidth;
  const roll = Math.atan2(el.y - er.y, el.x - er.x);

  // Sit the board above the forehead, offset along the head's "up" direction so it
  // tilts with the head.
  const lift = faceHeight * 0.55;
  const anchorX = centerX + Math.sin(roll) * lift;
  const anchorY = top.y - Math.cos(roll) * lift;

  return {
    nx: anchorX,
    ny: anchorY,
    nWidth: faceWidth * 1.55,
    roll,
  };
}
