// Loads the MediaPipe Tasks-Vision WASM + models and creates the face and hand
// landmarkers. Tries the GPU delegate first and falls back to CPU if unavailable.
import { FilesetResolver, FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';

// Pinned to the installed package version so the WASM matches the JS API exactly.
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createLandmarkers() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

  const makeFace = (delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
    });

  const makeHand = (delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
    });

  let faceLandmarker;
  try {
    faceLandmarker = await makeFace('GPU');
  } catch (e) {
    console.warn('Face GPU delegate failed; using CPU', e);
    faceLandmarker = await makeFace('CPU');
  }

  let handLandmarker;
  try {
    handLandmarker = await makeHand('GPU');
  } catch (e) {
    console.warn('Hand GPU delegate failed; using CPU', e);
    handLandmarker = await makeHand('CPU');
  }

  return { faceLandmarker, handLandmarker };
}
