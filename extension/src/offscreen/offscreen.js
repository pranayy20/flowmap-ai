/**
 * Offscreen document — the actual capture engine.
 *
 * This is the only MV3-legal, non-visible document Chrome lets an extension
 * keep alive for a getUserMedia/MediaRecorder session (the service worker
 * cannot host a MediaStream at all). Kept alive by its active MediaStream,
 * independent of the service worker's idle-unload cycle.
 *
 * Never self-initiates capture — only responds to START_CAPTURE/STOP_CAPTURE/
 * PAUSE_CAPTURE/RESUME_CAPTURE/STEP_BOUNDARY messages from the service
 * worker, and reports back via CAPTURE_STATE / CAPTURE_COMPLETE.
 */

import { writeBinaryArtifact, stepStore } from '../storage/db.js';

let mediaRecorder = null;
let recordedChunks = [];
let currentSessionId = null;
let activeStream = null;
let captureVideoEl = null;
let streamLostReason = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'START_CAPTURE':
      startCapture(message.sessionId, message.streamId);
      break;
    case 'STOP_CAPTURE':
      stopCapture();
      break;
    case 'PAUSE_CAPTURE':
      pauseCapture();
      break;
    case 'RESUME_CAPTURE':
      resumeCapture();
      break;
    case 'STEP_BOUNDARY':
      captureScreenshotForStep(message.stepId, message.url, message.timestamp);
      break;
  }
});

async function startCapture(sessionId, streamId) {
  currentSessionId = sessionId;
  recordedChunks = [];
  streamLostReason = null;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_STATE',
      status: 'error',
      reason: 'permission_denied',
      sessionId,
      detail: String(err?.message || err),
    });
    currentSessionId = null;
    return;
  }

  activeStream = stream;
  const [videoTrack] = stream.getVideoTracks();
  if (videoTrack) {
    videoTrack.addEventListener('ended', handleStreamEndedUnexpectedly);
  }

  await setupCaptureVideoElement(stream);

  mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };
  mediaRecorder.onstop = onRecordingStopped;
  mediaRecorder.start(1000); // 1s timeslice, keeps memory bounded during long sessions

  chrome.runtime.sendMessage({ type: 'CAPTURE_STATE', status: 'recording', sessionId });
}

function pauseCapture() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
  }
}

function resumeCapture() {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
  }
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }
}

// Fires when the underlying track ends on its own (e.g. the user clicked
// Chrome's native "Stop sharing" bar) rather than via our own stopCapture().
// The browser will generally stop the MediaRecorder as a consequence, which
// still runs onRecordingStopped and preserves whatever was captured so far —
// this just tags the completion as an error state so the UI can explain why
// the recording ended.
function handleStreamEndedUnexpectedly() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  streamLostReason = 'stream_lost';
  chrome.runtime.sendMessage({
    type: 'CAPTURE_STATE',
    status: 'error',
    reason: 'stream_lost',
    sessionId: currentSessionId,
  });
}

async function setupCaptureVideoElement(stream) {
  captureVideoEl = document.createElement('video');
  captureVideoEl.muted = true;
  captureVideoEl.srcObject = stream;
  try {
    await captureVideoEl.play();
  } catch {
    // Autoplay can reject in odd timing cases; frames still become available
    // once playback settles, so this isn't fatal to capture starting.
  }
}

async function onRecordingStopped() {
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const artifactId = `${currentSessionId}-recording`;
  await writeBinaryArtifact(artifactId, blob);

  chrome.runtime.sendMessage({
    type: 'CAPTURE_COMPLETE',
    sessionId: currentSessionId,
    artifactRef: `opfs:artifacts/${artifactId}.bin`,
    errorReason: streamLostReason || undefined,
  });

  currentSessionId = null;
  recordedChunks = [];
  mediaRecorder = null;
  streamLostReason = null;

  if (captureVideoEl) {
    captureVideoEl.pause();
    captureVideoEl.srcObject = null;
    captureVideoEl = null;
  }
  activeStream = null;

  // Self-close once no recording is active — avoids leaking the offscreen
  // document indefinitely per the accepted architecture.
  //
  // This script IS the offscreen document, so there's nothing to query —
  // just close directly. (An earlier version called
  // chrome.runtime.getContexts() here first to check "does an offscreen
  // document exist," which is backwards for a script asking about itself,
  // and threw an uncaught "not a function" TypeError in real-world testing,
  // silently skipping the close on every single recording. Found via manual
  // smoke test, 2026-08-25.)
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closing/closed — not an error condition worth surfacing.
  }
}

async function captureScreenshotForStep(stepId, url, timestamp) {
  if (!activeStream || !captureVideoEl || !stepId) {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_STATE',
      status: 'error',
      reason: 'stream_lost',
      sessionId: currentSessionId,
      stepId,
    });
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = captureVideoEl.videoWidth || 1280;
    canvas.height = captureVideoEl.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(captureVideoEl, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('canvas.toBlob returned null'));
      }, 'image/png');
    });

    const artifactId = `${stepId}-screenshot`;
    const screenshotRef = await writeBinaryArtifact(artifactId, blob);

    // db.js's stepStore has no dedicated update() — stepStore.create() is a
    // put() under the hood (keyPath 'id'), so re-putting the same id with an
    // updated screenshotRef is a legitimate upsert, not a duplicate write.
    const steps = await stepStore.bySession(currentSessionId);
    const step = steps.find((candidate) => candidate.id === stepId);
    if (step) {
      await stepStore.create({ ...step, screenshotRef });
    }

    chrome.runtime.sendMessage({
      type: 'CAPTURE_STATE',
      status: 'step_captured',
      stepId,
      url,
      timestamp,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_STATE',
      status: 'error',
      reason: 'screenshot_capture_failed',
      stepId,
      sessionId: currentSessionId,
      detail: String(err?.message || err),
    });
  }
}
