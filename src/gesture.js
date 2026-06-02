// Turn MediaPipe hand landmarks into a simple gesture signal:
//   - screen x position of the palm (mirrored to match the selfie display)
//   - pinch state (thumb tip <-> index tip), with smoothing + hysteresis
// Returns the last known position when the hand leaves the frame.

const LM = { wrist: 0, thumbTip: 4, indexTip: 8, indexMcp: 5, middleMcp: 9, pinkyMcp: 17 };

const SMOOTH = 0.4; // EMA factor
const PINCH_ON = 0.45; // become pinching below this ratio
const PINCH_OFF = 0.65; // release above this ratio

export function createGestureTracker() {
  let smX = 0.5;
  let smRatio = 1.0;
  let pinching = false;
  let init = false;

  return {
    update(lm) {
      if (!lm) {
        pinching = false; // hand lost == released
        return { present: false, x: smX, pinching: false, pinchRatio: smRatio };
      }

      const wrist = lm[LM.wrist];
      const mMcp = lm[LM.middleMcp];
      const iMcp = lm[LM.indexMcp];
      const pMcp = lm[LM.pinkyMcp];
      const thumb = lm[LM.thumbTip];
      const index = lm[LM.indexTip];

      const handScale = Math.hypot(mMcp.x - wrist.x, mMcp.y - wrist.y) || 1e-3;
      const ratio = Math.hypot(index.x - thumb.x, index.y - thumb.y) / handScale;

      const palmRawX = (wrist.x + iMcp.x + pMcp.x) / 3;
      const screenX = 1 - palmRawX; // mirror to match the selfie view

      if (!init) {
        smX = screenX;
        smRatio = ratio;
        init = true;
      } else {
        smX += SMOOTH * (screenX - smX);
        smRatio += SMOOTH * (ratio - smRatio);
      }

      if (pinching && smRatio > PINCH_OFF) pinching = false;
      else if (!pinching && smRatio < PINCH_ON) pinching = true;

      return { present: true, x: clamp01(smX), pinching, pinchRatio: smRatio };
    },
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
