/**
 * Export-time redaction guard.
 *
 * The Tier 1 detector (../detection/tier1-detector.js, NOT modified by this
 * ticket) already writes the destructive placeholder into `field.value`
 * before a redacted field is ever persisted to IndexedDB — see that file's
 * `redactValue()` and the README's privacy model ("redacted on-device...
 * before it's ever written to storage").
 *
 * This module is defense-in-depth at the export boundary, not a
 * reimplementation of that control: every renderer in this package MUST
 * call `safeFieldValue()` instead of reading `field.value` directly. If a
 * field is flagged `redacted: true`, the placeholder is recomputed from
 * `field.category` alone and `field.value` is never read or embedded
 * anywhere in the exported artifact — so a hypothetical upstream bug that
 * let a raw value slip into storage despite `redacted: true` still cannot
 * surface in Markdown/HTML/PDF/DOCX output. This is what qa-team-lead's
 * "black box over intact text/XML" failure mode requires: the underlying
 * markup must never retain the original value, not just visually hide it.
 */

import { redactValue } from '../detection/tier1-detector.js';

export function safeFieldValue(field) {
  if (!field) return '';
  if (field.redacted) {
    return redactValue(field.category);
  }
  return field.value === undefined || field.value === null ? '' : String(field.value);
}
