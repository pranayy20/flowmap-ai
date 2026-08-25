/**
 * Renders an export model (see ../data-loader.js) to a PDF, using the
 * hand-rolled writer in ./pdf-writer.js — no third-party PDF dependency.
 *
 * Layout is intentionally simple: fixed-pitch body text (Courier, a
 * standard base-14 font — no font embedding needed, so glyph widths are
 * exact without a font-metrics table), one block per step (heading + meta
 * + screenshot + field lines), paginated top-to-bottom. Screenshots are
 * embedded as JPEG XObjects (DCTDecode passthrough of the bytes produced
 * by ../image-utils.js — no re-encoding here).
 */

import { PdfWriter, streamObject, escapePdfText } from './pdf-writer.js';
import { safeFieldValue } from '../redact.js';

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BODY_SIZE = 10;
const HEADING_SIZE = 14;
const TITLE_SIZE = 16;
const LINE_GAP = 4;
const MAX_IMAGE_HEIGHT = 300;

// Courier is fixed-pitch: PDF base-14 metrics give it an exact 600/1000 em
// advance width, so `fontSize * 0.6` is the true glyph width, not an
// approximation — this is what makes word-wrap math exact without an
// embedded font width table.
function charWidth(fontSize) {
  return fontSize * 0.6;
}

function wrapLine(text, fontSize, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth(fontSize)));
  const lines = [];
  let current = '';

  for (const word of words) {
    let w = word;
    while (w.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function buildImageObject(screenshot) {
  const dictHeader = `<< /Type /XObject /Subtype /Image /Width ${screenshot.width} /Height ${screenshot.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${screenshot.bytes.length} >>\nstream\n`;
  const header = new TextEncoder().encode(dictHeader);
  const footer = new TextEncoder().encode('\nendstream');
  const out = new Uint8Array(header.length + screenshot.bytes.length + footer.length);
  out.set(header, 0);
  out.set(screenshot.bytes, header.length);
  out.set(footer, header.length + screenshot.bytes.length);
  return out;
}

/** @param {object} model export model produced by ../data-loader.js#loadExportModel */
export async function renderPdf(model) {
  const writer = new PdfWriter();
  const fontBoldId = writer.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
  const fontId = writer.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const pagesId = writer.reserveId();
  const catalogId = writer.reserveId();

  const pages = [];
  let page = null;
  let cursorY = 0;

  const startPage = () => {
    page = { id: writer.reserveId(), ops: [], images: new Map(), imgCounter: 0 };
    pages.push(page);
    cursorY = PAGE_HEIGHT - MARGIN;
  };

  const ensureSpace = (needed) => {
    if (!page || cursorY - needed < MARGIN) startPage();
  };

  const drawText = (text, fontSize, bold) => {
    const font = bold ? '/F1' : '/F2';
    page.ops.push(
      `BT ${font} ${fontSize} Tf ${MARGIN} ${cursorY.toFixed(2)} Td (${escapePdfText(text)}) Tj ET`
    );
    cursorY -= fontSize + LINE_GAP;
  };

  const drawWrapped = (text, fontSize, bold) => {
    for (const line of wrapLine(text, fontSize, CONTENT_WIDTH)) {
      ensureSpace(fontSize + LINE_GAP);
      drawText(line, fontSize, bold);
    }
  };

  const drawImage = (screenshot) => {
    const aspect = screenshot.height / screenshot.width;
    let dispWidth = CONTENT_WIDTH;
    let dispHeight = dispWidth * aspect;
    if (dispHeight > MAX_IMAGE_HEIGHT) {
      dispHeight = MAX_IMAGE_HEIGHT;
      dispWidth = dispHeight / aspect;
    }
    ensureSpace(dispHeight + LINE_GAP);
    const imgObjId = writer.addObject(buildImageObject(screenshot));
    const name = `Im${page.imgCounter++}`;
    page.images.set(name, imgObjId);
    const y = cursorY - dispHeight;
    page.ops.push(
      `q ${dispWidth.toFixed(2)} 0 0 ${dispHeight.toFixed(2)} ${MARGIN} ${y.toFixed(2)} cm /${name} Do Q`
    );
    cursorY -= dispHeight + LINE_GAP;
  };

  startPage();
  drawWrapped(model.session.title || 'Untitled recording session', TITLE_SIZE, true);
  drawWrapped(`Session ${model.session.id}`, 9, false);
  if (model.session.createdAt) {
    drawWrapped(`Recorded ${new Date(model.session.createdAt).toLocaleString()}`, 9, false);
  }
  cursorY -= 10;

  model.steps.forEach((stepModel, idx) => {
    const { step, fields, screenshot } = stepModel;
    ensureSpace(HEADING_SIZE + LINE_GAP);
    drawWrapped(`Step ${idx + 1}`, HEADING_SIZE, true);
    if (step.url) drawWrapped(step.url, 8, false);
    if (step.timestamp) drawWrapped(new Date(step.timestamp).toLocaleString(), 8, false);
    cursorY -= 4;

    if (screenshot) drawImage(screenshot);

    if (!fields.length) {
      drawWrapped('No field interactions captured for this step.', BODY_SIZE, false);
    } else {
      for (const field of fields) {
        const label = field.label || '(unlabeled field)';
        drawWrapped(`${label}: ${safeFieldValue(field)}`, BODY_SIZE, false);
      }
    }
    cursorY -= 12;
  });

  for (const p of pages) {
    const contentId = writer.addObject(streamObject(p.ops.join('\n')));
    const imgResources = [...p.images.entries()].map(([name, id]) => `/${name} ${id} 0 R`).join(' ');
    const resources = `<< /Font << /F1 ${fontBoldId} 0 R /F2 ${fontId} 0 R >> /XObject << ${imgResources} >> >>`;
    writer.setObject(
      p.id,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${contentId} 0 R >>`
    );
  }

  writer.setObject(
    pagesId,
    `<< /Type /Pages /Kids [${pages.map((p) => `${p.id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  );
  writer.setObject(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  return writer.build(catalogId);
}
