# Tier 1 Detector — Adversarial Test Corpus & Scoring Harness

Tests `extension/src/detection/tier1-detector.js`'s `classifyField()` against a
hand-authored, synthetic adversarial corpus and produces a confusion-matrix
(TP/FP/FN/TN) report scored against the binding accuracy bar from ADR-001 /
director-security:

| Tier | Recall bar | Precision bar |
|---|---|---|
| A — critical | >= 99.5% | >= 90% |
| B — moderate | >= 95% | >= 85% |
| C — low-stakes | >= 85% | (none set) |

## Run it

```
node extension/test/run-scoring.js
# or
npm run test:tier1
```

Prints a per-tier and per-category confusion matrix to stdout and writes the
full machine-readable report to `extension/test/results/latest-run.json`.
`--ci` makes the process exit non-zero if the Tier A bar isn't met (for future
CI wiring — not currently invoked by any workflow).

## Corpus layout

`extension/test/corpus/tier-{a,b,c}.corpus.js` — plain JS arrays of samples,
one per field-instance:

```js
{
  id, tier, category, type,     // type: 'positive' | 'hard_negative'
  variant,                       // short label for the evasion format / edge case
  field: { label, name, placeholder, type, value },   // fed directly to classifyField()
  expected: { redact, tier, category },
}
```

All values are synthetic/fabricated (fake SSNs, fake-but-correctly-formatted
API keys, RFC-reserved-style test data) — no real personal data or working
credentials, per the assignment guardrail.

## Scale vs. qa-team-lead's full Sprint 1 design

The full design specified 900 / 630 / 250 samples for Tier A / B / C. This
pass ships a genuinely-authored subset, not a mechanically-padded one:

- Tier A: 96 samples (~10.7% of 900) across 6 subcategories (ssn, credit_card,
  api keys/secrets [7 sub-formats], password, mfa_otp, bank_account), each
  with both the required evasion-format positives (SSN with/without dashes;
  grouped/ungrouped credit card numbers of varying lengths; AKIA/ASIA,
  sk_live_/sk_test_, ghp_/github_pat_, AIza-prefixed keys AND generic
  no-prefix secrets) and hard negatives designed to probe specific regex
  weaknesses.
- Tier B: 34 samples (~5.4% of 630) across email, phone, address, business_data,
  internal_url.
- Tier C: 12 samples (~4.8% of 250) across pricing, generic_business_terms.

This is a first-pass adversarial corpus, not exhaustive coverage — it is
sized to surface real classes of bugs (which it did — see below), not to be
a statistically-representative sample of production traffic.

## Scoring rule (per field-instance)

- `positive` sample: TP if `classifyField()` returns `redact:true` **and**
  `tier` matches the sample's expected tier; otherwise FN. Attributed to the
  sample's own tier/category (what recall is measured against).
- `hard_negative` sample: FP if `classifyField()` returns `redact:true` —
  attributed to whichever tier/category the detector *actually* fired under
  (not the category the hard negative was designed to probe), since that's
  the detector rule whose precision is genuinely affected. Otherwise TN.

One consequence: a category's own bucket in the per-category table only
contains the hard negatives that, when they misfire, fire under that same
category. A hard negative designed to probe SSN but that the detector
(incorrectly) classifies as `phone` shows up as an FP under `phone`, not
`ssn` — this is intentional and is what makes the per-category precision
numbers reflect what each rule is actually catching, not just what it was
aimed at.

## Result as of this run — every tier fails the bar

This is a real test run against the current hard-rule implementation, not a
mock, and the corpus was not tuned to make it pass. Headline numbers (see
`results/latest-run.json` for the full breakdown and the individual
FN/FP sample list):

| Tier | n | Recall | Precision |
|---|---|---|---|
| A | 96 | 81.16% (bar 99.5%) — **FAIL** | 81.16% (bar 90%) — **FAIL** |
| B | 34 | 48.15% (bar 95%) — **FAIL** | 65.00% (bar 85%) — **FAIL** |
| C | 12 | 0.00% (bar 85%) — **FAIL** | n/a (no bar) |

Notable root causes found (not an exhaustive list — see the FN/FP dump in the
harness output and `results/latest-run.json`):

1. **Several `LABEL_HEURISTICS` regexes require an underscore/dash to join
   compound words and don't tolerate a plain space** (`social[_-]?security`,
   `card[_-]?number`, `account[_-]?number`, `api[_-]?key`,
   `verification[_-]?code`, `auth(entication)?[_-]?code`). Natural
   human-readable form labels ("Social Security Number", "Account Number",
   "API Key", "Auth Code") do **not** match — only `social_security`,
   `account-number`, `api_key`, etc. do. This alone accounts for a large
   share of the Tier A FNs.
2. **Several `LABEL_HEURISTICS` patterns have no `\b` word-boundary around
   the keyword**, so they substring-match unrelated labels: the password
   pattern (`pass|secret|token`) flags `passenger_name`, `secretary_name`,
   `tokenizer_config`, `bypass_flag`, `compass_bearing`; the address pattern
   (`zip`) flags `Zip Code` correctly but also `IP Address`. This drives a
   meaningful share of the FPs.
3. **No content-pattern fallback exists at all** for `mfa_otp`,
   `bank_account`, or `address` — if the field label doesn't match, a bare
   OTP digit string, IBAN, or street address in an unlabeled/mislabeled field
   is never caught by content alone.
4. **`generic_secret`'s catch-all (`[A-Za-z0-9_-]{32,64}`) is very
   imprecise** (55.6% precision in isolation) — it also matches git SHAs,
   dash-stripped UUIDs, and long English slugs/phrases with no separators.
5. **The phone content-pattern is dangerously overbroad**: every component
   (country code, area code, separators) is optional, so it matches almost
   any 10–13-digit run regardless of grouping. This produces phone FPs from
   SSN- and credit-card-shaped hard negatives, and in one case **silently
   downgrades a Tier A bank account number to a Tier B phone match** once the
   (space-broken) label heuristic misses it — a mis-tier, not just a miss.
6. **`github_pat_` (GitHub's newer fine-grained PAT prefix) is not covered**
   by `gh[pousr]_` — only the legacy `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`
   prefixes are.
7. **Tier B `business_data` and `internal_url`, and all of Tier C
   (`pricing`, `generic_business_terms`), have zero implementation** — no
   label or content rule targets them at all, so recall is 0% by
   construction. This matches the README's documented "Known gaps" (no
   ML/NER classifier yet) but is now measured, not just asserted.

None of the above were fixed as part of this ticket — per the assignment
guardrail, tuning the corpus or the detector to force a pass is explicitly
out of scope for QA automation. These are reported as findings for
`appsec-team-lead` / `solution-architect-lead` to prioritize.
