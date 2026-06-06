// Google-Meet-style floating control bar: round mic + camera toggles, shown to on-camera
// participants (professor + students). Each turns red with a slashed icon when off. The state
// and the actual track toggling live in useSelfView; this is just the buttons.

const MicOn = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
    <path d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
  </svg>
);

const MicOff = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zM15 11.16V5a3 3 0 0 0-5.94-.6L15 11.16zM4.27 3 3 4.27l6 6V11a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.66 1.66A4.99 4.99 0 0 1 7 11H5.3a7 7 0 0 0 6 6.92V21h2v-3.08c.79-.11 1.53-.36 2.21-.73l3.52 3.52L21 19.73 4.27 3z" />
  </svg>
);

const CamOn = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
  </svg>
);

const CamOff = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2 2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z" />
  </svg>
);

export default function MediaControls({ camOn, micOn, hasMic, onToggleCam, onToggleMic, disabled }) {
  return (
    <div className="media-controls">
      <button
        type="button"
        className={`media-btn ${micOn ? '' : 'off'}`}
        onClick={onToggleMic}
        disabled={disabled || !hasMic}
        title={!hasMic ? 'No microphone' : micOn ? 'Turn off microphone' : 'Turn on microphone'}
        aria-label={!hasMic ? 'No microphone' : micOn ? 'Turn off microphone' : 'Turn on microphone'}
        aria-pressed={!micOn}
      >
        {micOn ? <MicOn /> : <MicOff />}
      </button>
      <button
        type="button"
        className={`media-btn ${camOn ? '' : 'off'}`}
        onClick={onToggleCam}
        disabled={disabled}
        title={camOn ? 'Turn off camera' : 'Turn on camera'}
        aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
        aria-pressed={!camOn}
      >
        {camOn ? <CamOn /> : <CamOff />}
      </button>
    </div>
  );
}
