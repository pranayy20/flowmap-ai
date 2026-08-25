# FlowMap AI

AI-powered process documentation and workflow discovery. Chrome Extension, local-first by default.

Full charter, PRD, and SDLC record (all decisions, RAID log, team reviews) live in Notion:
[FlowMap AI Project](https://app.notion.com/p/3c739bc87fee81318f99d2123b826f9c). This repo is the engineering implementation — process/coordination lives in Notion and in `sdlc-agent-org/_protocol/`, not here.

## Current status

**M3 Engineering — in progress.** MVP wedge: Technical Writers + IT/Operations. Sprint 1 (Planning/foundational architecture) is complete — see links below.

## Architecture

| Decision | Doc | Implementation |
|---|---|---|
| Sensitive-data detection (Tier 1, on-device, mandatory default) | [`docs/adr/adr-001-tiered-detection.md`](docs/adr/adr-001-tiered-detection.md) | [`extension/src/detection/tier1-detector.js`](extension/src/detection/tier1-detector.js) |
| Local storage (IndexedDB + OPFS hybrid) | [`docs/data-architecture.md`](docs/data-architecture.md) | [`extension/src/storage/db.js`](extension/src/storage/db.js) |
| Capture architecture (offscreen document, MV3) | Sprint 1 ticket | [`extension/src/background/service-worker.js`](extension/src/background/service-worker.js), [`extension/src/offscreen/offscreen.js`](extension/src/offscreen/offscreen.js) |
| Keyboard-tracking narrowing (blur/change, not raw keystrokes) | [`docs/decisions/keyboard-tracking-narrowing.md`](docs/decisions/keyboard-tracking-narrowing.md) | [`extension/src/content/content-script.js`](extension/src/content/content-script.js) |
| CWS permission justification | [`docs/cws/permission-justification.md`](docs/cws/permission-justification.md) | [`extension/manifest.json`](extension/manifest.json) |
| Chrome Web Store distribution process | `sdlc-agent-org/_protocol/04-git-cicd-protocol.md` Section 8 | [`.github/workflows/chrome-store-submit.yml`](.github/workflows/chrome-store-submit.yml) (skeleton) |

## Privacy model

Everything captured (field values, screenshots) is redacted on-device via the Tier 1 detector **before** it's ever written to storage. Nothing leaves the device unless the user explicitly chooses Save to Workspace, Export, or Share — and even then, only the already-redacted artifact crosses that boundary (see the PRD's local/cloud data-flow contract, Sprint 1).

There is currently **no human review step** in MVP — AI Privacy Review (manual accept/reject) is deferred to a future release. The Tier 1 automatic system is the sole control. See `docs/adr/adr-001-tiered-detection.md` for the accuracy bar this is held to.

## Load the extension (development)

1. `chrome://extensions` → enable Developer Mode.
2. "Load unpacked" → select the `extension/` directory.
3. The `optional_host_permissions` grant is requested at runtime per-site, not at install — the content script won't run on a page until the extension has been granted access there.

## Known gaps (tracked, not blocking this scaffold)

- No ML/NER classifier yet for unlabeled free-text sensitive-data detection — Tier 1 currently ships as the hard-rule (regex + label-heuristic) layer only, which is the required fail-closed backstop per ADR-001, not a placeholder for it.
- Screenshot-per-step capture in `offscreen.js` is a stubbed message contract, not a full frame-grab implementation yet.
- WARNING/CRITICAL quota states are implemented in `db.js` but not yet wired to any UI surface.
- No build tooling yet (vanilla ES modules, loaded directly) — evaluate a bundler if/when the codebase needs it, don't add one preemptively.
- No icons — pending UI/brand design, not an engineering task.
- `chrome-store-submit.yml` is a structural placeholder; real implementation is a `cicd-pipeline-engineer` follow-up per the protocol addendum.
- The 4 sub-tickets frontend-team-lead proposed in Sprint 1 (capture UI polish, redaction status display, onboarding flow) are not yet built — the popup UI here is a minimal first cut (start/stop only).

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
      popup/           # extension UI
  docs/
    adr/               # architecture decision records
    decisions/         # Chief Officer / Director-level decisions
    cws/               # Chrome Web Store submission docs
  .github/workflows/   # CI/CD (chrome-store-submit.yml is a skeleton)
```
