import { getQuotaState, canStartNewRecording, QuotaState } from '../storage/db.js';
import { getRedactionSummary } from './redaction-summary.js';

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const errorBanner = document.getElementById('errorBanner');
const quotaBanner = document.getElementById('quotaBanner');
const quotaModal = document.getElementById('quotaModal');
const quotaModalDismiss = document.getElementById('quotaModalDismiss');
const quotaModalExport = document.getElementById('quotaModalExport');
const exportBtn = document.getElementById('exportBtn');
const redactionSummaryEl = document.getElementById('redactionSummary');

// Visible error copy for the three named failure states from the capture
// UI polish ticket, plus the pre-existing storage-blocked case and a
// screenshot-specific non-fatal one.
const ERROR_MESSAGES = {
  permission_denied: 'Permission denied — check Chrome’s capture permissions and try again.',
  stream_lost: 'Recording stopped because the shared tab/window sharing ended.',
  offscreen_document_creation_failed: 'Could not start the capture engine. Try reloading the extension.',
  storage_blocked: 'Local storage is full — export recordings before starting a new one.',
  screenshot_capture_failed: 'Could not capture a screenshot for the last step (recording continues).',
  unknown: 'Something went wrong starting the recording.',
};

// Export isn't implemented anywhere in this codebase yet (no export
// pipeline exists in storage/db.js or elsewhere) — this ticket is UI
// wiring only, so the button is present and honest about that rather than
// faking a download. Tracked as a follow-up in the completion packet.
function notImplementedExport() {
  window.alert(
    'Export isn’t built yet — this button is wired up ahead of that follow-up ticket. Your data stays on this device either way.'
  );
}

let quotaModalDismissedForState = null;

function renderCaptureState(state) {
  const status = state.status || 'idle';
  const recording = status === 'recording';
  const paused = status === 'paused';

  statusDot.classList.toggle('recording', recording);
  statusDot.classList.toggle('paused', paused);
  statusText.textContent =
    status === 'recording'
      ? 'Recording…'
      : status === 'paused'
        ? 'Paused'
        : status === 'stopping'
          ? 'Stopping…'
          : status === 'error'
            ? 'Error'
            : 'Idle';

  startBtn.hidden = recording || paused;
  pauseBtn.hidden = !recording;
  resumeBtn.hidden = !paused;
  stopBtn.hidden = !(recording || paused || status === 'stopping');

  if (status === 'error' && state.errorReason) {
    errorBanner.hidden = false;
    errorBanner.textContent = ERROR_MESSAGES[state.errorReason] || ERROR_MESSAGES.unknown;
  } else {
    errorBanner.hidden = true;
  }
}

async function renderQuota(state) {
  const quotaState = await getQuotaState();
  const startAllowed = await canStartNewRecording();
  const recordingActive = state.status === 'recording' || state.status === 'paused';

  quotaBanner.hidden = quotaState !== QuotaState.WARNING;

  if (quotaState === QuotaState.CRITICAL && quotaModalDismissedForState !== QuotaState.CRITICAL) {
    quotaModal.hidden = false;
  } else if (quotaState !== QuotaState.CRITICAL) {
    quotaModal.hidden = true;
    quotaModalDismissedForState = null;
  }

  exportBtn.hidden = quotaState === QuotaState.NORMAL;
  startBtn.disabled = recordingActive || !startAllowed;
  startBtn.title = !startAllowed ? 'Local storage is full — export to continue' : '';
}

async function renderRedactions(state) {
  const sessionId = state.activeSessionId || state.lastSessionId;
  const { sentence } = await getRedactionSummary(sessionId);
  redactionSummaryEl.textContent = sentence || 'No sensitive fields redacted yet.';
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'UI_GET_STATE' });
  renderCaptureState(state);
  await renderQuota(state);
  await renderRedactions(state);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'UI_START_CAPTURE' });
  if (res && res.ok === false) {
    errorBanner.hidden = false;
    errorBanner.textContent = ERROR_MESSAGES[res.reason] || ERROR_MESSAGES.unknown;
  }
  await refresh();
});

pauseBtn.addEventListener('click', async () => {
  pauseBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'UI_PAUSE_CAPTURE' });
  pauseBtn.disabled = false;
  await refresh();
});

resumeBtn.addEventListener('click', async () => {
  resumeBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'UI_RESUME_CAPTURE' });
  resumeBtn.disabled = false;
  await refresh();
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'UI_STOP_CAPTURE' });
  await refresh();
});

quotaModalDismiss.addEventListener('click', () => {
  quotaModalDismissedForState = QuotaState.CRITICAL;
  quotaModal.hidden = true;
});

quotaModalExport.addEventListener('click', notImplementedExport);
exportBtn.addEventListener('click', notImplementedExport);

refresh();
