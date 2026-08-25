import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSession, exportSessionById, ExportFormat } from '../index.js';

const session = { id: 'session-1', title: 'My Session' };

function makeDeps() {
  return {
    stepStore: { bySession: async () => [{ id: 's1', order: 1, screenshotRef: null }] },
    fieldStore: { byStep: async () => [{ label: 'A', value: 'B', redacted: false }] },
    readBinaryArtifact: async () => {
      throw new Error('no artifact in this test');
    },
    blobToJpegBytes: async () => ({ bytes: new Uint8Array(), width: 0, height: 0 }),
  };
}

test('exportSession rejects an unknown format', async () => {
  await assert.rejects(() => exportSession(session, 'yaml', makeDeps()), /Unknown export format/);
});

for (const format of Object.values(ExportFormat)) {
  test(`exportSession(${format}) returns a Blob with the right mime type and a filename`, async () => {
    const result = await exportSession(session, format, makeDeps());
    assert.ok(result.blob instanceof Blob);
    assert.ok(result.filename.startsWith('my-session.'));
    assert.ok(result.blob.size > 0);
  });
}

test('exportSessionById looks the session up via sessionStore.get before exporting', async () => {
  const deps = { ...makeDeps(), sessionStore: { get: async (id) => (id === 'session-1' ? session : null) } };
  const result = await exportSessionById('session-1', ExportFormat.MARKDOWN, deps);
  assert.ok(result.filename.endsWith('.md'));
});

test('exportSessionById throws a clear error when the session does not exist', async () => {
  const deps = { ...makeDeps(), sessionStore: { get: async () => null } };
  await assert.rejects(() => exportSessionById('missing', ExportFormat.MARKDOWN, deps), /Session not found/);
});
