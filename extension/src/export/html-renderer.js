import { safeFieldValue } from './redact.js';
import { bytesToBase64 } from './image-utils.js';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFieldRows(fields) {
  if (!fields.length) {
    return '<tr><td colspan="2"><em>No field interactions captured for this step.</em></td></tr>';
  }
  return fields
    .map(
      (field) =>
        `<tr><td>${escapeHtml(field.label || '(unlabeled field)')}</td><td>${escapeHtml(
          safeFieldValue(field)
        )}</td></tr>`
    )
    .join('\n');
}

function renderStep(stepModel, idx) {
  const { step, fields, screenshot } = stepModel;
  const metaParts = [];
  if (step.url) metaParts.push(escapeHtml(step.url));
  if (step.timestamp) metaParts.push(escapeHtml(new Date(step.timestamp).toLocaleString()));

  const img = screenshot
    ? `<img class="screenshot" src="data:${screenshot.mime};base64,${bytesToBase64(
        screenshot.bytes
      )}" alt="Step ${idx + 1} screenshot">`
    : '';

  return `
  <section class="step">
    <h2>Step ${idx + 1}</h2>
    ${metaParts.length ? `<p class="meta">${metaParts.join(' &middot; ')}</p>` : ''}
    ${img}
    <table class="fields">
      <thead><tr><th>Field</th><th>Value</th></tr></thead>
      <tbody>${renderFieldRows(fields)}</tbody>
    </table>
  </section>`;
}

/** Renders an export model (see data-loader.js) to a single self-contained HTML document. */
export function renderHtml(model) {
  const { session, steps } = model;
  const stepsHtml = steps.map(renderStep).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(session.title || 'FlowMap AI recording session')}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.2rem; border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
  .meta { color: #666; font-size: .85rem; }
  .step { margin-bottom: 2.5rem; }
  img.screenshot { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin: .75rem 0; display: block; }
  table.fields { border-collapse: collapse; width: 100%; }
  table.fields th, table.fields td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; font-size: .9rem; word-break: break-word; }
  table.fields th { background: #f5f5f5; }
</style>
</head>
<body>
  <h1>${escapeHtml(session.title || 'Untitled recording session')}</h1>
  <p class="meta">Session ${escapeHtml(session.id)}${
    session.createdAt ? ' &middot; recorded ' + escapeHtml(new Date(session.createdAt).toLocaleString()) : ''
  }</p>
  ${stepsHtml}
</body>
</html>`;
}
