/**
 * Offscreen document — the actual capture engine.
 *
 * This is the only MV3-legal, non-visible document Chrome lets an extension
 * keep alive for a getUserMedia/MediaRecorder session (the service worker
 * cannot host a MediaStream at all). Kept alive by its active MediaStream,
 * independent of the service worker's idle-unload cycle.
 *
 * Never self-initiates capture — only responds to START_CAPTURE/STOP_CAPTURE
 * messages from the service worker, and reports back via CAPTURE_STATE /
 * CAPTURE_COMPLETE.
 */

import { writeBinaryArtifact } from '../storage/db.js';

let mediaRecorder = null;
let recordedChunks = [];
let currentSessionId = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'START_CAPTURE':
      startCapture(message.sessionId, message.streamId);
      break;
    case 'STOP_CAPTURE':
      stopCapture();
      break;
    case 'STEP_BOUNDARY':
      captureScreenshotForStep(message.url, message.timestamp);
      break;
  }
});

async function startCapture(sessionId, streamId) {
  currentSessionId = sessionId;
  recordedChunks = [];

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });

  mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };
  mediaRecorder.onstop = onRecordingStopped;
  mediaRecorder.start(1000); // 1s timeslice, keeps memory bounded during long sessions

  chrome.runtime.sendMessage({ type: 'CAPTURE_STATE', status: 'recording', sessionId });
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
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
  });

  currentSessionId = null;
  recordedChunks = [];
  mediaRecorder = null;

  // Self-close once no recording is active — avoids leaking the offscreen
  // document indefinitely per the accepted architecture.
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

async function captureScreenshotForStep(url, timestamp) {
  // Screenshot capture reads a frame from the already-authorized tabCapture
  // stream (satisfies the MV3 user-gesture rule via the original capture
  // start, not a new gesture per screenshot) — full frame-grab
  // implementation (video element + canvas draw) is tracked as a follow-up
  // engineering task; this stub establishes the message contract so the
  // service worker's step-boundary flow has something to call today.
  chrome.runtime.sendMessage({
    type: 'CAPTURE_STATE',
    status: 'step_captured',
    url,
    timestamp,
  });
}
