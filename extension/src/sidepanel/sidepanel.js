/**
 * Side panel — the primary FlowMap AI UI, replacing the old popup (Chief
 * Officer decision, 2026-08-25, per a manual smoke test + direct request:
 * "build it like Scribe's side panel — everything happens there and keeps
 * the user in the loop"). A popup closes on any page interaction, which is
 * normal Chrome behavior but made an in-progress recording invisible with
 * no live feedback. The side panel stays open across navigation instead.
 *
 * Two ways this stays current:
 *   1. Live push — service-worker.js broadcasts UI_STATE_CHANGED /
 *      STEP_ADDED / FIELD_REDACTED / STEP_SCREENSHOT_READY / CAPTURE_DONE
 *      as they happen, so the step list and status update in real time
 *      without the user doing anything.
 *   2. Full refresh on open/visibility — in case the panel was closed and
 *      reopened, or missed a message (extension pages aren't guaranteed to
 *      receive a broadcast sent while they didn't exist yet).
 */

import { getQuotaState, canStartNewRecording, QuotaState, stepStore, fieldStore } from '../storage/db.js';
import { getRedactionSummary } from './redaction-summary.js';
import { exportSessionById, ExportFormat } from '../export/index.js';

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const elapsedEl = document.getElementById('elapsed');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const errorBanner = document.getElementById('errorBanner');
const doneBanner = document.getElementById('doneBanner');
const quotaBanner = document.getElementById('quotaBanner');
const quotaModal = document.getElementById('quotaModal');
const quotaModalDismiss = document.getElementById('quotaModalDismiss');
const quotaModalExport = document.getElementById('quotaModalExport');
const exportRow = document.getElementById('exportRow');
const exportBtn = document.getElementById('exportBtn');
const exportFormatSelect = document.getElementById('exportFormat');
const redactionSummaryEl = document.getElementById('redactionSummary');
const workspaceBadge = document.getElementById('workspaceBadge');

// Onboarding (onboarding.js) saves { name, type, createdAt } here on
// first run, but nothing ever displayed it back afterward — a manual
// smoke test flagged "no way to see my profile" as a direct result.
// This is read-only display; editing the workspace name/type is out of
// scope here (no settings surface exists yet for that).
async function renderWorkspaceBadge() {
  const { workspaceProfile } = await chrome.storage.local.get('workspaceProfile');
  if (workspaceProfile?.name) {
    workspaceBadge.hidden = false;
    workspaceBadge.textContent = workspaceProfile.name;
    workspaceBadge.title = `${workspaceProfile.name} (${workspaceProfile.type || 'personal'})`;
  } else {
    workspaceBadge.hidden = true;
  }
}
const stepList = document.getElementById('stepList');
const stepEmpty = document.getElementById('stepEmpty');
const stepCountEl = document.getElementById('stepCount');

const ERROR_MESSAGES = {
  permission_denied: 'Permission denied — check Chrome’s capture permissions and try again.',
  stream_lost: 'Recording stopped because the shared tab/window sharing ended.',
  offscreen_document_creation_failed: 'Could not start the capture engine. Try reloading the extension.',
  storage_blocked: 'Local storage is full — export recordings before starting a new one.',
  screenshot_capture_failed: 'Could not capture a screenshot for the last step (recording continues).',
  unknown: 'Something went wrong starting the recording.',
};

let quotaModalDismissedForState = null;
let elapsedTimer = null;
let recordingStartedAt = null;
// stepId -> { redactedCount, screenshotReady } — live-updated as
// FIELD_REDACTED / STEP_SCREENSHOT_READY events arrive, read when rendering.
const stepMeta = new Map();

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleExport(format) {
  const state = await chrome.runtime.sendMessage({ type: 'UI_GET_STATE' });
  const sessionId = state.activeSessionId || state.lastSessionId;

  if (!sessionId) {
    errorBanner.hidden = false;
    errorBanner.textContent = 'No recording session to export yet.';
    return;
  }

  exportBtn.disabled = true;
  quotaModalExport.disabled = true;
  try {
    const { blob, filename } = await exportSessionById(sessionId, format);
    triggerBlobDownload(blob, filename);
    errorBanner.hidden = true;
  } catch {
    errorBanner.hidden = false;
    errorBanner.textContent = 'Export failed — please try again.';
  } finally {
    exportBtn.disabled = false;
    quotaModalExport.disabled = false;
  }
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function startElapsedTimer() {
  if (!recordingStartedAt) recordingStartedAt = Date.now();
  elapsedEl.hidden = false;
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    elapsedEl.textContent = formatElapsed(Date.now() - recordingStartedAt);
  }, 1000);
}

function stopElapsedTimer(hide) {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
  recordingStartedAt = null;
  if (hide) elapsedEl.hidden = true;
}

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

  if (recording || paused) {
    if (!elapsedTimer) startElapsedTimer();
  } else {
    stopElapsedTimer(true);
  }

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

  exportRow.hidden = quotaState === QuotaState.NORMAL;
  startBtn.disabled = recordingActive || !startAllowed;
  startBtn.title = !startAllowed ? 'Local storage is full — export to continue' : '';
}

async function renderRedactions(sessionId) {
  const { sentence } = await getRedactionSummary(sessionId);
  redactionSummaryEl.textContent = sentence || 'No sensitive fields redacted yet.';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function urlLabel(url) {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? u.hostname : `${u.hostname}${u.pathname}`;
  } catch {
    return url || 'unknown page';
  }
}

function renderStepItem(step, index) {
  const meta = stepMeta.get(step.id) || {};
  const li = document.createElement('li');
  li.className = 'step-item';
  li.dataset.stepId = step.id;

  const metaBits = [new Date(step.timestamp).toLocaleTimeString()];
  if (meta.screenshotReady || step.screenshotRef) metaBits.push('screenshot captured');
  if (meta.redactedCount) {
    metaBits.push(
      `<span class="redact-badge">${meta.redactedCount} field${meta.redactedCount === 1 ? '' : 's'} redacted</span>`,
    );
  }

  const primaryLabel = step.description ? escapeHtml(step.description) : escapeHtml(urlLabel(step.url));

  li.innerHTML = `
    <span class="step-index">${index + 1}</span>
    <span class="step-body">
      <span class="step-url" title="${escapeHtml(step.url || '')}">${primaryLabel}</span>
      <span class="step-meta">${metaBits.join(' · ')}</span>
    </span>
  `;
  return li;
}

let renderedSteps = [];

function renderSteps() {
  stepCountEl.textContent = String(renderedSteps.length);
  stepEmpty.hidden = renderedSteps.length > 0;
  stepList.innerHTML = '';
  if (renderedSteps.length === 0) {
    stepList.appendChild(stepEmpty);
    return;
  }
  renderedSteps.forEach((step, i) => stepList.appendChild(renderStepItem(step, i)));
  stepList.scrollTop = stepList.scrollHeight;
}

async function loadStepsForSession(sessionId) {
  stepMeta.clear();
  if (!sessionId) {
    renderedSteps = [];
    renderSteps();
    return;
  }
  const steps = await stepStore.bySession(sessionId);
  steps.sort((a, b) => a.order - b.order);
  for (const step of steps) {
    const fields = await fieldStore.byStep(step.id);
    const redactedCount = fields.filter((f) => f.redacted).length;
    stepMeta.set(step.id, { redactedCount, screenshotReady: Boolean(step.screenshotRef) });
  }
  renderedSteps = steps;
  renderSteps();
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'UI_GET_STATE' });
  const sessionId = state.activeSessionId || state.lastSessionId;
  renderCaptureState(state);
  await renderQuota(state);
  await renderRedactions(sessionId);
  await loadStepsForSession(sessionId);
}

// --- Controls ---

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  doneBanner.hidden = true;
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

quotaModalExport.addEventListener('click', () => handleExport(ExportFormat.MARKDOWN));
exportBtn.addEventListener('click', () => handleExport(exportFormatSelect.value));

// --- Live updates from the service worker ---

chrome.runtime.onMessage.addListener((message) => {
  if (message.target === 'offscreen') return; // not for us

  switch (message.type) {
    case 'UI_STATE_CHANGED':
      refresh();
      break;
    case 'STEP_ADDED':
      renderedSteps = [...renderedSteps, message.step];
      renderSteps();
      break;
    case 'FIELD_REDACTED': {
      if (!message.redacted) break;
      const meta = stepMeta.get(message.stepId) || { redactedCount: 0, screenshotReady: false };
      meta.redactedCount += 1;
      stepMeta.set(message.stepId, meta);
      renderSteps();
      chrome.runtime.sendMessage({ type: 'UI_GET_STATE' }).then((state) => {
        renderRedactions(state.activeSessionId || state.lastSessionId);
      });
      break;
    }
    case 'STEP_SCREENSHOT_READY': {
      const meta = stepMeta.get(message.stepId) || { redactedCount: 0, screenshotReady: false };
      meta.screenshotReady = true;
      stepMeta.set(message.stepId, meta);
      renderSteps();
      break;
    }
    case 'CAPTURE_DONE':
      doneBanner.hidden = false;
      doneBanner.textContent = message.errorReason
        ? 'Recording ended with an issue — check the status above.'
        : `Recording saved — ${renderedSteps.length} step${renderedSteps.length === 1 ? '' : 's'} captured.`;
      refresh();
      break;
  }
});

refresh();
renderWorkspaceBadge();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.workspaceProfile) renderWorkspaceBadge();
});
