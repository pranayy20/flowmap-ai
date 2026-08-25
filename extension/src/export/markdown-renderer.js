import { safeFieldValue } from './redact.js';
import { bytesToBase64 } from './image-utils.js';

function escapeMd(text) {
  return String(text ?? '').replace(/([\\`*_{}[\]()#+\-.!|])/g, '\\$1');
}

/**
 * Renders an export model (see data-loader.js) to Markdown. Screenshots are
 * embedded as data-URI image links (`![alt](data:image/jpeg;base64,...)`)
 * rather than written out as sibling files — this keeps the export a single
 * self-contained artifact and still satisfies "Markdown can reference/embed
 * as an image link" per the ticket's acceptance criteria.
 */
export function renderMarkdown(model) {
  const { session, steps } = model;
  const lines = [];

  lines.push(`# ${escapeMd(session.title || 'Untitled recording session')}`);
  lines.push('');
  lines.push(`- Session ID: \`${session.id}\``);
  if (session.createdAt) lines.push(`- Recorded: ${new Date(session.createdAt).toLocaleString()}`);
  if (session.status) lines.push(`- Status: ${session.status}`);
  lines.push('');

  steps.forEach((stepModel, idx) => {
    const { step, fields, screenshot } = stepModel;
    lines.push(`## Step ${idx + 1}`);
    lines.push('');
    if (step.url) lines.push(`URL: ${step.url}`);
    if (step.timestamp) lines.push(`Time: ${new Date(step.timestamp).toLocaleString()}`);
    if (step.url || step.timestamp) lines.push('');

    if (screenshot) {
      const b64 = bytesToBase64(screenshot.bytes);
      lines.push(`![Step ${idx + 1} screenshot](data:${screenshot.mime};base64,${b64})`);
      lines.push('');
    }

    if (fields.length === 0) {
      lines.push('_No field interactions captured for this step._');
    } else {
      lines.push('| Field | Value |');
      lines.push('|---|---|');
      for (const field of fields) {
        const label = escapeMd(field.label || '(unlabeled field)');
        const value = escapeMd(safeFieldValue(field));
        lines.push(`| ${label} | ${value} |`);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}
