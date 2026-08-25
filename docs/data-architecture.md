# Data Architecture: Local Storage (IndexedDB + OPFS Hybrid)

**Status:** Accepted (2026-08-25). Full record: [Notion spec](https://app.notion.com/p/3c739bc87fee817caf8cd96fdb7654e0).
**Implementation:** [`extension/src/storage/db.js`](../extension/src/storage/db.js)

## Decision

IndexedDB for structured metadata (`sessions`, `steps`, `fields` object stores — normalized and enumerable, not opaque blobs, per RAID R1's resolution). OPFS for binary artifacts (screenshots, recording chunks).

## Graceful degradation (4-state machine)

Implemented in `getQuotaState()` / `canStartNewRecording()`:

| State | Threshold | Behavior |
|---|---|---|
| NORMAL | < 70% | No action |
| WARNING | 70–90% | *(UI banner + compression — not yet wired to the UI layer, tracked as a follow-up)* |
| CRITICAL | 90–95% | *(blocking modal — not yet wired, follow-up)* |
| BLOCKED | ≥ 95% | `canStartNewRecording()` returns `false`; the service worker refuses to start a new session. **Never auto-deletes existing data.** |

## Open verification item

Whether installed Chrome extensions are exempt from Chrome's best-effort disk-pressure eviction is not yet empirically verified — flagged in the original spec, not yet actioned. Needs a dedicated test-harness task before this is finalized as a stated guarantee to users.

## Phase 2 note

Schema is deliberately normalized (separate `sessions`/`steps`/`fields` stores, not a single JSON blob per recording) so the Phase 2 knowledge-graph migration is additive — a new store/index layer on top of this data, not a re-platform.
