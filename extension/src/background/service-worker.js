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

// Side panel is the primary UI surface (replaces the old popup, per Chief
// Officer decision 2026-08-25 — a popup closes on any page interaction,
// which a manual smoke test found made an in-progress recording invisible
// and gave no live feedback; the side panel stays open across navigation,
// same pattern Scribe uses). Clicking the toolbar icon opens it directly —
// no default_popup is set in manifest.json.
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Older Chrome without the Side Panel API (pre-114) — action click will
  // simply do nothing extra; not worth failing extension startup over.
});

// Broadcasts a UI-facing event to any open extension page (side panel,
// onboarding tab). Deliberately separate from the offscreen coordination
// messages below (those carry `target: 'offscreen'` and are ignored by
// everything else) so UI updates can't accidentally trigger capture logic
// and vice versa. A message with no listener (no side panel open) is a
// silent no-op in Chrome's messaging model — nothing to catch here.
function broadcastToUI(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => {});
}

// Shared by the initial-step creation (below, once offscreen confirms it's
// ready) and the webNavigation.onCompleted listener (subsequent steps) —
// same record shape, same downstream messaging, one place to keep in sync.
async function createStep(sessionId, url) {
  const step = {
    id: crypto.randomUUID(),
    sessionId,
    order: Date.now(),
    url,
    timestamp: Date.now(),
    screenshotRef: null, // populated by the offscreen document's capture loop
  };
  await stepStore.create(step);
  broadcastToUI('STEP_ADDED', { step });

  chrome.runtime.sendMessage({
    type: 'STEP_BOUNDARY',
    target: 'offscreen',
    sessionId,
    stepId: step.id,
    url: step.url,
    timestamp: step.timestamp,
  });

  return step;
}

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

// Toolbar badge — visible even when the side panel is closed, since closing
// it is still possible even though (unlike the old popup) it no longer
// closes automatically on page interaction. Original gap found via manual
// smoke test, 2026-08-25, before the side panel replaced the popup.
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
// small set of reason codes the side panel/onboarding UI knows how to render.
// Kept as a single lookup so UI-facing reason strings stay consistent
// regardless of which layer detected the failure.
function classifyStartError(message = '') {
  if (message.startsWith('STORAGE_BLOCKED')) return 'storage_blocked';
  if (message.startsWith('OFFSCREEN_DOC_FAILED')) return 'offscreen_document_creation_failed';
  if (message.startsWith('PERMISSION_DENIED')) return 'permission_denied';
  return 'unknown';
}

async function startCapture(tabId, initialUrl) {
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
    // Consumed once, by the CAPTURE_STATE 'recording' handler below — that's
    // the first reliable signal offscreen's video element is actually ready
    // to grab a frame from. Creating this step immediately here instead
    // would race the screenshot against offscreen still setting up.
    pendingInitialStepUrl: initialUrl || null,
  });
  setBadge('recording');
  broadcastToUI('UI_STATE_CHANGED');

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
  broadcastToUI('UI_STATE_CHANGED');
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
  broadcastToUI('UI_STATE_CHANGED');
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
  broadcastToUI('UI_STATE_CHANGED');
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
        const sessionId = await startCapture(tab.id, tab.url);
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
        // Live redaction feed — the side panel's per-step list updates in
        // real time as fields get classified, not just on next full refresh.
        broadcastToUI('FIELD_REDACTED', {
          stepId: currentStep.id,
          category: message.classification.category,
          redacted: message.classification.redacted,
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
        broadcastToUI('UI_STATE_CHANGED');
      } else if (message.status === 'step_captured') {
        // Screenshot for a step finished writing — let the side panel show
        // "screenshot captured" against that step instead of staying blank.
        broadcastToUI('STEP_SCREENSHOT_READY', { stepId: message.stepId });
      } else if (message.status === 'recording') {
        // First reliable signal that offscreen's video element is actually
        // ready to grab a frame — this is when the initial step (the page
        // the user was on when they clicked Start) gets created. Without
        // this, a recording with zero page navigations produced zero steps
        // and zero screenshots, found via manual smoke test 2026-08-25.
        const state = await getState();
        if (state.activeSessionId && state.pendingInitialStepUrl) {
          await createStep(state.activeSessionId, state.pendingInitialStepUrl);
          await setState({ pendingInitialStepUrl: null });
        }
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
      // at all if the side panel isn't open — a manual smoke test found
      // that without it, "did anything happen after I clicked Stop?" had
      // no answer on screen. Badge alone (not a notification) to avoid the
      // "notifications" permission and its own CWS review/manifest cost for
      // what a badge already solves. Side panel (when open) additionally
      // shows an explicit "Recording saved — N steps" line via this event.
      setBadge(message.errorReason ? 'error' : 'done');
      broadcastToUI('CAPTURE_DONE', {
        sessionId: state.activeSessionId,
        errorReason: message.errorReason || null,
      });
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
// the side panel — see onboarding.js for why the actual Start/Stop
// buttons live there, not on the onboarding tab itself) -> team/
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
  // If the initial step (see CAPTURE_STATE 'recording' handler above)
  // hasn't been created yet, this navigation IS effectively the first step
  // — skip double-creating it by letting that pending state resolve first.
  if (state.pendingInitialStepUrl) return;

  await createStep(state.activeSessionId, details.url);
});
