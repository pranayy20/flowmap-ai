# FlowMap AI

AI-powered process documentation and workflow discovery. Chrome Extension, local-first by default.

Full charter, PRD, and SDLC record (all decisions, RAID log, team reviews) live in Notion:
[FlowMap AI Project](https://app.notion.com/p/3c739bc87fee81318f99d2123b826f9c). This repo is the engineering implementation — process/coordination lives in Notion and in `sdlc-agent-org/_protocol/`, not here.

## Current status

**M3 Engineering — in progress.** MVP wedge: Technical Writers + IT/Operations. Sprint 1 (Planning/foundational architecture) is complete — see links below. Sprint 2 (MVP build-out) shipped, then a manual smoke test (2026-08-25) found real bugs automated tests couldn't catch — see "Post-Sprint-2 fixes" below.

## Architecture

| Decision | Doc | Implementation |
|---|---|---|
| Sensitive-data detection (Tier 1, on-device, mandatory default) | [`docs/adr/adr-001-tiered-detection.md`](docs/adr/adr-001-tiered-detection.md) | [`extension/src/detection/tier1-detector.js`](extension/src/detection/tier1-detector.js) |
| Local storage (IndexedDB + OPFS hybrid) | [`docs/data-architecture.md`](docs/data-architecture.md) | [`extension/src/storage/db.js`](extension/src/storage/db.js) |
| Capture architecture (offscreen document, MV3) | Sprint 1 ticket | [`extension/src/background/service-worker.js`](extension/src/background/service-worker.js), [`extension/src/offscreen/offscreen.js`](extension/src/offscreen/offscreen.js) |
| Primary UI: side panel, not a popup (Chief Officer decision, 2026-08-25 — a popup closes on any page interaction, giving no live feedback during a recording; side panel stays open across navigation, same pattern as Scribe) | Manual smoke test finding | [`extension/src/sidepanel/`](extension/src/sidepanel/), `manifest.json`'s `side_panel` key + `chrome.sidePanel.setPanelBehavior` in the service worker |
| Keyboard-tracking narrowing (blur/change, not raw keystrokes) | [`docs/decisions/keyboard-tracking-narrowing.md`](docs/decisions/keyboard-tracking-narrowing.md) | [`extension/src/content/content-script.js`](extension/src/content/content-script.js) |
| CWS permission justification | [`docs/cws/permission-justification.md`](docs/cws/permission-justification.md) | [`extension/manifest.json`](extension/manifest.json) |
| Chrome Web Store distribution process | `sdlc-agent-org/_protocol/04-git-cicd-protocol.md` Section 8 | [`.github/workflows/chrome-store-submit.yml`](.github/workflows/chrome-store-submit.yml) (skeleton) |
| Extension icon (shield + flow-node mark, privacy-first/local-first identity) | Sprint 2 ticket (`ui-designer`) | [`extension/icons/icon.svg`](extension/icons/icon.svg) source, [`extension/icons/generate-icons.js`](extension/icons/generate-icons.js) build script, [`extension/manifest.json`](extension/manifest.json) `icons`/`action.default_icon` |

## Privacy model

Everything captured (field values, screenshots) is redacted on-device via the Tier 1 detector **before** it's ever written to storage. Nothing leaves the device unless the user explicitly chooses Save to Workspace, Export, or Share — and even then, only the already-redacted artifact crosses that boundary (see the PRD's local/cloud data-flow contract, Sprint 1).

There is currently **no human review step** in MVP — AI Privacy Review (manual accept/reject) is deferred to a future release. The Tier 1 automatic system is the sole control. See `docs/adr/adr-001-tiered-detection.md` for the accuracy bar this is held to.

## Load the extension (development)

1. `chrome://extensions` → enable Developer Mode.
2. "Load unpacked" → select the `extension/` directory.
3. Click the FlowMap AI toolbar icon — this opens the **side panel** (not a popup). Pin the extension if the icon isn't visible.
4. The `optional_host_permissions` grant is requested at runtime per-site, not at install — the content script won't run on a page until the extension has been granted access there.

**After pulling new changes:** a full remove-and-re-add in `chrome://extensions` is more reliable than the reload icon for service worker / offscreen document changes — Chrome can cache MV3 service worker state aggressively, and the reload button doesn't always pick up everything.

## Known gaps (tracked, not blocking this scaffold)

- No ML/NER classifier yet for unlabeled free-text sensitive-data detection — Tier 1 currently ships as the hard-rule (regex + label-heuristic) layer only, which is the required fail-closed backstop per ADR-001, not a placeholder for it. Sprint 2's adversarial test corpus (`extension/test/`) measured this layer against the binding accuracy bar and found every tier currently fails it — flagged to `appsec-team-lead`/`solution-architect-lead`, not fixed as part of that QA ticket or this frontend batch.
- No build tooling yet (vanilla ES modules, loaded directly) — evaluate a bundler if/when the codebase needs it, don't add one preemptively.
- `chrome-store-submit.yml` is a structural placeholder; real implementation is a `cicd-pipeline-engineer` follow-up per the protocol addendum.
- The quota UI's Export button (WARNING/CRITICAL/BLOCKED thresholds) now calls the real local export pipeline (`exportSessionById()`) and triggers a browser download — see "Sprint 2 frontend delivery" below. "Save to Workspace" (persisting to a team/workspace backend) is still unbuilt; this is local-file export only.
- No team/workspace backend exists — onboarding's workspace and team/project setup steps (Sprint 2) persist answers to `chrome.storage.local` only, ahead of any real backend.
- **None of the fixes above (Post-Sprint-2 or Third-round) are verified in a real browser by this agent.** Each round fixed the specific bug a manual smoke test actually reported, verified by reading the real error/data and reasoning through the code path — never by re-running the smoke test itself, since no tool in this environment can drive `chrome://extensions`' native "Load unpacked" file picker or click/type inside a real Chrome window. Every round so far has surfaced at least one more real bug the previous round didn't catch — treat this repo as "reasoned-correct, not yet demo-verified" until someone with a real browser confirms a full record → click-through → stop → export cycle end-to-end in one pass.
- **Click-driven step capture has no rate limit beyond a 400ms same-element debounce.** A very click-heavy interaction (rapid-fire clicking, drag operations that fire synthetic click events) could create a lot of steps in a short time — not yet stress-tested.

## Third-round fixes (manual smoke test, Chief Officer, 2026-08-26)

The second smoke test (side panel working, live recording indicator visible) found two more real problems and one explicit design request:

1. **Exports showed "Untitled recording session" with no steps.** Root cause: `sessionStore.update()` in `db.js` called IndexedDB's `put()` directly with whatever partial object the caller passed (e.g. `{ id, status: 'complete' }`) — `put()` is a full overwrite, not a merge, so every status transition (`stopping`, `complete`) silently wiped the `title` and `createdAt` set at recording start. Fixed: `update()` now reads the existing record first and merges the patch in, the correct semantics for something named "update."
2. **No screenshots while clicking through an app.** Root cause: a new step (and its screenshot) was only ever created on `chrome.webNavigation.onCompleted` — a real, committed page navigation. Most real usage (opening a dropdown, checking a box, a SPA route change, clicking through a settings panel) never fires that event at all. Explicit request: match Scribe's UX, where a step is captured on every meaningful click, not just full page loads. Fixed: `content-script.js` now also captures a step on click (see "Click-driven step capture" below), independent of navigation.
3. **The workspace profile from onboarding was saved but never shown anywhere afterward.** Fixed: the side panel header now shows a small workspace-name badge, read from the same `chrome.storage.local.workspaceProfile` onboarding already wrote.

### Click-driven step capture

`content-script.js` listens for `click` (not just `blur`/`change`) on interactive-ish elements (`button`, `a`, `input`, `[role="button"]`, etc., climbing from the actual click target to the nearest such ancestor — modern UIs often nest an icon/span inside the real button). Builds a human-readable description (`Clicked "Add to Cart"`) from the element's visible text/aria-label/title, runs that description through the same Tier 1 detector used for field values (defense-in-depth — a click's label could itself be sensitive), then sends a `USER_CLICK` message. `service-worker.js` creates a step from it via the same `createStep()` helper navigation-based steps use, so both paths produce identically-shaped records and both show up live in the side panel's step feed and in every export format.

## Post-Sprint-2 fixes (manual smoke test, Chief Officer, 2026-08-25)

Sprint 2 shipped with 50/50 passing Node tests and 91.82% coverage — but nothing in that suite exercises real Chrome extension APIs in an actual browser (no browser environment in the Node test harness). The first real-browser test found three real problems the automated suite gave false confidence about:

1. **Every recording crashed on stop.** `offscreen.js` called `chrome.runtime.getContexts()` on itself to check whether an offscreen document existed, immediately before closing it — backwards (it already knows it's the running document), and not reliably callable from inside an offscreen document's own execution context. Threw an uncaught `TypeError` on every single recording. Recording data was never actually lost (the crash was in post-write cleanup, after the video blob was already written and the completion message already sent) — but there was no feedback that anything had gone wrong, which read as "nothing happened." Fixed by closing directly with no self-query, plus a defensive fallback in the service worker's equivalent call.
2. **No live feedback during or after a recording.** A popup closes on any page interaction — normal Chrome behavior, but it meant an in-progress recording was invisible the moment you clicked into the page, and there was no confirmation after Stop either. Fixed by replacing the popup with a **side panel** (stays open across navigation) plus a toolbar badge as a secondary signal.
3. **A recording with zero page navigations produced zero steps and zero screenshots.** Steps were only ever created on `webNavigation.onCompleted` — recording on a single static page (a very normal case) silently captured nothing. Fixed: an initial step is now created as soon as the offscreen document confirms it's ready to capture, using the tab the user was on when they clicked Start, not just on subsequent navigations.

## Side panel (primary UI, replacing the popup)

Live step-by-step feed while recording — inspired directly by Scribe's side-panel pattern, per explicit request after the smoke test. The service worker broadcasts events (`STEP_ADDED`, `FIELD_REDACTED`, `STEP_SCREENSHOT_READY`, `CAPTURE_DONE`, `UI_STATE_CHANGED`) as they happen; the side panel listens and updates in real time rather than only refreshing on open. Shows: large recording-status indicator with elapsed timer, a live-updating list of steps (URL, timestamp, screenshot-captured marker, per-step redaction count), the aggregate redaction summary, quota banner/modal, and export controls — all in one persistent view. See [`extension/src/sidepanel/sidepanel.js`](extension/src/sidepanel/sidepanel.js).

## Sprint 2 frontend delivery

- Screenshot-per-step capture: `offscreen.js` now grabs a real frame (video element + canvas) on each `STEP_BOUNDARY` and writes it via `writeBinaryArtifact()`, updating the originating step's `screenshotRef`.
- Redaction status display: popup shows a read-only per-session redaction count (e.g. "3 passwords, 1 API key redacted this session") — no accept/reject UI, that's still out of MVP scope.
- Capture UI polish: popup adds Pause/Resume (backed by `captureState` in `chrome.storage.local`, not in-memory state) and visible error states for permission-denied, stream-lost, and offscreen-document-creation-failure.
- Onboarding: first-run flow (Welcome -> workspace name/type -> optional host-permission request -> first real recording -> team/project setup) opens on install.
- Quota UI: popup surfaces WARNING (banner), CRITICAL (blocking modal), and BLOCKED (start disabled, export-only) using the existing `getQuotaState()`/`canStartNewRecording()`.
- Export wiring: the quota UI's Export button and the CRITICAL modal's Export button now call `exportSessionById()` (`extension/src/export/index.js`, PR #3) for the current/most recently completed session and trigger a download via an anchor-click `Blob` pattern (works reliably from an MV3 popup page without adding the `downloads` permission). The modal's one-click path always defaults to Markdown (fastest, no heavy rendering); the banner's Export button offers an optional MD/HTML/PDF/DOCX picker.

## Directory structure

```
flowmap-ai/
  extension/
    manifest.json
    src/
      background/     # service worker — stateless coordinator
      offscreen/       # capture engine (getUserMedia/MediaRecorder)
      content/         # field-interaction capture (blur/change)
      detection/       # Tier 1 sensitive-data classifier
      storage/         # IndexedDB + OPFS
      sidepanel/       # primary UI: capture controls, live step feed, quota, redaction status
      export/          # local export rendering (Markdown/HTML/PDF/DOCX)
      onboarding/      # first-run flow (opened on install)
  docs/
    adr/               # architecture decision records
    decisions/         # Chief Officer / Director-level decisions
    cws/               # Chrome Web Store submission docs
  .github/workflows/   # CI/CD (chrome-store-submit.yml is a skeleton)
```
