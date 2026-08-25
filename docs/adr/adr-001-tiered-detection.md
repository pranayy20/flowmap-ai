# ADR-001: Tiered Sensitive-Data Detection Architecture

**Status:** Accepted (2026-08-25). Full record: [Notion ADR-001](https://app.notion.com/p/3c739bc87fee8176bd96d67ad4671b04).
**Owner:** solution-architect-lead, joint with director-security.
**Implementation:** [`extension/src/detection/tier1-detector.js`](../../extension/src/detection/tier1-detector.js)

## Decision

**Tier 1 (on-device, mandatory default):** regex + label-context heuristics, always on, runs on every captured field regardless of save destination. This is what makes "zero automatic uploads without consent" true by construction.

**Tier 2 (external API, strictly opt-in):** not implemented in MVP. No automatic path exists or is planned to this tier.

## Binding accuracy bar (director-security, 2026-08-25)

| Tier | Categories | Recall | Precision |
|---|---|---|---|
| A — critical | SSN, credit card, API keys/secrets, passwords, MFA/OTP, bank account numbers | ≥ 99.5% | ≥ 90% |
| B — moderate | Business data, low-weight PII, internal URLs | ≥ 95% | ≥ 85% |
| C — low-stakes | Pricing, generic business terms | ≥ 85% | — |

**Current implementation status:** `tier1-detector.js` is the hard-rule (regex + label-heuristic) layer only — this is the fail-closed backstop the accuracy bar requires as the *primary* Tier A gate, not a placeholder for it. An ML/NER classifier for unlabeled free-text detection (the harder case a pure regex/label approach can't fully cover) is tracked as a follow-up, not a blocker for this layer to ship — see the Adversarial Test Corpus design (Sprint 1) for how both will be measured against the accuracy bar before release.

## Fail-closed design

Implemented in `applyConservativeSpread()`: any field on a page/form containing a Tier A match causes unclassified sibling fields to be conservatively redacted too, not just the exact matched span.

Redaction is destructive at the storage layer — `redactValue()` returns a placeholder string, and the original value is never persisted for a Tier A/B match. See `qa-team-lead`'s destructive-redaction requirement (must hold across all 7 export formats, not just at capture time — export-format verification is separate follow-up work, not yet implemented).
