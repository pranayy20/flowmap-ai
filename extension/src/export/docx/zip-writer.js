/**
 * Minimal, dependency-free ZIP writer (STORED/uncompressed entries only).
 *
 * DOCX (OOXML) is a ZIP package, but the ZIP spec does not require
 * compression — method 0 ("stored") is a fully valid, spec-compliant entry
 * type that every standard ZIP/DOCX reader (including Word) accepts. That
 * lets this stay a hand-rolled, dependency-free writer: no DEFLATE
 * implementation needed, just correct local/central-directory headers and
 * CRC-32 checksums.
 */

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();

export class ZipWriter {
  constructor() {
    this._entries = [];
  }

  addFile(name, data) {
    const bytes = typeof data === 'string' ? textEncoder.encode(data) : data;
    this._entries.push({ name, bytes, crc: crc32(bytes) });
  }

  build() {
    const chunks = [];
    let offset = 0;
    const push = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };

    const centralRecords = [];

    for (const entry of this._entries) {
      const nameBytes = textEncoder.encode(entry.name);
      const localOffset = offset;
      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true); // local file header signature
      dv.setUint16(4, 20, true); // version needed to extract
      dv.setUint16(6, 0, true); // flags
      dv.setUint16(8, 0, true); // compression method: stored
      dv.setUint16(10, 0, true); // mod time
      dv.setUint16(12, 0x21, true); // mod date (arbitrary valid MS-DOS date)
      dv.setUint32(14, entry.crc, true);
      dv.setUint32(18, entry.bytes.length, true); // compressed size == uncompressed (stored)
      dv.setUint32(22, entry.bytes.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true); // extra field length
      local.set(nameBytes, 30);
      push(local);
      push(entry.bytes);

      centralRecords.push({ nameBytes, crc: entry.crc, size: entry.bytes.length, localOffset });
    }

    const centralStart = offset;
    for (const rec of centralRecords) {
      const central = new Uint8Array(46 + rec.nameBytes.length);
      const dv = new DataView(central.buffer);
      dv.setUint32(0, 0x02014b50, true); // central directory header signature
      dv.setUint16(4, 20, true); // version made by
      dv.setUint16(6, 20, true); // version needed to extract
      dv.setUint16(8, 0, true); // flags
      dv.setUint16(10, 0, true); // compression method
      dv.setUint16(12, 0, true); // mod time
      dv.setUint16(14, 0x21, true); // mod date
      dv.setUint32(16, rec.crc, true);
      dv.setUint32(20, rec.size, true);
      dv.setUint32(24, rec.size, true);
      dv.setUint16(28, rec.nameBytes.length, true);
      dv.setUint16(30, 0, true); // extra length
      dv.setUint16(32, 0, true); // comment length
      dv.setUint16(34, 0, true); // disk number start
      dv.setUint16(36, 0, true); // internal attrs
      dv.setUint32(38, 0, true); // external attrs
      dv.setUint32(42, rec.localOffset, true);
      central.set(rec.nameBytes, 46);
      push(central);
    }
    const centralSize = offset - centralStart;

    const end = new Uint8Array(22);
    const dv = new DataView(end.buffer);
    dv.setUint32(0, 0x06054b50, true); // end of central directory signature
    dv.setUint16(4, 0, true); // disk number
    dv.setUint16(6, 0, true); // disk with central dir start
    dv.setUint16(8, centralRecords.length, true);
    dv.setUint16(10, centralRecords.length, true);
    dv.setUint32(12, centralSize, true);
    dv.setUint32(16, centralStart, true);
    dv.setUint16(20, 0, true); // comment length
    push(end);

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}
