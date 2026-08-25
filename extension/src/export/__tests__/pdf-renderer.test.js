import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPdf } from '../pdf/pdf-renderer.js';
import { makeModel } from './fixtures.js';

function toLatin1(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

test('renderPdf produces bytes starting with the PDF magic header', async () => {
  const bytes = await renderPdf(makeModel());
  assert.equal(toLatin1(bytes.subarray(0, 5)), '%PDF-');
});

test('renderPdf embeds the screenshot as a DCTDecode Image XObject', async () => {
  const bytes = await renderPdf(makeModel());
  const text = toLatin1(bytes);
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/Width 640 \/Height 480/);
});

test('renderPdf includes plain field label/value text in a page content stream', async () => {
  const bytes = await renderPdf(makeModel());
  const text = toLatin1(bytes);
  assert.match(text, /Order ID: 42/);
});

test('renderPdf never embeds a redacted field\'s raw value in the underlying PDF bytes -- not in text, not disguised anywhere', async () => {
  const model = makeModel();
  model.steps[0].fields.push({ label: 'API Key', value: 'sk_live_should_never_appear_in_pdf', redacted: true, category: 'stripe_key' });
  const bytes = await renderPdf(model);
  const text = toLatin1(bytes);
  assert.doesNotMatch(text, /sk_live_should_never_appear_in_pdf/);
  assert.match(text, /\[Redacted stripe key\]/);
});

test('renderPdf paginates when content exceeds a single page (many fields)', async () => {
  const model = makeModel();
  model.steps[0].fields = Array.from({ length: 200 }, (_, i) => ({
    label: `Field ${i}`,
    value: `value-${i}`,
    redacted: false,
  }));
  const bytes = await renderPdf(model);
  const text = toLatin1(bytes);
  const pageCount = (text.match(/\/Type \/Page(?!s)/g) || []).length;
  assert.ok(pageCount > 1, `expected multiple pages, got ${pageCount}`);
});
