/**
 * Builds the normalized "export model" a renderer needs, by reading the
 * existing sessions/steps/fields IndexedDB stores + OPFS artifacts
 * (extension/src/storage/db.js) — no new/denormalized data model, this is
 * purely an in-memory assembly of the existing normalized rows for one
 * session.
 *
 * All store/artifact/image-conversion dependencies are injectable via
 * `deps` (defaulting to the real db.js + image-utils.js) so this can be
 * unit-tested without IndexedDB/OPFS/OffscreenCanvas, none of which exist
 * outside a browser.
 */

import { stepStore, fieldStore, readBinaryArtifact } from '../storage/db.js';
import { blobToJpegBytes } from './image-utils.js';

// writeBinaryArtifact() (db.js) always writes refs shaped like
// `opfs:artifacts/<artifactId>.bin` — parse the id back out so we can call
// readBinaryArtifact(artifactId).
export function parseArtifactId(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const match = ref.match(/^opfs:artifacts\/(.+)\.bin$/);
  return match ? match[1] : null;
}

/**
 * @param {{id: string, title?: string, createdAt?: number, status?: string}} session
 * @param {object} [deps] injectable overrides for testing
 * @returns {Promise<{session: object, steps: Array<{step: object, fields: object[], screenshot: {bytes: Uint8Array, mime: string, width: number, height: number} | null}>}>}
 */
export async function loadExportModel(session, deps = {}) {
  if (!session || !session.id) {
    throw new Error('loadExportModel requires a session with an id');
  }

  const {
    stepStore: steps_ = stepStore,
    fieldStore: fields_ = fieldStore,
    readBinaryArtifact: readArtifact = readBinaryArtifact,
    blobToJpegBytes: toJpeg = blobToJpegBytes,
  } = deps;

  const rawSteps = [...(await steps_.bySession(session.id))].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const steps = [];
  for (const step of rawSteps) {
    const rawFields = [...(await fields_.byStep(step.id))].sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
    );

    let screenshot = null;
    const artifactId = parseArtifactId(step.screenshotRef);
    if (artifactId) {
      try {
        const file = await readArtifact(artifactId);
        const { bytes, width, height } = await toJpeg(file);
        screenshot = { bytes, mime: 'image/jpeg', width, height };
      } catch {
        // Missing/unreadable artifact (e.g. not yet captured, or quota-
        // evicted) must degrade to a text-only step, not fail the export.
        screenshot = null;
      }
    }

    steps.push({ step, fields: rawFields, screenshot });
  }

  return { session, steps };
}
