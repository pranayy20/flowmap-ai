/**
 * Content script — field-interaction capture.
 *
 * Per the Chief-Officer-approved manifest capability narrowing (2026-08-25):
 * this captures a field's FINAL VALUE on blur/change, NOT a raw keydown/keyup
 * keystroke stream. Raw per-keystroke capture is "not currently planned" —
 * do not add a keydown/keyup listener here without a new CO/Director of
 * Product decision (see docs/decisions/keyboard-tracking-narrowing.md).
 *
 * Every captured field is run through the Tier 1 detector inline, before the
 * value ever leaves this script's scope — see ../detection/tier1-detector.js.
 * The service worker receives only the (possibly redacted) result, never the
 * raw value for a Tier A/B match.
 */

// Static import works because Manifest V3 content scripts support ES modules
// when declared as such; kept as a plain script here for broadest
// content-script compatibility — see README for the build-tooling note.
// (Inlined require avoided; see build step for bundling detection module.)

let sessionActive = false;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'CAPTURE_SESSION_STATE') {
    sessionActive = message.active;
  }
});

function getFieldContext(el) {
  const label =
    el.labels && el.labels.length ? el.labels[0].innerText : el.getAttribute('aria-label') || '';
  return {
    label,
    name: el.name || '',
    placeholder: el.placeholder || '',
    type: el.type || el.tagName.toLowerCase(),
    value: el.value ?? el.innerText ?? '',
  };
}

async function handleFieldCommit(event) {
  if (!sessionActive) return;

  const el = event.target;
  const isCapturable =
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable;
  if (!isCapturable) return;

  const context = getFieldContext(el);
  if (!context.value) return;

  // Detection runs HERE, in-page, before anything is sent to the service
  // worker. See ../detection/tier1-detector.js for the classification logic.
  const { classifyField, redactValue } = await import(
    chrome.runtime.getURL('src/detection/tier1-detector.js')
  );
  const classification = classifyField(context);

  const payload = {
    type: 'FIELD_INTERACTION',
    url: location.href,
    timestamp: Date.now(),
    fieldType: context.type,
    label: classification.redact ? '[label withheld — sensitive field]' : context.label,
    value: classification.redact ? redactValue(classification.category) : context.value,
    classification: {
      tier: classification.tier,
      category: classification.category,
      redacted: classification.redact,
    },
  };

  chrome.runtime.sendMessage(payload);
}

document.addEventListener('blur', handleFieldCommit, { capture: true, passive: true });
document.addEventListener('change', handleFieldCommit, { capture: true, passive: true });
