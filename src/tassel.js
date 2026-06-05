// The tassel as a damped pendulum pivoting at the cap button. A small state machine
// turns the gesture (grab -> sweep -> release) into a target angle and a "commit" event.
//   angle > 0  => tassel on the RIGHT (resting / not graduated)
//   angle < 0  => tassel on the LEFT (turned / graduated)
//
// Mapping is RELATIVE: when you pinch we anchor to your hand's position, then a rightward
// sweep of ~SWEEP_DIST of the frame width turns the tassel fully. Commit is judged on
// where the hand swept to at release (not the spring-lagged angle), so a quick flick
// still counts.

export const ANGLE_MAX = 1.05; // ~60 degrees
export const REST_ANGLE = ANGLE_MAX; // rests on the right

const COMMIT = ANGLE_MAX * 0.5; // target must pass this (to the left) to count as turned
const SWEEP_DIST = 0.22; // normalized hand travel (right) for a full turn
const SPAN = REST_ANGLE + ANGLE_MAX; // swing range, REST(+) down to -MAX

const STIFFNESS = 140;
const DAMPING = 24;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class TasselController {
  constructor() {
    this.state = 'idle'; // 'idle' | 'engaged' | 'done'
    this.angle = REST_ANGLE;
    this.vel = 0;
    this.target = REST_ANGLE;
    this.x0 = 0.5;
    this.pendingEvent = null;
  }

  update(g, dt) {
    let event = null;
    if (this.pendingEvent) {
      event = this.pendingEvent;
      this.pendingEvent = null;
    }

    const pinching = !!(g && g.present && g.pinching);

    if (this.state !== 'done') {
      if (pinching) {
        if (this.state !== 'engaged') {
          this.state = 'engaged';
          this.x0 = g.x; // anchor at the grab point
        }
        const delta = g.x - this.x0; // positive = swept right (screen space)
        const progress = clamp(delta / SWEEP_DIST, 0, 1);
        this.target = REST_ANGLE - progress * SPAN; // 0 -> REST, 1 -> -MAX
      } else if (this.state === 'engaged') {
        // released: judge by where the hand swept to (this.target), not the lagged angle
        if (this.target < -COMMIT) {
          this.state = 'done';
          this.target = -ANGLE_MAX;
          event = 'commit';
        } else {
          this.state = 'idle';
          this.target = REST_ANGLE;
        }
      } else {
        this.target = REST_ANGLE;
      }
    } else {
      this.target = -ANGLE_MAX;
    }

    // semi-implicit Euler spring-damper
    const acc = -STIFFNESS * (this.angle - this.target) - DAMPING * this.vel;
    this.vel += acc * dt;
    this.angle += this.vel * dt;

    const lim = ANGLE_MAX * 1.25;
    if (this.angle > lim) {
      this.angle = lim;
      this.vel = 0;
    } else if (this.angle < -lim) {
      this.angle = -lim;
      this.vel = 0;
    }

    return event;
  }

  forceTurn() {
    if (this.state !== 'done') {
      this.state = 'done';
      this.target = -ANGLE_MAX;
      this.pendingEvent = 'commit';
    }
  }

  reset() {
    this.state = 'idle';
    this.target = REST_ANGLE;
    this.angle = REST_ANGLE;
    this.vel = 0;
  }
}
