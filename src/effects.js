// Celebration effects: confetti (canvas-confetti) + a short synthesized fanfare
// (Web Audio, so we need no audio asset). initAudio() must be called from a user
// gesture to satisfy autoplay policies.
import confetti from 'canvas-confetti';

let actx = null;

export function initAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
}

export function celebrate() {
  playFanfare();
  const colors = ['#f2c14e', '#16183b', '#ffffff'];
  confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 }, colors });
  confetti({ particleCount: 80, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors });
  confetti({ particleCount: 80, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors });
  setTimeout(() => {
    confetti({ particleCount: 100, spread: 100, origin: { y: 0.5 }, colors, scalar: 1.2 });
  }, 280);
}

function playFanfare() {
  if (!actx) return;
  const now = actx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    const t = now + i * 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + 0.55);
  });
}
