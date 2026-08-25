import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../html-renderer.js';
import { makeModel } from './fixtures.js';

test('renderHtml produces a self-contained HTML document', () => {
  const html = renderHtml(makeModel());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/); // inline CSS, no external stylesheet fetch
  assert.doesNotMatch(html, /<link[^>]+href/);
});

test('renderHtml embeds screenshots inline as base64 <img> data URIs', () => {
  const html = renderHtml(makeModel());
  assert.match(html, /<img class="screenshot" src="data:image\/jpeg;base64,[A-Za-z0-9+/=]+"/);
});

test('renderHtml renders field values in a table, redacted fields show only the placeholder', () => {
  const html = renderHtml(makeModel());
  assert.match(html, /<td>Order ID<\/td><td>42<\/td>/);
  assert.match(html, /<td>Customer Email<\/td><td>\[Redacted email\]<\/td>/);
  assert.doesNotMatch(html, /\[Redacted email\][^<]*<\/td>.*@/); // no leaked address near the placeholder
});

test('renderHtml never emits a redacted raw value anywhere in the markup, including attributes', () => {
  const model = makeModel();
  model.steps[0].fields.push({ label: 'Password', value: 'hunter2-super-secret', redacted: true, category: 'password' });
  const html = renderHtml(model);
  assert.doesNotMatch(html, /hunter2-super-secret/);
});

test('renderHtml escapes HTML special characters to prevent markup injection from field values', () => {
  const model = makeModel({
    steps: [
      { step: { id: 's', url: null, timestamp: null }, fields: [{ label: '<script>x</script>', value: '"><img onerror=alert(1)>', redacted: false }], screenshot: null },
    ],
  });
  const html = renderHtml(model);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /<img onerror=alert\(1\)>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
});
