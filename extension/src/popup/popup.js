const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

function render(state) {
  const recording = state.status === 'recording';
  statusDot.classList.toggle('recording', recording);
  statusText.textContent = recording ? 'Recording…' : 'Idle';
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'UI_GET_STATE' });
  render(state);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'UI_START_CAPTURE' });
  } catch (err) {
    statusText.textContent = err?.message?.startsWith('STORAGE_BLOCKED')
      ? 'Storage full — export recordings to continue'
      : 'Could not start recording';
  }
  await refresh();
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'UI_STOP_CAPTURE' });
  await refresh();
});

refresh();
