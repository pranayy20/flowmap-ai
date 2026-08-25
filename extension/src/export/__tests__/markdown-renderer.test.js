import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../markdown-renderer.js';
import { makeModel } from './fixtures.js';

test('renderMarkdown includes session title and step headings', () => {
  const md = renderMarkdown(makeModel());
  assert.match(md, /^# Refund a customer order/m);
  assert.match(md, /## Step 1/);
  assert.match(md, /## Step 2/);
});

test('renderMarkdown inlines field label/value pairs per step', () => {
  const md = renderMarkdown(makeModel());
  assert.match(md, /\| Order ID \| 42 \|/);
});

test('renderMarkdown never emits a redacted field\'s raw value, only the placeholder', () => {
  const model = makeModel();
  model.steps[0].fields.push({ label: 'API Key', value: 'sk_live_abcdef123456', redacted: true, category: 'stripe_key' });
  const md = renderMarkdown(model);
  assert.doesNotMatch(md, /sk_live_abcdef123456/);
  // Markdown-escapes brackets like any other special char (see escapeMd) --
  // this still renders as "[Redacted stripe key]" to a Markdown viewer.
  assert.match(md, /\\\[Redacted stripe key\\\]/);
});

test('renderMarkdown embeds screenshots as a base64 data-URI image link', () => {
  const md = renderMarkdown(makeModel());
  assert.match(md, /!\[Step 1 screenshot\]\(data:image\/jpeg;base64,[A-Za-z0-9+/=]+\)/);
});

test('renderMarkdown notes steps with no captured fields', () => {
  const md = renderMarkdown(makeModel());
  assert.match(md, /_No field interactions captured for this step\._/);
});

test('renderMarkdown escapes markdown special characters in labels/values', () => {
  const model = makeModel({
    steps: [
      {
        step: { id: 's', url: null, timestamp: null },
        fields: [{ label: '*bold* field', value: '[link](evil)', redacted: false }],
        screenshot: null,
      },
    ],
  });
  const md = renderMarkdown(model);
  assert.match(md, /\\\*bold\\\* field/);
  assert.match(md, /\\\[link\\\]\\\(evil\\\)/);
});
