/**
 * Tier 1 on-device sensitive-data detector, per ADR-001.
 *
 * This is the MANDATORY DEFAULT redaction path — it runs on every captured
 * field regardless of save destination (Keep Local / Save to Workspace /
 * Export). There is no human review layer in MVP (AI Privacy Review is
 * deferred), so this module IS the product's privacy guarantee. Treat any
 * change here as a security-sensitive change, not a routine refactor.
 *
 * Accuracy bar (binding, set by director-security):
 *   Tier A (critical): recall >= 99.5%, precision >= 90%
 *   Tier B (moderate):  recall >= 95%,   precision >= 85%
 *   Tier C (low-stakes): recall >= 85%
 *
 * Fail-closed design: Tier A detection is a HARD-RULE layer (regex +
 * label-context heuristics), not a confidence-scored ML gate — ambiguous or
 * low-confidence matches are redacted, never passed through. There is no
 * ML/NER classifier in this first pass (see README "Known gaps" — the ONNX
 * classifier for unlabeled free-text detection is tracked separately and is
 * NOT a blocker for this hard-rule layer to ship).
 */

export const Tier = Object.freeze({ A: 'A', B: 'B', C: 'C', NONE: null });

// Field-label heuristics: if a field's label/name/placeholder/type matches
// one of these, the VALUE is always redacted regardless of its content.
// This is the primary Tier A defense — independent of pattern matching,
// because a password or secret's *content* can look like anything.
const LABEL_HEURISTICS = [
  { tier: Tier.A, category: 'password', pattern: /pass(word)?|pwd|secret|token|api[_-]?key/i },
  { tier: Tier.A, category: 'mfa_otp', pattern: /\b(otp|mfa|2fa|verification[_-]?code|auth(entication)?[_-]?code)\b/i },
  { tier: Tier.A, category: 'ssn', pattern: /\b(ssn|social[_-]?security)\b/i },
  { tier: Tier.A, category: 'credit_card', pattern: /\b(card[_-]?number|cc[_-]?num|credit[_-]?card)\b/i },
  { tier: Tier.A, category: 'bank_account', pattern: /\b(account[_-]?number|routing[_-]?number|iban|swift)\b/i },
  { tier: Tier.B, category: 'email', pattern: /\bemail\b/i },
  { tier: Tier.B, category: 'phone', pattern: /\bphone|mobile|tel(ephone)?\b/i },
  { tier: Tier.B, category: 'address', pattern: /\baddress|street|zip|postal\b/i },
];

// Content-pattern heuristics: applied to the field VALUE when no label match
// fired, or as defense-in-depth even when one did. Covers the "bare value,
// no helpful label" case (open_question in ADR-001: unlabeled free text is
// the harder case for this first pass — patterns below are the hard-rule
// backstop, not a full NER classifier).
const CONTENT_PATTERNS = [
  // Tier A — critical
  { tier: Tier.A, category: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b(?=\D|$)/ },
  { tier: Tier.A, category: 'credit_card', pattern: /\b(?:\d[ -]*?){13,19}\b/ },
  { tier: Tier.A, category: 'aws_key', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { tier: Tier.A, category: 'stripe_key', pattern: /\bsk_(live|test)_[0-9a-zA-Z]{16,}\b/ },
  { tier: Tier.A, category: 'github_token', pattern: /\bgh[pousr]_[0-9a-zA-Z]{36,}\b/ },
  { tier: Tier.A, category: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { tier: Tier.A, category: 'generic_secret', pattern: /\b[A-Za-z0-9_-]{32,64}\b/ }, // broad net, tuned in adversarial corpus pass
  { tier: Tier.A, category: 'jwt', pattern: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/ },
  { tier: Tier.A, category: 'private_key_block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // Tier B — moderate
  { tier: Tier.B, category: 'email', pattern: /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/ },
  { tier: Tier.B, category: 'phone', pattern: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
];

/**
 * Classify a single captured field. Returns { tier, category, redact }.
 * `redact` is always true for Tier A/B matches (fail-closed — no confidence
 * threshold gates a Tier A hard-rule match). Tier C is signal-only in this
 * pass, not yet wired to redact (product-signal quality, not a security
 * control, per the accuracy bar's own framing).
 */
export function classifyField({ label = '', name = '', placeholder = '', type = '', value = '' }) {
  const labelText = `${label} ${name} ${placeholder} ${type}`;

  for (const rule of LABEL_HEURISTICS) {
    if (rule.pattern.test(labelText)) {
      return { tier: rule.tier, category: rule.category, redact: true, matchedOn: 'label' };
    }
  }

  for (const rule of CONTENT_PATTERNS) {
    if (rule.pattern.test(value)) {
      return { tier: rule.tier, category: rule.category, redact: true, matchedOn: 'content' };
    }
  }

  return { tier: Tier.NONE, category: null, redact: false, matchedOn: null };
}

/**
 * Fail-closed conservative-region rule: if a Tier A field was detected
 * anywhere on the same form/page, sibling fields with no independent match
 * are still flagged for conservative redaction — per ADR-001 ("unclassifiable
 * regions adjacent to a detected Tier A field are conservatively redacted
 * too, not just the exact matched span").
 */
export function applyConservativeSpread(classifiedFields) {
  const hasTierAOnPage = classifiedFields.some((f) => f.classification.tier === Tier.A);
  if (!hasTierAOnPage) return classifiedFields;

  return classifiedFields.map((f) => {
    if (f.classification.tier !== Tier.NONE) return f;
    return {
      ...f,
      classification: { tier: Tier.A, category: 'conservative_spread', redact: true, matchedOn: 'adjacency' },
    };
  });
}

/**
 * Destructively redact a value for storage/export. This must be applied at
 * the data layer (before persistence), not as a display-only overlay — see
 * qa-team-lead's destructive-redaction requirement. Returns a placeholder,
 * never the original value or a reversible transform of it.
 */
export function redactValue(category) {
  const label = category ? category.replace(/_/g, ' ') : 'sensitive value';
  return `[Redacted ${label}]`;
}
