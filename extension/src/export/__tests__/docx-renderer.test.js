import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocx } from '../docx/docx-renderer.js';
import { makeModel } from './fixtures.js';

// Minimal test-only ZIP reader (mirrors zip-writer.test.js) so this test
// validates actual output bytes, not the ZipWriter implementation itself.
function readStoredZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const sig = dv.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const compSize = dv.getUint32(offset + 18, true);
    const nameLen = dv.getUint16(offset + 26, true);
    const extraLen = dv.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = Buffer.from(bytes.subarray(nameStart, nameStart + nameLen)).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    entries.set(name, bytes.subarray(dataStart, dataStart + compSize));
    offset = dataStart + compSize;
  }
  return entries;
}

test('renderDocx produces a ZIP package with the required OOXML parts', async () => {
  const bytes = await renderDocx(makeModel());
  const entries = readStoredZip(bytes);
  assert.ok(entries.has('[Content_Types].xml'));
  assert.ok(entries.has('_rels/.rels'));
  assert.ok(entries.has('word/document.xml'));
  assert.ok(entries.has('word/_rels/document.xml.rels'));
});

test('renderDocx embeds the screenshot as a media part referenced from document.xml.rels', async () => {
  const bytes = await renderDocx(makeModel());
  const entries = readStoredZip(bytes);
  assert.ok(entries.has('word/media/image1.jpeg'));
  const rels = Buffer.from(entries.get('word/_rels/document.xml.rels')).toString('utf8');
  assert.match(rels, /Target="media\/image1\.jpeg"/);
  const doc = Buffer.from(entries.get('word/document.xml')).toString('utf8');
  assert.match(doc, /r:embed="rId1"/);
});

test('renderDocx inlines field label/value text in document.xml', async () => {
  const bytes = await renderDocx(makeModel());
  const entries = readStoredZip(bytes);
  const doc = Buffer.from(entries.get('word/document.xml')).toString('utf8');
  assert.match(doc, /Order ID: 42/);
});

test('renderDocx never retains a redacted field\'s raw value in the document XML structure', async () => {
  const model = makeModel();
  model.steps[0].fields.push({ label: 'Password', value: 'hunter2-should-not-be-in-xml', redacted: true, category: 'password' });
  const bytes = await renderDocx(model);
  const entries = readStoredZip(bytes);
  const doc = Buffer.from(entries.get('word/document.xml')).toString('utf8');
  assert.doesNotMatch(doc, /hunter2-should-not-be-in-xml/);
  assert.match(doc, /\[Redacted password\]/);
  // Also check the raw file bytes end-to-end (not just the parsed part) --
  // this is the "black box over intact text/XML" failure mode qa flagged.
  assert.doesNotMatch(Buffer.from(bytes).toString('latin1'), /hunter2-should-not-be-in-xml/);
});

test('renderDocx escapes XML special characters in field labels/values', async () => {
  const model = makeModel({
    steps: [
      { step: { id: 's', url: null, timestamp: null }, fields: [{ label: 'Notes <b>', value: 'A & B < C', redacted: false }], screenshot: null },
    ],
  });
  const bytes = await renderDocx(model);
  const entries = readStoredZip(bytes);
  const doc = Buffer.from(entries.get('word/document.xml')).toString('utf8');
  assert.doesNotMatch(doc, /Notes <b>/);
  assert.match(doc, /Notes &lt;b&gt;/);
  assert.match(doc, /A &amp; B &lt; C/);
});
