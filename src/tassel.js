// The tassel as a damped pendulum pivoting at the cap button. A small state machine
// turns the gesture (grab -> sweep -> release) into a target angle and a "commit" event.
//   angle > 0  => tassel on the RIGHT (resting / not graduated)
//   angle < 0  => tassel on the LEFT (turned / graduated)

export const ANGLE_MAX = 1.05; // ~60 degrees
export const REST_ANGLE = ANGLE_MAX; // rests on the right
const COMMIT = ANGLE_MAX * 0.6; // must cross this far left to count as "turned"

const STIFFNESS = 90;
const DAMPING = 14;

export class TasselController {
  constructor() {
    this.state = 'idle'; // 'idle' | 'engaged' | 'done'
    this.angle = REST_ANGLE;
    this.vel = 0;
    this.target = REST_ANGLE;
    this.pendingEvent = null;
  }

  mapX(x) {
    // x: 0 (screen-left) -> -MAX,  1 (screen-right) -> +MAX
    return (x * 2 - 1) * ANGLE_MAX;
  }

  update(g, dt) {
    let event = null;
    if (this.pendingEvent) {
      event = this.pendingEvent;
      this.pendingEvent = null;
    }

    if (this.state !== 'done') {
      if (g && g.present && g.pinching) {
        this.state = 'engaged';
        this.target = this.mapX(g.x);
      } else if (this.state === 'engaged') {
        // just released
        if (this.angle < -COMMIT) {
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
    this.pendingEvent = null;
  }
}
