# Scoping Note: Supplementary ML/NER Classifier for Unlabeled Free-Text Detection

**Status:** Scoping only — no code shipped. Follow-up to ADR-001.
**Author:** senior-backend-engineer, assigned by solution-architect-lead.
**Context:** ADR-001 flags an ML/NER classifier for unlabeled free-text sensitive-data
detection as a tracked-but-deferred follow-up to the Tier 1 hard-rule layer.
Sprint 2's adversarial test corpus (`extension/test/`, merged PR #1) measured
that hard-rule layer against the binding accuracy bar and found every tier
fails it. This note assesses whether an on-device ONNX NER/PII classifier is
a viable near-term supplement, per the assignment from solution-architect-lead.

**Chief Officer decision (2026-08-25):** detection accuracy is explicitly
**not** an MVP blocker right now — the core platform isn't built yet, and
accuracy work is deliberately deprioritized. This note is scoped and timeboxed
accordingly: it is a recommendation document, not a production build.

## 1. What the corpus actually shows is failing

From `extension/test/README.md` and `extension/test/results/latest-run.json`
(96/34/12 samples, Tier A/B/C):

| Tier | Recall (bar) | Precision (bar) |
|---|---|---|
| A | 81.2% (bar 99.5%) — FAIL | 81.2% (bar 90%) — FAIL |
| B | 48.1% (bar 95%) — FAIL | 65.0% (bar 85%) — FAIL |
| C | 0.0% (bar 85%) — FAIL | n/a |

The seven root causes documented in `extension/test/README.md` split cleanly
into two buckets, and this split is the single most important finding of this
scoping pass:

**Bucket 1 — regex/heuristic bugs, not a coverage gap ML would close** (root
causes 1, 2, 5, 6 in the test README):
- Label regexes require `_`/`-` to join compound words and reject a plain
  space (`"Social Security Number"` doesn't match `social[_-]?security`).
- Several keyword patterns have no `\b` boundary and substring-match unrelated
  labels (`passenger_name`, `secretary_name` flagged as password).
- The phone content-pattern is unbounded-permissive and mis-tiers a Tier A
  bank account number down to a Tier B phone match.
- `github_pat_` (the newer fine-grained PAT prefix) isn't covered.

These account for a large share of both the Tier A/B recall and precision
misses, and every one of them is a same-file regex fix in
`tier1-detector.js` — cheap, deterministic, testable against the existing
corpus, and entirely orthogonal to whether an ML classifier ever ships. **An
ML classifier does not fix these; better regexes do.** (Out of scope for this
ticket per its own guardrail — `tier1-detector.js` and `extension/test/**`
are explicitly not to be touched here — but this is the highest-leverage,
lowest-cost next step and is called out as a separate recommendation below.)

**Bucket 2 — genuine coverage gaps** (root causes 3, 4, 7):
- No content-pattern fallback at all for `mfa_otp`, `bank_account`, `address`
  in unlabeled fields.
- `generic_secret`'s catch-all is imprecise (55.6% precision in isolation) —
  matches git SHAs, dash-stripped UUIDs, long slugs.
- `business_data`, `internal_url`, and all of Tier C (`pricing`,
  `generic_business_terms`) have zero implementation — 0% recall by
  construction.

Bucket 2 is the actual "unlabeled free-text detection" problem ADR-001 refers
to, and it's the one this ticket is meant to assess.

## 2. Is on-device ONNX NER a viable near-term supplement for Bucket 2?

**Assessment: no, not as a near-term addition, and not primarily for the
reason of model size.**

### 2a. Model landscape (PII/NER, on-device size class)

Genuinely small (10–50MB) distilled NER models exist in the general sense
(e.g. quantized 4–6-layer DistilBERT-class models, int8 ONNX, roughly
15–30MB depending on vocab/quantization), but two things matter more than raw
size:

- **General-purpose NER models (person/org/location/misc — CoNLL-2003-style)
  don't map onto the categories actually missing.** `business_data`,
  `internal_url`, `pricing`, and `generic_business_terms` are not named
  entities in the linguistic sense — they're domain/semantic classification
  problems ("is this internal jargon vs. public info", "is this dollar figure
  a price vs. some other number"). A stock NER model doesn't help here at
  all; it would need custom labeled data and fine-tuning specific to
  FlowMap's own form-field corpus, which doesn't exist yet.
- **Purpose-built PII-NER models that would help with `mfa_otp`/
  `bank_account`/`address` free-text detection (e.g. PII-specific
  fine-tunes of BERT/DeBERTa) are generally in the 60–150MB range once
  quantized** — the aggressively small (<30MB) end of the distillation
  spectrum trades away exactly the recall on rarer entity types (bank
  account formats, OTP-in-context) that this gap analysis cares about most.
  There is no widely-used off-the-shelf model in the 10–50MB range that
  specifically targets this category set at a quality bar anywhere near
  99.5%/95% recall — verifying that precisely would require hands-on
  benchmarking against the existing adversarial corpus, which is itself a
  multi-day effort, not something to assert from general knowledge alone.

### 2b. Runtime/integration constraints specific to this codebase

- **No build tooling exists yet** (README "Known gaps": vanilla ES modules,
  loaded directly, no bundler). `onnxruntime-web` needs its WASM binaries
  bundled into the extension package (MV3's remote-code policy prohibits
  fetching executable code, including WASM, from a CDN at runtime) —
  standing up that pipeline is itself a prerequisite piece of work, not
  something folded into "add a classifier."
- **The content script runs on `<all_urls>`** (manifest.json). Loading a WASM
  runtime plus tens of MB of model weights into every page visit has real
  per-page latency/memory cost for what's meant to be a lightweight capture
  tool — this needs a lazy-load/service-worker-offload design, not naive
  content-script inclusion, adding more design surface.
- **Fail-closed tension with ADR-001's own design principle.** ADR-001 is
  explicit that Tier A is "a HARD-RULE layer... not a confidence-scored ML
  gate — ambiguous or low-confidence matches are redacted, never passed
  through." Splicing a probabilistic classifier into a security-critical
  redaction control is solvable (e.g. additive-only: a model match can
  trigger redaction but a model non-match can never suppress a hard-rule
  match) but it's a real design decision requiring security sign-off, not a
  drop-in.

### 2c. Prototype outcome

Given the above, I did not build a code prototype in this pass. A prototype
that either (a) used a generic NER model and therefore wouldn't move the
needle on the categories actually missing, or (b) used a PII-specific model
outside the stated size envelope, would not have produced a result worth the
engineering time under the explicit deprioritization — and per the
assignment's own framing, an honest scoping outcome is preferred over a
rushed partial integration.

## 3. Recommendation

**Defer the ML/NER classifier entirely — do not schedule it for the near
term.** Reasoning:

1. Per the Chief Officer's 2026-08-25 decision, detection accuracy is not an
   MVP blocker right now; the core platform isn't built.
2. The single highest-leverage fix available is **not** ML — it's the
   regex/heuristic bug fixes in Bucket 1 above, which are cheap, testable
   against the existing corpus, and would likely move Tier A/B recall and
   precision substantially closer to bar on their own. That work should be
   scoped and ticketed separately (see below) well before an ML classifier is
   revisited.
3. No off-the-shelf model at the target size cleanly addresses the actual
   coverage gap (`business_data`/`internal_url`/`pricing`/
   `generic_business_terms` are semantic/domain classification, not NER; the
   PII-specific models that would help with `mfa_otp`/`bank_account`/
   `address` run larger than the stated size envelope). Closing this gap well
   would realistically require either a custom fine-tune on FlowMap-specific
   labeled data (data collection + labeling effort that doesn't exist yet) or
   accepting a lower-quality model that risks false negatives in a
   security-critical control.
4. **This genuinely needs a specialized ML/data-science skillset the org's
   current 50-agent roster doesn't have a dedicated role for** (flagged
   explicitly in the original ticket's own guardrail note, and confirmed by
   this pass). Model selection, fine-tuning-data curation, quantization
   trade-off evaluation, and ongoing drift/retraining ownership are a
   distinct discipline from backend engineering; routing this to a Senior
   Backend Engineer to "prototype" is a role mismatch even setting aside the
   deprioritization. If/when this is picked back up, it should be either (a)
   staffed by someone with ML/data-science background, in-house or
   contracted, or (b) scoped as a "build vs. buy" evaluation of a managed
   PII-detection API — which reopens the Tier 2 opt-in-only question ADR-001
   explicitly punts on, so isn't a free substitution either.

### Proposed follow-up work (not created as tickets by this role — proposed
back to solution-architect-lead / backend-team-lead per guardrail against
unilateral scope expansion):

- **Ticket A (cheap, high-leverage, in-scope for a Backend Engineer):** fix
  the Bucket 1 regex bugs in `tier1-detector.js` (space-tolerant label
  patterns, `\b` boundaries, `github_pat_` prefix, tighten the phone
  content-pattern) and re-run `npm run test:tier1` against the existing
  corpus to measure the delta. This alone is likely to meaningfully close the
  Tier A/B gap without touching ML at all.
- **Ticket B (scoping, not urgent):** a lightweight keyword/heuristic
  (non-ML) pass at `business_data`, `internal_url`, `pricing`,
  `generic_business_terms` — these are currently zero-implementation, and a
  rule-based first pass (similar in kind to the existing label heuristics)
  is a more realistic near-term win than ML for this specific category set.
- **Ticket C (deferred, needs ML/data-science staffing):** the actual
  ML/NER classifier for genuinely unlabeled free-text PII, once (a) Tickets A
  and B have been measured and the residual gap is known, and (b) the org has
  a way to staff ML-specific work. Trigger condition to revisit: core
  platform reaches a stability point where detection accuracy becomes an
  active blocker again, per the Chief Officer's framing.

## 4. Explicit non-actions in this pass

Per the assignment's guardrails, this pass did not modify
`extension/src/detection/tier1-detector.js` or anything under
`extension/test/**`. No model, dependency, or build tooling was added to the
repo.
