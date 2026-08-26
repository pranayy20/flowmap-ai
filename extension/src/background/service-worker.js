/**
 * Service worker — stateless coordinator, per the accepted offscreen capture
 * architecture (frontend-team-lead, Sprint 1).
 *
 * MV3 service workers unload when idle and hold NO reliable in-memory state.
 * chrome.storage.local is the source of truth for session state, not
 * variables in this file — every state transition below is written to
 * storage synchronously before the handler returns, and every handler reads
 * from storage first rather than trusting in-memory state to have survived.
 *
 * This file is the sole sender of control messages to the offscreen
 * document (START_CAPTURE / STOP_CAPTURE / PAUSE_CAPTURE / RESUME_CAPTURE /
 * STEP_BOUNDARY) and the sole receiver of state/completion messages back
 * from it (CAPTURE_STATE / CAPTURE_COMPLETE). The offscreen document never
 * self-initiates capture.
 */

import { sessionStore, stepStore, fieldStore, canStartNewRecording } from '../storage/db.js';

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';
const ONBOARDING_PATH = 'src/onboarding/onboarding.html';

async function hasOffscreenDocument() {
  // chrome.runtime.getContexts (Chrome 116+) is the documented way to check
  // this, but a manual smoke test (2026-08-25) found the equivalent call
  // inside offscreen.js itself throws "not a function" in practice — see
  // that file's onRecordingStopped() for the fix and full explanation.
  // Defending here too rather than assuming this call site is safe just
  // because it runs from the service worker instead: chrome.storage.local's
  // offscreenDocOpen flag is already this file's own source of truth for
  // capture state (per the file-level doc comment above), so it's a correct
  // fallback, not a guess, if getContexts is ever unavailable.
  if (typeof chrome.runtime.getContexts !== 'function') {
    const state = await getState();
    return Boolean(state.offscreenDocOpen);
  }
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    return contexts.length > 0;
  } catch {
    const state = await getState();
    return Boolean(state.offscreenDocOpen);
  }
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Recording tab/window capture stream for FlowMap AI documentation session.',
  });
}

async function getState() {
  const { captureState } = await chrome.storage.local.get('captureState');
  return (
    captureState || {
      activeSessionId: null,
      status: 'idle',
      offscreenDocOpen: false,
      errorReason: null,
      lastSessionId: null,
    }
  );
}

async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ captureState: next });
  return next;
}

// Toolbar badge — the one signal visible without reopening the popup, which
// closes on any page interaction (normal Chrome behavior, not a bug, but it
// meant a recording in progress was otherwise invisible until this was
// added; found via manual smoke test, 2026-08-25).
const BADGE = {
  recording: { text: 'REC', color: '#dc2626' },
  paused: { text: 'II', color: '#d97706' },
  done: { text: '✓', color: '#16a34a' },
  error: { text: '!', color: '#dc2626' },
};

let badgeClearTimer = null;

function setBadge(kind) {
  if (badgeClearTimer) {
    clearTimeout(badgeClearTimer);
    badgeClearTimer = null;
  }
  const spec = BADGE[kind];
  if (!spec) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  chrome.action.setBadgeText({ text: spec.text });
  chrome.action.setBadgeBackgroundColor({ color: spec.color });
  if (kind === 'done' || kind === 'error') {
    // Transient states — confirm briefly, then return to the idle (empty)
    // badge rather than leaving a stale checkmark showing indefinitely.
    badgeClearTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
  }
}

// Maps the internal error tags this file and offscreen.js raise into the
// small set of reason codes the popup/onboarding UI knows how to render.
// Kept as a single lookup so UI-facing reason strings stay consistent
// regardless of which layer detected the failure.
function classifyStartError(message = '') {
  if (message.startsWith('STORAGE_BLOCKED')) return 'storage_blocked';
  if (message.startsWith('OFFSCREEN_DOC_FAILED')) return 'offscreen_document_creation_failed';
  if (message.startsWith('PERMISSION_DENIED')) return 'permission_denied';
  return 'unknown';
}

async function startCapture(tabId) {
  if (!(await canStartNewRecording())) {
    throw new Error('STORAGE_BLOCKED: quota at or above 95%, export existing recordings first');
  }

  const sessionId = crypto.randomUUID();
  await sessionStore.create({
    id: sessionId,
    title: `Recording ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    status: 'recording',
  });

  try {
    await ensureOffscreenDocument();
  } catch (err) {
    await sessionStore.update({ id: sessionId, status: 'error' });
    await setState({
      activeSessionId: null,
      status: 'error',
      errorReason: 'offscreen_document_creation_failed',
    });
    setBadge('error');
    throw new Error(`OFFSCREEN_DOC_FAILED: ${err?.message || err}`);
  }

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    await sessionStore.update({ id: sessionId, status: 'error' });
    await setState({ activeSessionId: null, status: 'error', errorReason: 'permission_denied' });
    setBadge('error');
    throw new Error(`PERMISSION_DENIED: ${err?.message || err}`);
  }

  await setState({
    activeSessionId: sessionId,
    status: 'recording',
    offscreenDocOpen: true,
    errorReason: null,
  });
  setBadge('recording');

  chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    target: 'offscreen',
    sessionId,
    streamId,
  });

  broadcastSessionState(true);
  return sessionId;
}

async function stopCapture() {
  const state = await getState();
  if (!state.activeSessionId) return;

  chrome.runtime.sendMessage({
    type: 'STOP_CAPTURE',
    target: 'offscreen',
    sessionId: state.activeSessionId,
  });

  await sessionStore.update({ id: state.activeSessionId, status: 'stopping' });
  await setState({ status: 'stopping' });
  broadcastSessionState(false);
}

async function pauseCapture() {
  const state = await getState();
  if (state.status !== 'recording') return { ok: false, reason: 'not_recording' };

  chrome.runtime.sendMessage({
    type: 'PAUSE_CAPTURE',
    target: 'offscreen',
    sessionId: state.activeSessionId,
  });
  await setState({ status: 'paused' });
  setBadge('paused');
  return { ok: true };
}

async function resumeCapture() {
  const state = await getState();
  if (state.status !== 'paused') return { ok: false, reason: 'not_paused' };

  chrome.runtime.sendMessage({
    type: 'RESUME_CAPTURE',
    target: 'offscreen',
    sessionId: state.activeSessionId,
  });
  await setState({ status: 'recording' });
  setBadge('recording');
  return { ok: true };
}

function broadcastSessionState(active) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_SESSION_STATE', active }, () => {
        // Swallow "no receiver" errors for tabs without our content script.
        void chrome.runtime.lastError;
      });
    }
  });
}

// --- Message routing ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep the channel open for the async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'UI_START_CAPTURE': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      try {
        const sessionId = await startCapture(tab.id);
        return { ok: true, sessionId };
      } catch (err) {
        return { ok: false, reason: classifyStartError(err?.message || '') };
      }
    }
    case 'UI_STOP_CAPTURE': {
      await stopCapture();
      return { ok: true };
    }
    case 'UI_PAUSE_CAPTURE': {
      return pauseCapture();
    }
    case 'UI_RESUME_CAPTURE': {
      return resumeCapture();
    }
    case 'UI_GET_STATE': {
      return getState();
    }
    case 'FIELD_INTERACTION': {
      const state = await getState();
      if (!state.activeSessionId) return { ok: false, reason: 'no_active_session' };
      // Content script has already run Tier 1 classification — this just
      // persists the (possibly-already-redacted) result. See
      // ../detection/tier1-detector.js for the classification itself.
      const steps = await stepStore.bySession(state.activeSessionId);
      const currentStep = steps[steps.length - 1];
      if (currentStep) {
        await fieldStore.create({
          id: crypto.randomUUID(),
          stepId: currentStep.id,
          label: message.label,
          value: message.value,
          tier: message.classification.tier,
          category: message.classification.category,
          redacted: message.classification.redacted,
          timestamp: message.timestamp,
        });
      }
      return { ok: true };
    }
    case 'CAPTURE_STATE': {
      // Status pings from the offscreen document. 'error' pings are the one
      // status that changes persisted state — everything else (recording,
      // step_captured) is informational only.
      if (message.status === 'error') {
        if (message.sessionId) {
          await sessionStore.update({ id: message.sessionId, status: 'error' });
        }
        await setState({
          activeSessionId: null,
          status: 'error',
          errorReason: message.reason || 'unknown',
        });
        setBadge('error');
      }
      return { ok: true };
    }
    case 'CAPTURE_COMPLETE': {
      const state = await getState();
      await sessionStore.update({
        id: state.activeSessionId,
        status: message.errorReason ? 'error' : 'complete',
      });
      await setState({
        activeSessionId: null,
        status: 'idle',
        lastSessionId: state.activeSessionId,
        errorReason: message.errorReason || null,
      });
      // This is the one moment a recording finishing has any visible signal
      // at all if the popup isn't open — a manual smoke test found that
      // without it, "did anything happen after I clicked Stop?" had no
      // answer on screen. Badge alone (not a notification) to avoid the
      // "notifications" permission and its own CWS review/manifest cost for
      // what a badge already solves.
      setBadge(message.errorReason ? 'error' : 'done');
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'unknown_message_type' };
  }
}

// On service-worker wake after an idle-unload, re-check for an in-progress
// session rather than assuming a clean start — this is what lets capture
// survive the SW lifecycle per the accepted architecture.
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.activeSessionId && state.offscreenDocOpen) {
    // Offscreen document persists independently of the SW's lifecycle
    // (kept alive by its active MediaStream) — nothing to recreate here,
    // just resume listening.
  }
});

// First-run onboarding: Welcome -> workspace name/type -> optional host
// permission request -> first real recording (tracked inline, guided from
// the toolbar popup — see onboarding.js for why the actual Start/Stop
// buttons live in the popup, not on the onboarding tab itself) -> team/
// project setup. Only fires on a fresh install, never on update/reload.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PATH) });
  }
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // top-level navigations only
  const state = await getState();
  if (!state.activeSessionId || state.status === 'paused') return;

  const step = {
    id: crypto.randomUUID(),
    sessionId: state.activeSessionId,
    order: Date.now(),
    url: details.url,
    timestamp: Date.now(),
    screenshotRef: null, // populated by the offscreen document's capture loop
  };
  await stepStore.create(step);

  chrome.runtime.sendMessage({
    type: 'STEP_BOUNDARY',
    target: 'offscreen',
    sessionId: state.activeSessionId,
    stepId: step.id,
    url: step.url,
    timestamp: step.timestamp,
  });
});
