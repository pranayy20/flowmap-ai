/**
 * LOCAL export rendering entry point (category 1 of 3 in the accepted
 * export-pipeline scope split — no OAuth, no external API calls, no
 * network requests anywhere in this module or its dependencies).
 *
 * Confluence/Notion export (OAuth) and shareable-link (public hosting) are
 * separate, out-of-scope tickets — this only renders a completed recording
 * session (read from IndexedDB/OPFS via ../storage/db.js) into a
 * downloadable Markdown/HTML/PDF/DOCX Blob.
 */

import { sessionStore } from '../storage/db.js';
import { loadExportModel } from './data-loader.js';
import { renderMarkdown } from './markdown-renderer.js';
import { renderHtml } from './html-renderer.js';
import { renderPdf } from './pdf/pdf-renderer.js';
import { renderDocx } from './docx/docx-renderer.js';

export const ExportFormat = Object.freeze({
  MARKDOWN: 'markdown',
  HTML: 'html',
  PDF: 'pdf',
  DOCX: 'docx',
});

const MIME_TYPES = {
  [ExportFormat.MARKDOWN]: 'text/markdown',
  [ExportFormat.HTML]: 'text/html',
  [ExportFormat.PDF]: 'application/pdf',
  [ExportFormat.DOCX]: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const EXTENSIONS = {
  [ExportFormat.MARKDOWN]: 'md',
  [ExportFormat.HTML]: 'html',
  [ExportFormat.PDF]: 'pdf',
  [ExportFormat.DOCX]: 'docx',
};

function slugify(text) {
  const slug = (text || 'session')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug || 'session';
}

/**
 * Renders a single already-loaded session object to the requested format.
 * @param {object} session a row from sessionStore (has at least `id`)
 * @param {'markdown'|'html'|'pdf'|'docx'} format
 * @param {object} [deps] injectable store/artifact overrides, for testing
 */
export async function exportSession(session, format, deps = {}) {
  if (!Object.values(ExportFormat).includes(format)) {
    throw new Error(`Unknown export format: ${format}`);
  }

  const model = await loadExportModel(session, deps);

  let content;
  switch (format) {
    case ExportFormat.MARKDOWN:
      content = renderMarkdown(model);
      break;
    case ExportFormat.HTML:
      content = renderHtml(model);
      break;
    case ExportFormat.PDF:
      content = await renderPdf(model);
      break;
    case ExportFormat.DOCX:
      content = await renderDocx(model);
      break;
  }

  const mimeType = MIME_TYPES[format];
  const blob = new Blob([content], { type: mimeType });
  const filename = `${slugify(session.title)}.${EXTENSIONS[format]}`;
  return { blob, filename, mimeType };
}

/**
 * Convenience wrapper: looks the session up by id (sessionStore.get, added
 * alongside this ticket — see ../storage/db.js) and exports it.
 */
export async function exportSessionById(sessionId, format, deps = {}) {
  const { sessionStore: sessions_ = sessionStore } = deps;
  const session = await sessions_.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return exportSession(session, format, deps);
}

export { loadExportModel, renderMarkdown, renderHtml, renderPdf, renderDocx };
