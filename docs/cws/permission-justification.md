# Chrome Web Store permission justification

Source: release-manager-lead's CWS permission pre-check + frontend-team-lead's manifest finalization (Sprint 1, 2026-08-25). Mirrors the permission list in `extension/manifest.json`.

| Permission | CWS risk | Justification |
|---|---|---|
| `activeTab` | Low | Temporary, gesture-scoped access to the current tab when the user invokes the toolbar action — no standing host grant. |
| `tabCapture` | Medium | Core capability — captures the active tab's stream for the documentation recording. |
| `desktopCapture` | Medium | Multi-window/app documentation workflows; user picks the source via Chrome's native picker each time — no standing/implicit grant. |
| `scripting` + `optional_host_permissions` | Medium | Injects the content script that reads field value + label context on blur/change. Requested as **optional, runtime-requested per-site** (`chrome.permissions.request`), not a blanket `<all_urls>` at install time — keeps install-time review friction low and matches least-privilege review expectations. |
| `webNavigation` | Low-Medium | Detects page navigation during an active session to segment documentation steps. |
| `storage` | Low | `chrome.storage.local` for session state only — no sync-tier permission requested (no cross-device sync requirement in MVP). |
| `offscreen` | Low (structural) | MV3-required: service workers are non-persistent; `tabCapture`/`desktopCapture` streams need a document context (`getUserMedia`/`MediaRecorder`), which only an offscreen document can provide. |

**Keyboard tracking:** see [`docs/decisions/keyboard-tracking-narrowing.md`](../decisions/keyboard-tracking-narrowing.md) — narrowed from raw keystroke capture to a DOM value-read on blur/change specifically to avoid CWS's keylogger-detection pattern.

**On-device redaction as the privacy narrative:** Tier 1 detection (see [`docs/adr/adr-001-tiered-detection.md`](../adr/adr-001-tiered-detection.md)) runs on all captured content before storage, regardless of destination — this is the listing's core "processed and redacted on-device before storage or transmission" claim and is the strongest mitigating statement for the broad host-permission bundle above.
