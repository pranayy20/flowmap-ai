/**
 * Renders an export model (see ../data-loader.js) to a .docx (OOXML)
 * package, using the hand-rolled ./zip-writer.js — no third-party docx
 * dependency. Fields are rendered as plain "Label: value" paragraphs
 * (redaction placeholders substituted in, never the raw value — see
 * ../redact.js) and screenshots are embedded inline as JPEG media parts
 * referenced from word/document.xml via a standard <w:drawing>/<pic:pic>.
 */

import { ZipWriter } from './zip-writer.js';
import { safeFieldValue } from '../redact.js';

// 96px/inch screenshot assumption -> EMU (914400 EMU/inch == 9525 EMU/px).
const EMU_PER_PX = 9525;
const MAX_W_EMU = 6 * 914400; // 6in
const MAX_H_EMU = 4 * 914400; // 4in

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function xmlEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function paragraph(text, { bold = false, size } = {}) {
  const rPr = [];
  if (bold) rPr.push('<w:b/>');
  if (size) rPr.push(`<w:sz w:val="${size}"/>`);
  const rPrXml = rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';
  return `<w:p><w:r>${rPrXml}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function imageParagraph(screenshot, rid, n) {
  let w = screenshot.width * EMU_PER_PX;
  let h = screenshot.height * EMU_PER_PX;
  if (w > MAX_W_EMU) {
    h *= MAX_W_EMU / w;
    w = MAX_W_EMU;
  }
  if (h > MAX_H_EMU) {
    w *= MAX_H_EMU / h;
    h = MAX_H_EMU;
  }
  w = Math.round(w);
  h = Math.round(h);

  return `<w:p><w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${w}" cy="${h}"/>
      <wp:docPr id="${n}" name="Screenshot${n}"/>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic>
            <pic:nvPicPr>
              <pic:cNvPr id="${n}" name="Screenshot${n}.jpeg"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${rid}"/>
              <a:stretch><a:fillRect/></a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r></w:p>`;
}

/** @param {object} model export model produced by ../data-loader.js#loadExportModel */
export async function renderDocx(model) {
  const bodyParts = [];
  const rels = [];
  const media = [];
  let imgCounter = 0;

  bodyParts.push(paragraph(model.session.title || 'Untitled recording session', { bold: true, size: 32 }));
  bodyParts.push(paragraph(`Session ${model.session.id}`, { size: 16 }));
  if (model.session.createdAt) {
    bodyParts.push(paragraph(`Recorded ${new Date(model.session.createdAt).toLocaleString()}`, { size: 16 }));
  }

  model.steps.forEach((stepModel, idx) => {
    const { step, fields, screenshot } = stepModel;
    bodyParts.push(
      paragraph(`Step ${idx + 1}${step.description ? `: ${step.description}` : ''}`, { bold: true, size: 26 })
    );
    if (step.url) bodyParts.push(paragraph(step.url, { size: 16 }));
    if (step.timestamp) bodyParts.push(paragraph(new Date(step.timestamp).toLocaleString(), { size: 16 }));

    if (screenshot) {
      imgCounter += 1;
      const rid = `rId${imgCounter}`;
      const mediaName = `image${imgCounter}.jpeg`;
      media.push({ name: `word/media/${mediaName}`, bytes: screenshot.bytes });
      rels.push({ id: rid, target: `media/${mediaName}` });
      bodyParts.push(imageParagraph(screenshot, rid, imgCounter));
    }

    if (!fields.length) {
      bodyParts.push(paragraph('No field interactions captured for this step.'));
    } else {
      for (const field of fields) {
        const label = field.label || '(unlabeled field)';
        bodyParts.push(paragraph(`${label}: ${safeFieldValue(field)}`));
      }
    }
  });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyParts.join('\n')}
    <w:sectPr/>
  </w:body>
</w:document>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${r.target}"/>`
    )
    .join('\n')}
</Relationships>`;

  const zip = new ZipWriter();
  zip.addFile('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.addFile('_rels/.rels', ROOT_RELS_XML);
  zip.addFile('word/document.xml', documentXml);
  zip.addFile('word/_rels/document.xml.rels', relsXml);
  for (const m of media) zip.addFile(m.name, m.bytes);

  return zip.build();
}
