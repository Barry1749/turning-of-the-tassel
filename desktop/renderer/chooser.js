'use strict';
const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(msg) { statusEl.textContent = msg; }
function append(msg) {
  statusEl.textContent = (statusEl.textContent === 'Idle.' ? '' : statusEl.textContent + '\n') + msg;
  statusEl.scrollTop = statusEl.scrollHeight;
}

window.tassel.onStatus((m) => append(m));

$('hostBtn').addEventListener('click', async () => {
  const runtime = document.querySelector('input[name=runtime]:checked').value;
  const local = $('local').checked;
  setStatus('Starting…');
  const r = await window.tassel.host({ runtime, local });
  if (!r.ok) append('Error: ' + r.error);
});

$('stopBtn').addEventListener('click', async () => {
  setStatus('Stopping…');
  await window.tassel.stop();
  append('Stopped.');
});

$('joinBtn').addEventListener('click', async () => {
  const r = await window.tassel.join($('link').value);
  if (!r.ok) append('Error: ' + r.error);
});

$('link').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
