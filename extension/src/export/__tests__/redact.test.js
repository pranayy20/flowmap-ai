import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFieldValue } from '../redact.js';

test('safeFieldValue returns the raw value for a non-redacted field', () => {
  assert.equal(safeFieldValue({ redacted: false, value: 'hello@example.com', category: 'email' }), 'hello@example.com');
});

test('safeFieldValue ignores field.value entirely when redacted is true', () => {
  // Simulates the failure mode this ticket must guard against: a raw value
  // that somehow made it into storage despite redacted:true.
  const field = { redacted: true, value: 'sk_live_should_never_appear', category: 'stripe_key' };
  const out = safeFieldValue(field);
  assert.equal(out, '[Redacted stripe key]');
  assert.doesNotMatch(out, /sk_live_should_never_appear/);
});

test('safeFieldValue placeholder format matches the Tier 1 detector redactValue() output', () => {
  assert.equal(safeFieldValue({ redacted: true, category: 'ssn', value: '123-45-6789' }), '[Redacted ssn]');
});

test('safeFieldValue handles a redacted field with no category', () => {
  assert.equal(safeFieldValue({ redacted: true, category: null, value: 'x' }), '[Redacted sensitive value]');
});

test('safeFieldValue handles null/undefined values gracefully', () => {
  assert.equal(safeFieldValue({ redacted: false, value: null }), '');
  assert.equal(safeFieldValue({ redacted: false, value: undefined }), '');
  assert.equal(safeFieldValue(null), '');
});

test('safeFieldValue coerces non-string values to strings', () => {
  assert.equal(safeFieldValue({ redacted: false, value: 42 }), '42');
});
