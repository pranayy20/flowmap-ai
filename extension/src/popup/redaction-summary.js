/**
 * Redaction status display (read-only).
 *
 * Explicitly NOT an accept/reject review UI — AI Privacy Review (manual
 * accept/reject of Tier 1 redactions) is deferred out of MVP scope per the
 * Chief Officer decision recorded 2026-08-25. This module only surfaces
 * counts of what the mandatory Tier 1 detector already redacted, reading
 * fields via fieldStore — it never lets the user un-redact or edit a value.
 */

import { stepStore, fieldStore } from '../storage/db.js';

const CATEGORY_LABELS = {
  password: 'password',
  mfa_otp: 'MFA/OTP code',
  ssn: 'SSN',
  credit_card: 'credit card number',
  bank_account: 'bank account number',
  email: 'email address',
  phone: 'phone number',
  address: 'address',
  aws_key: 'AWS key',
  stripe_key: 'Stripe key',
  github_token: 'GitHub token',
  google_api_key: 'Google API key',
  generic_secret: 'secret/token',
  jwt: 'JWT',
  private_key_block: 'private key',
  conservative_spread: 'nearby sensitive field',
};

function labelFor(category) {
  return CATEGORY_LABELS[category] || String(category || 'unknown').replace(/_/g, ' ');
}

function pluralize(count, label) {
  return count === 1 ? `1 ${label}` : `${count} ${label}s`;
}

/**
 * Aggregates redacted-field counts by category for a given session, across
 * all of that session's steps. Returns { total, byCategory, sentence }
 * where `sentence` is a display-ready string like "3 passwords, 1 API key
 * redacted this session", or null when there's nothing to show yet.
 */
export async function getRedactionSummary(sessionId) {
  if (!sessionId) return { total: 0, byCategory: {}, sentence: null };

  const steps = await stepStore.bySession(sessionId);
  const byCategory = {};
  let total = 0;

  for (const step of steps) {
    const fields = await fieldStore.byStep(step.id);
    for (const field of fields) {
      if (!field.redacted) continue;
      const key = field.category || 'unknown';
      byCategory[key] = (byCategory[key] || 0) + 1;
      total += 1;
    }
  }

  const sentence =
    total === 0
      ? null
      : `${Object.entries(byCategory)
          .sort((a, b) => b[1] - a[1])
          .map(([category, count]) => pluralize(count, labelFor(category)))
          .join(', ')} redacted this session`;

  return { total, byCategory, sentence };
}
