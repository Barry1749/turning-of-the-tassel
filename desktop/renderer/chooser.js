'use strict';
const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(msg) { statusEl.textContent = msg; }
function append(msg) {
  statusEl.textContent = (statusEl.textContent === 'Idle.' ? '' : statusEl.textContent + '\n') + msg;
  statusEl.scrollTop = statusEl.scrollHeight;
}

window.tassel.onStatus((m) => append(m));

let mcLink = '';
function hideMcLink() { mcLink = ''; $('mclinkBox').hidden = true; }

// The MC link arrives once the ceremony is up. When "open automatically" is on, the main process
// has already opened the console; we still stash the link so it's here to copy/reopen on return.
// When it's off, this panel is the only way in, so reveal it.
window.tassel.onMcLink((url) => {
  mcLink = url;
  $('mclinkInput').value = url;
  if (!$('autoJoin').checked) $('mclinkBox').hidden = false;
});

$('hostBtn').addEventListener('click', async () => {
  const runtime = document.querySelector('input[name=runtime]:checked').value;
  const local = $('local').checked;
  const autoJoin = $('autoJoin').checked;
  hideMcLink();
  setStatus('Starting…');
  const r = await window.tassel.host({ runtime, local, autoJoin });
  if (!r.ok) append('Error: ' + r.error);
});

$('stopBtn').addEventListener('click', async () => {
  setStatus('Stopping…');
  hideMcLink(); // the link is dead once the stack is down
  await window.tassel.stop();
  // The stop helper streams its real progress + final "Stopped." via onStatus — don't fake it here.
});

$('openMcBtn').addEventListener('click', async () => {
  if (!mcLink) return;
  const r = await window.tassel.join(mcLink); // reuses the join path: opens the link in an app window
  if (!r.ok) append('Error: ' + r.error);
});

$('copyMcBtn').addEventListener('click', async () => {
  if (!mcLink) return;
  await window.tassel.copy(mcLink);
  append('MC link copied to clipboard.');
});

$('joinBtn').addEventListener('click', async () => {
  const r = await window.tassel.join($('link').value);
  if (!r.ok) append('Error: ' + r.error);
});

$('link').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
