/**
 * First-run onboarding flow, opened as a tab by service-worker.js's
 * chrome.runtime.onInstalled listener (reason === 'install' only).
 *
 * Flow: Welcome -> workspace name/type -> optional_host_permissions runtime
 * request -> first real recording (guided inline here, but actually
 * started/stopped from the side panel — see the note below) -> team/
 * project setup (after the recording, not before). Workspace-Type nuance
 * and an Invite-Teammates step are intentionally out of this critical path
 * per the ticket.
 *
 * Deviation flagged to frontend-team-lead: the "record your first workflow
 * inline" step does NOT put Start/Stop buttons on this onboarding tab
 * itself. chrome.tabCapture.getMediaStreamId() targets a specific tabId
 * captured at the moment Start is clicked — if Start lived here, it would
 * capture the onboarding tab itself, not the real task the user switches to.
 * Instead this screen guides the user to the side panel (opened via the
 * toolbar icon, staying open on whichever tab is actually active when they
 * click Start there) and polls capture state in the background so the
 * onboarding flow still advances automatically the moment that first
 * recording completes.
 */

const screens = {
  welcome: document.getElementById('screen-welcome'),
  workspace: document.getElementById('screen-workspace'),
  recording: document.getElementById('screen-recording'),
  team: document.getElementById('screen-team'),
  done: document.getElementById('screen-done'),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

// --- Welcome ---
document.getElementById('getStartedBtn').addEventListener('click', () => {
  showScreen('workspace');
});

// --- Workspace: name + type (kept deliberately simple, no type-specific branching) ---
const workspaceForm = document.getElementById('workspaceForm');
workspaceForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const workspaceName = document.getElementById('workspaceName').value.trim() || 'My Workspace';
  const workspaceType = document.getElementById('workspaceType').value;

  await chrome.storage.local.set({
    workspaceProfile: { name: workspaceName, type: workspaceType, createdAt: Date.now() },
  });

  // Must stay in the same user-gesture call stack as the submit click.
  // Denial is non-fatal: recording still works via tabCapture on the active
  // tab, per-site field capture just won't run until the user grants this
  // later from Chrome's site settings.
  try {
    await chrome.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    // Ignore — proceed regardless of grant/deny.
  }

  showScreen('recording');
  startPollingForFirstRecording();
});

// --- First recording: tracked here, actually driven from the side panel ---
const firstRecordingStatus = document.getElementById('firstRecordingStatus');
let sessionObserved = false;
let pollHandle = null;

function startPollingForFirstRecording() {
  if (pollHandle) return;
  pollHandle = setInterval(async () => {
    let state;
    try {
      state = await chrome.runtime.sendMessage({ type: 'UI_GET_STATE' });
    } catch {
      return; // service worker briefly unavailable — try again next tick
    }

    if (state.status === 'recording' || state.status === 'paused') {
      sessionObserved = true;
      firstRecordingStatus.textContent =
        'Recording detected — do your task, then click Stop from the FlowMap AI toolbar icon when finished.';
    } else if (sessionObserved && state.status === 'idle' && state.lastSessionId) {
      clearInterval(pollHandle);
      pollHandle = null;
      firstRecordingStatus.textContent = 'First recording captured!';
      showScreen('team');
    } else if (sessionObserved && state.status === 'error') {
      firstRecordingStatus.textContent =
        'That recording hit an error — click the FlowMap AI toolbar icon to see details and try again.';
    }
  }, 1000);
}

// --- Team/project setup: AFTER the first recording completes, per the accepted flow ---
const teamForm = document.getElementById('teamForm');
teamForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const teamName = document.getElementById('teamName').value.trim();
  const projectName = document.getElementById('projectName').value.trim();
  await chrome.storage.local.set({ teamProfile: { teamName, projectName } });
  finishOnboarding();
});

document.getElementById('skipTeamBtn').addEventListener('click', () => finishOnboarding());

async function finishOnboarding() {
  await chrome.storage.local.set({ onboardingComplete: true });
  showScreen('done');
}

document.getElementById('closeBtn').addEventListener('click', () => window.close());

showScreen('welcome');
