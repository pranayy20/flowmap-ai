/**
 * Content script — field-interaction capture AND click-driven step capture.
 *
 * Per the Chief-Officer-approved manifest capability narrowing (2026-08-25):
 * field values are captured as a FINAL VALUE on blur/change, NOT a raw
 * keydown/keyup keystroke stream. Raw per-keystroke capture is "not
 * currently planned" — do not add a keydown/keyup listener here without a
 * new CO/Director of Product decision (see
 * docs/decisions/keyboard-tracking-narrowing.md).
 *
 * Click capture (added 2026-08-26, per a manual smoke test + explicit
 * request to match Scribe's UX): a new step is created on every click on an
 * interactive-ish element, not just on full page navigations. This is the
 * actual gap that made "no step-by-step screenshots while using the app"
 * true before this — webNavigation.onCompleted only fires on real
 * navigations, and plenty of real usage (opening a dropdown, checking a
 * box, a SPA route change with no full page load) never triggers one.
 *
 * Every captured field VALUE and every click DESCRIPTION is run through the
 * Tier 1 detector inline, before anything leaves this script's scope — see
 * ../detection/tier1-detector.js. The service worker receives only the
 * (possibly redacted) result, never a raw sensitive value.
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

// --- Click-driven step capture ---

const CLICKABLE_SELECTOR =
  'button, a, input, select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick]';

function truncate(text, max) {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Finds the nearest thing worth describing — a raw click.target inside a
// modern component is very often an <svg>/<span> icon nested a few levels
// inside the real button, so climbing to the closest interactive ancestor
// (or a reasonable text-bearing container) produces a far more readable
// step than "Clicked svg".
function nearestDescribableElement(el) {
  return el.closest(CLICKABLE_SELECTOR) || el;
}

function describeClickTarget(el) {
  const target = nearestDescribableElement(el);
  const tag = target.tagName.toLowerCase();
  const label =
    target.getAttribute('aria-label') ||
    (target.innerText || target.textContent || '').trim() ||
    target.getAttribute('placeholder') ||
    target.getAttribute('title') ||
    target.getAttribute('alt') ||
    target.getAttribute('value') ||
    target.getAttribute('name');

  if (label) return { description: `Clicked "${truncate(label, 60)}"`, rawLabel: label };
  return { description: `Clicked ${tag}`, rawLabel: '' };
}

let lastClickAt = 0;
let lastClickTarget = null;

async function handleUserClick(event) {
  if (!sessionActive) return;

  // Debounce true double-fires (a real double-click, or a click event that
  // bubbles through nested handlers) on the exact same element — a fast
  // click on a DIFFERENT element (e.g. rapidly clicking through a wizard)
  // is real usage and should still capture every step.
  const now = Date.now();
  if (event.target === lastClickTarget && now - lastClickAt < 400) return;
  lastClickAt = now;
  lastClickTarget = event.target;

  const { description, rawLabel } = describeClickTarget(event.target);

  // Defense-in-depth: a click's visible label could itself be sensitive
  // (e.g. a table row action next to a value, or selected/highlighted PII
  // acting as a link). Run it through the same Tier 1 classifier used for
  // field values, treating the label as a value with no field context.
  const { classifyField, redactValue } = await import(
    chrome.runtime.getURL('src/detection/tier1-detector.js')
  );
  const classification = rawLabel ? classifyField({ value: rawLabel }) : { redact: false };

  chrome.runtime.sendMessage({
    type: 'USER_CLICK',
    url: location.href,
    timestamp: now,
    description: classification.redact
      ? `Clicked ${redactValue(classification.category)}`
      : description,
  });
}

document.addEventListener('click', handleUserClick, { capture: true, passive: true });
