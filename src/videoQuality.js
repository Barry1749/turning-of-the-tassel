// Shared video-quality presets. The host (MC) picks one in the control panel; the choice is stored
// in the server's ceremony state (cstate.videoQuality) and every on-camera client reads it, so the
// whole room broadcasts at the same resolution. Each preset drives the camera capture constraint —
// the composite canvas + cap renderer then follow the camera's real frame size each frame (see
// drawScene), so this size is what peers receive — and the WebRTC bitrate cap in useP2P.
// Keep the ids in sync with VALID_QUALITY in server/index.js.
export const VIDEO_QUALITIES = [
  { id: 'sd', label: 'SD · 480p', width: 854, height: 480, maxBitrate: 1_200_000 },
  { id: 'hd', label: 'HD · 720p', width: 1280, height: 720, maxBitrate: 2_500_000 },
  { id: 'fhd', label: 'Full HD · 1080p', width: 1920, height: 1080, maxBitrate: 4_000_000 },
];

export const DEFAULT_QUALITY = 'hd';

// Resolve a quality id — possibly undefined or unknown (an older server, or a tampered value) — to
// its preset, falling back to the default so callers always get usable dimensions + bitrate.
export function qualitySpec(id) {
  return VIDEO_QUALITIES.find((q) => q.id === id) || VIDEO_QUALITIES.find((q) => q.id === DEFAULT_QUALITY);
}
