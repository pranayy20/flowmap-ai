import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZipWriter, crc32 } from '../docx/zip-writer.js';

// Minimal test-only ZIP reader (STORED entries only) -- independent of
// ZipWriter's own code, so this validates the actual on-disk byte layout
// rather than round-tripping through the same implementation.
function readStoredZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset < bytes.length) {
    const sig = dv.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const compression = dv.getUint16(offset + 8, true);
    const crc = dv.getUint32(offset + 14, true);
    const compSize = dv.getUint32(offset + 18, true);
    const nameLen = dv.getUint16(offset + 26, true);
    const extraLen = dv.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = Buffer.from(bytes.subarray(nameStart, nameStart + nameLen)).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    entries.push({ name, compression, crc, data });
    offset = dataStart + compSize;
  }
  return entries;
}

test('crc32 matches a known vector ("123456789" -> 0xCBF43926)', () => {
  assert.equal(crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
});

test('ZipWriter round-trips file contents and names exactly', () => {
  const zip = new ZipWriter();
  zip.addFile('hello.txt', 'hello world');
  zip.addFile('dir/nested.txt', 'nested content');
  const bytes = zip.build();

  const entries = readStoredZip(bytes);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'hello.txt');
  assert.equal(Buffer.from(entries[0].data).toString('utf8'), 'hello world');
  assert.equal(entries[1].name, 'dir/nested.txt');
  assert.equal(Buffer.from(entries[1].data).toString('utf8'), 'nested content');
});

test('ZipWriter uses compression method 0 (stored) and a correct CRC-32 per entry', () => {
  const zip = new ZipWriter();
  const content = 'binary-safe payload';
  zip.addFile('a.xml', content);
  const bytes = zip.build();
  const [entry] = readStoredZip(bytes);
  assert.equal(entry.compression, 0);
  assert.equal(entry.crc, crc32(Buffer.from(content)));
});

test('ZipWriter handles raw binary (non-UTF8) file data unchanged', () => {
  const zip = new ZipWriter();
  const bin = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f]);
  zip.addFile('img.bin', bin);
  const bytes = zip.build();
  const [entry] = readStoredZip(bytes);
  assert.deepEqual(new Uint8Array(entry.data), bin);
});

test('ZipWriter output ends with a valid End Of Central Directory record', () => {
  const zip = new ZipWriter();
  zip.addFile('only.txt', 'x');
  const bytes = zip.build();
  const eocdSig = bytes.subarray(bytes.length - 22, bytes.length - 18);
  assert.deepEqual([...eocdSig], [0x50, 0x4b, 0x05, 0x06]);
});
