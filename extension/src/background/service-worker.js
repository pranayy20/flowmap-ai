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
 * document (START_CAPTURE / STOP_CAPTURE / STEP_BOUNDARY) and the sole
 * receiver of state/completion messages back from it (CAPTURE_STATE /
 * CAPTURE_COMPLETE). The offscreen document never self-initiates capture.
 */

import { sessionStore, stepStore, fieldStore, canStartNewRecording } from '../storage/db.js';

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return contexts.length > 0;
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
  return captureState || { activeSessionId: null, status: 'idle', offscreenDocOpen: false };
}

async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ captureState: next });
  return next;
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

  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  await setState({ activeSessionId: sessionId, status: 'recording', offscreenDocOpen: true });

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
  broadcastSessionState(false);
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
      const sessionId = await startCapture(tab.id);
      return { ok: true, sessionId };
    }
    case 'UI_STOP_CAPTURE': {
      await stopCapture();
      return { ok: true };
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
      // Status ping from the offscreen document — logged, not acted on yet.
      return { ok: true };
    }
    case 'CAPTURE_COMPLETE': {
      const state = await getState();
      await sessionStore.update({ id: state.activeSessionId, status: 'complete' });
      await setState({ activeSessionId: null, status: 'idle' });
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

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return; // top-level navigations only
  const state = await getState();
  if (!state.activeSessionId) return;

  await stepStore.create({
    id: crypto.randomUUID(),
    sessionId: state.activeSessionId,
    order: Date.now(),
    url: details.url,
    timestamp: Date.now(),
    screenshotRef: null, // populated by the offscreen document's capture loop
  });

  chrome.runtime.sendMessage({
    type: 'STEP_BOUNDARY',
    target: 'offscreen',
    sessionId: state.activeSessionId,
    url: details.url,
    timestamp: Date.now(),
  });
});
