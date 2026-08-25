import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExportModel, parseArtifactId } from '../data-loader.js';

function makeDeps({ steps, fieldsByStep, artifacts = {} } = {}) {
  return {
    stepStore: { bySession: async () => steps },
    fieldStore: { byStep: async (stepId) => fieldsByStep[stepId] || [] },
    readBinaryArtifact: async (artifactId) => {
      if (!(artifactId in artifacts)) throw new Error('not found');
      return artifacts[artifactId];
    },
    blobToJpegBytes: async (file) => ({ bytes: file.bytes, width: file.width, height: file.height }),
  };
}

test('parseArtifactId extracts the id from an opfs ref written by writeBinaryArtifact', () => {
  assert.equal(parseArtifactId('opfs:artifacts/abc-123.bin'), 'abc-123');
  assert.equal(parseArtifactId(null), null);
  assert.equal(parseArtifactId('not-a-ref'), null);
});

test('loadExportModel orders steps by `order` and fields by `timestamp`', async () => {
  const deps = makeDeps({
    steps: [
      { id: 's2', order: 2, screenshotRef: null },
      { id: 's1', order: 1, screenshotRef: null },
    ],
    fieldsByStep: {
      s1: [
        { id: 'f2', timestamp: 20 },
        { id: 'f1', timestamp: 10 },
      ],
      s2: [],
    },
  });

  const model = await loadExportModel({ id: 'session-1' }, deps);
  assert.deepEqual(model.steps.map((s) => s.step.id), ['s1', 's2']);
  assert.deepEqual(model.steps[0].fields.map((f) => f.id), ['f1', 'f2']);
});

test('loadExportModel resolves a screenshot via readBinaryArtifact + blobToJpegBytes when screenshotRef is set', async () => {
  const deps = makeDeps({
    steps: [{ id: 's1', order: 1, screenshotRef: 'opfs:artifacts/s1-shot.bin' }],
    fieldsByStep: { s1: [] },
    artifacts: { 's1-shot': { bytes: new Uint8Array([1, 2, 3]), width: 10, height: 20 } },
  });

  const model = await loadExportModel({ id: 'session-1' }, deps);
  assert.deepEqual(model.steps[0].screenshot.bytes, new Uint8Array([1, 2, 3]));
  assert.equal(model.steps[0].screenshot.mime, 'image/jpeg');
  assert.equal(model.steps[0].screenshot.width, 10);
});

test('loadExportModel degrades to screenshot: null (not a thrown error) when the artifact is missing/unreadable', async () => {
  const deps = makeDeps({
    steps: [{ id: 's1', order: 1, screenshotRef: 'opfs:artifacts/missing.bin' }],
    fieldsByStep: { s1: [] },
    artifacts: {},
  });

  const model = await loadExportModel({ id: 'session-1' }, deps);
  assert.equal(model.steps[0].screenshot, null);
});

test('loadExportModel leaves screenshot null when screenshotRef is null (not yet captured)', async () => {
  const deps = makeDeps({ steps: [{ id: 's1', order: 1, screenshotRef: null }], fieldsByStep: { s1: [] } });
  const model = await loadExportModel({ id: 'session-1' }, deps);
  assert.equal(model.steps[0].screenshot, null);
});

test('loadExportModel throws on a session with no id', async () => {
  await assert.rejects(() => loadExportModel({}, makeDeps({ steps: [], fieldsByStep: {} })));
});
