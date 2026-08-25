/**
 * Minimal, dependency-free PDF 1.4 file writer.
 *
 * This is NOT a general-purpose PDF library — it's just enough of the
 * object model (indirect objects, a classic cross-reference table, a
 * trailer) to emit a valid, viewer-readable PDF from hand-built object
 * bodies (dictionaries/streams as plain strings or raw bytes). No
 * compression, no font embedding, no third-party dependency — see the PR
 * description for why a small hand-rolled writer was chosen over adding a
 * dependency for this Chrome-extension-only ticket.
 */

const textEncoder = new TextEncoder();

export class PdfWriter {
  constructor() {
    this._objects = new Map(); // id -> Uint8Array | string (object body only, no "N 0 obj"/"endobj" wrapper)
    this._nextId = 1;
  }

  /** Reserve an object number without content yet (fill in later with setObject). */
  reserveId() {
    return this._nextId++;
  }

  setObject(id, content) {
    this._objects.set(id, content);
  }

  /** Reserve + set an object body in one call, returns the new object's id. */
  addObject(content) {
    const id = this.reserveId();
    this.setObject(id, content);
    return id;
  }

  build(catalogId) {
    const chunks = [];
    let offset = 0;
    const push = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };

    push(textEncoder.encode('%PDF-1.4\n'));
    // Conventional "binary marker" comment so tools that sniff the first
    // few bytes treat this as a binary file — four bytes >= 0x80.
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const xrefOffsets = new Map();
    const ids = [...this._objects.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      xrefOffsets.set(id, offset);
      const content = this._objects.get(id);
      const bodyBytes = content instanceof Uint8Array ? content : textEncoder.encode(content);
      push(textEncoder.encode(`${id} 0 obj\n`));
      push(bodyBytes);
      push(textEncoder.encode('\nendobj\n'));
    }

    const xrefOffset = offset;
    const maxId = ids.length ? Math.max(...ids) : 0;
    let xrefTable = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= maxId; i++) {
      if (xrefOffsets.has(i)) {
        xrefTable += `${String(xrefOffsets.get(i)).padStart(10, '0')} 00000 n \n`;
      } else {
        xrefTable += '0000000000 00000 f \n';
      }
    }
    push(textEncoder.encode(xrefTable));
    push(
      textEncoder.encode(
        `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
      )
    );

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

/** Wraps a content string as a PDF stream object body (`<< /Length n >>\nstream\n...\nendstream`). */
export function streamObject(content, extraDictEntries = '') {
  const bodyBytes = content instanceof Uint8Array ? content : textEncoder.encode(content);
  const header = textEncoder.encode(`<< /Length ${bodyBytes.length}${extraDictEntries} >>\nstream\n`);
  const footer = textEncoder.encode('\nendstream');
  const out = new Uint8Array(header.length + bodyBytes.length + footer.length);
  out.set(header, 0);
  out.set(bodyBytes, header.length);
  out.set(footer, header.length + bodyBytes.length);
  return out;
}

export function escapePdfText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}
