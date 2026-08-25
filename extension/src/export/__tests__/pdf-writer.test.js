import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfWriter, streamObject, escapePdfText } from '../pdf/pdf-writer.js';

function toLatin1(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

test('PdfWriter.build() emits a well-formed PDF header/xref/trailer', () => {
  const writer = new PdfWriter();
  const pagesId = writer.addObject('<< /Type /Pages /Kids [] /Count 0 >>');
  const catalogId = writer.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const out = writer.build(catalogId);
  const text = toLatin1(out);

  assert.match(text, /^%PDF-1\.4\n/);
  assert.match(text, /\d+ 0 obj\n<< \/Type \/Catalog/);
  assert.match(text, /\nxref\n/);
  assert.match(text, new RegExp(`trailer\\n<< /Size \\d+ /Root ${catalogId} 0 R >>`));
  assert.match(text, /%%EOF$/);
});

test('PdfWriter supports out-of-order setObject after reserveId (forward references)', () => {
  const writer = new PdfWriter();
  const reserved = writer.reserveId();
  const catalogId = writer.addObject(`<< /Type /Catalog /Pages ${reserved} 0 R >>`);
  writer.setObject(reserved, '<< /Type /Pages /Kids [] /Count 0 >>');
  const out = writer.build(catalogId);
  const text = toLatin1(out);
  assert.match(text, new RegExp(`${reserved} 0 obj\\n<< /Type /Pages`));
});

test('streamObject wraps content with a correct /Length and stream/endstream markers', () => {
  const obj = streamObject('BT /F1 10 Tf ET');
  const text = toLatin1(obj);
  assert.match(text, /<< \/Length 15 >>\nstream\nBT \/F1 10 Tf ET\nendstream/);
});

test('streamObject preserves raw binary bytes unchanged (e.g. JPEG payload)', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0x10, 0xff, 0xd9]);
  const obj = streamObject(bytes, ' /Filter /DCTDecode');
  const buf = Buffer.from(obj);
  const streamStart = buf.indexOf('stream\n') + 'stream\n'.length;
  const embedded = buf.subarray(streamStart, streamStart + bytes.length);
  assert.deepEqual(new Uint8Array(embedded), bytes);
});

test('escapePdfText escapes parentheses and backslashes for PDF string literals', () => {
  assert.equal(escapePdfText('a(b)c\\d'), 'a\\(b\\)c\\\\d');
});
