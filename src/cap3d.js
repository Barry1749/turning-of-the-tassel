// A real 3D mortarboard (Taiwan 學士帽 / square academic cap) built with three.js and
// rendered to an offscreen canvas in screen space, so the 2D pipeline can drawImage() it
// over the (mirrored) video.
//
// render() takes screen-space placement (cx, cy, scale in px) + head orientation
// (yaw/pitch/roll, radians) + the tassel swing angle.
//
// It's black like a real undergraduate cap: a large flat square board on a shallow fabric
// crown, a covered button, and a soft tassel. The tassel is gravity-driven — it hangs
// toward true "down" on screen regardless of head tilt — with the swing angle leaning it
// right (rest) or left (turned). The cord is a thin bowed thread and the bunch is many
// fine strands. Tassel colour can be changed via setColors() (grad/PhD use field colours).
import * as THREE from 'three';

const BOARD_COLOR = 0x141418; // black mortarboard
const SKULL_COLOR = 0x0e0e12; // black fabric crown
const TASSEL_COLOR = 0x3a3a42; // dark tassel (undergraduate = black)

const BOARD_SIZE = 1; // local units; the whole group is scaled to fit the head
const BOARD_THICK = 0.05;
const CORD_LEN = 0.5;
const LEAN_SCALE = 0.55; // how far the swing angle leans the hanging tassel sideways

const DOWN = new THREE.Vector3(0, -1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);
const _wd = new THREE.Vector3();
const _ld = new THREE.Vector3();
const _iq = new THREE.Quaternion();

// deterministic per-strand jitter (no Math.random — keeps renders reproducible)
function pseudo(i) {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function makeTassel(mat) {
  const g = new THREE.Group();

  // cord: a thin, slightly bowed thread
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.025, -CORD_LEN * 0.5, 0.01),
    new THREE.Vector3(0, -CORD_LEN, 0),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.01, 6, false), mat));

  // slider bead
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mat);
  bead.position.set(0.013, -CORD_LEN * 0.5, 0.005);
  g.add(bead);

  // crown of the bunch where the strands gather
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.05, 0.06, 14), mat);
  crown.position.y = -CORD_LEN - 0.03;
  g.add(crown);

  // many fine strands hanging from the bunch, gently splayed and varied in length
  const N = 18;
  const top = -CORD_LEN - 0.05;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const len = 0.16 + pseudo(i) * 0.06;
    const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0035, len, 5), mat);
    strand.position.set(Math.cos(a) * 0.012, top - len / 2, Math.sin(a) * 0.012);
    strand.rotation.z = Math.cos(a) * 0.16;
    strand.rotation.x = -Math.sin(a) * 0.16;
    g.add(strand);
  }
  return g;
}

export function createCapRenderer(width = 640, height = 480) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // so we can drawImage() the result onto the 2D canvas
    });
  } catch (e) {
    return null; // no WebGL in this environment
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-0.6, 1.0, 0.7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88a0ff, 0.3);
  fill.position.set(0.6, 0.2, -0.5);
  scene.add(fill);

  const cap = new THREE.Group();
  scene.add(cap);

  const boardMat = new THREE.MeshStandardMaterial({ color: BOARD_COLOR, roughness: 0.55, metalness: 0.08 });
  const skullMat = new THREE.MeshStandardMaterial({ color: SKULL_COLOR, roughness: 0.95, metalness: 0.0 });
  const tasselMat = new THREE.MeshStandardMaterial({ color: TASSEL_COLOR, roughness: 0.8, metalness: 0.0 });

  // large flat square board — rotated 45° so a CORNER points forward (worn like a diamond)
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE, BOARD_THICK, BOARD_SIZE), boardMat);
  board.rotation.y = Math.PI / 4;
  cap.add(board);

  // cylindrical crown (straight sides, not a bowl) sitting on the head, under the board.
  // Unit-height geometry with its TOP at the local origin, so scale.y grows it DOWNWARD;
  // the height is driven live by capConfig.skullHeight (passed to render()).
  const skullGeo = new THREE.CylinderGeometry(BOARD_SIZE * 0.34, BOARD_SIZE * 0.34, 1, 32);
  skullGeo.translate(0, -0.5, 0);
  const skull = new THREE.Mesh(skullGeo, skullMat);
  skull.position.y = -BOARD_THICK / 2; // top tucks just under the board
  skull.scale.y = 0.5;
  cap.add(skull);

  // covered button at the board centre
  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(BOARD_SIZE * 0.045, BOARD_SIZE * 0.045, BOARD_THICK * 1.3, 18),
    boardMat,
  );
  button.position.y = BOARD_THICK * 0.6;
  cap.add(button);

  // tassel — pivots at the button, hangs toward gravity (set each frame in render())
  const tassel = new THREE.Group();
  tassel.position.set(0, BOARD_THICK * 0.6, BOARD_SIZE * 0.06);
  tassel.add(makeTassel(tasselMat));
  cap.add(tassel);

  function place(cx, cy, scale) {
    const D = 6;
    const hH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * D;
    const hW = hH * camera.aspect;
    const ndcX = (cx / canvas.width) * 2 - 1;
    const ndcY = 1 - (cy / canvas.height) * 2;
    cap.position.set(ndcX * hW, ndcY * hH, -D);
    const s = (scale * hW * 2) / (canvas.width * BOARD_SIZE);
    cap.scale.setScalar(s);
  }

  return {
    canvas,
    render({ cx, cy, scale, yaw = 0, pitch = 0, roll = 0, tasselAngle = 0, skullHeight = 0.5 }) {
      place(cx, cy, scale);
      cap.rotation.set(pitch, yaw, roll, 'YXZ');
      skull.scale.y = skullHeight; // taller/shorter crown, live-tunable

      // Gravity-aligned hang: aim the tassel at screen-"down" leaned by the swing angle,
      // expressed in the cap's local frame so head tilt doesn't drag it around rigidly.
      _wd.copy(DOWN).applyAxisAngle(ZAXIS, tasselAngle * LEAN_SCALE);
      _iq.copy(cap.quaternion).invert();
      _ld.copy(_wd).applyQuaternion(_iq);
      tassel.quaternion.setFromUnitVectors(DOWN, _ld);
      renderer.render(scene, camera);
    },
    resize(w, h) {
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    setColors({ board: b, tassel: t } = {}) {
      if (b != null) boardMat.color.set(b);
      if (t != null) tasselMat.color.set(t);
    },
    dispose() {
      renderer.dispose();
    },
  };
}
