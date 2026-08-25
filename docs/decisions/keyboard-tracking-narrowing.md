# Decision: Keyboard input tracking narrowed to field-value capture

**Decided by:** Chief Officer, 2026-08-25, on release-manager-lead's recommendation.
**Status:** Approved, implemented.

## What changed

The original charter listed "Keyboard input tracking" (raw keystroke capture) as an MVP Chrome Extension capability. A Chrome Web Store permission pre-check found this matches CWS's keylogger-detection policy pattern regardless of on-device redaction downstream — real rejection risk, not just slower review.

**Approved alternative:** capture a field's final value on `blur`/`change` (DOM read via `element.value`), not a `keydown`/`keyup` event stream. Implemented in [`extension/src/content/content-script.js`](../../extension/src/content/content-script.js).

## Why this doesn't lose documentation quality

- Step ordering/timing is independently covered by `webNavigation` timestamps in the service worker — nothing depended on keystroke-level timing.
- The final value at blur/change is the actual documentation-relevant fact; intermediate retyping/corrections aren't.
- It's a *better* input to the Tier 1 detection classifier than raw keystrokes: classification runs on field-level semantics (value + label context), which blur/change produces directly, vs. a keystroke stream that would need field-boundary reconstruction first.

## What is NOT planned

Raw per-keystroke sequence capture is **not currently planned**. Do not add a `keydown`/`keyup` listener without a new Chief Officer / Director of Product decision — this file is the record of that constraint, referenced directly from the content script's top-level comment.
