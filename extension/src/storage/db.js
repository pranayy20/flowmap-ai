/**
 * Local storage layer — IndexedDB (structured metadata) + OPFS (binary
 * screenshot/video blobs), per the accepted Data Architecture Spec.
 *
 * Schema is deliberately NORMALIZED and enumerable (not opaque blobs) per
 * RAID R1's resolution — this is what keeps the Phase 2 knowledge-graph
 * migration additive instead of a re-platform. Do not collapse a recording
 * session into a single JSON blob column; keep sessions/steps/fields as
 * separate, queryable object stores.
 */

const DB_NAME = 'flowmap-ai';
const DB_VERSION = 1;

const STORES = {
  sessions: 'sessions', // { id, title, createdAt, status, url }
  steps: 'steps', // { id, sessionId, order, url, timestamp, screenshotRef }
  fields: 'fields', // { id, stepId, label, value, tier, category, redacted, timestamp }
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        db.createObjectStore(STORES.sessions, { keyPath: 'id' }).createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(STORES.steps)) {
        const steps = db.createObjectStore(STORES.steps, { keyPath: 'id' });
        steps.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains(STORES.fields)) {
        const fields = db.createObjectStore(STORES.fields, { keyPath: 'id' });
        fields.createIndex('stepId', 'stepId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllBySessionId(storeName, indexName, sessionId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const idx = tx.objectStore(storeName).index(indexName);
    const req = idx.getAll(sessionId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const sessionStore = {
  create: (session) => put(STORES.sessions, session),
  update: (session) => put(STORES.sessions, session),
};

export const stepStore = {
  create: (step) => put(STORES.steps, step),
  bySession: (sessionId) => getAllBySessionId(STORES.steps, 'sessionId', sessionId),
};

export const fieldStore = {
  create: (field) => put(STORES.fields, field),
  byStep: (stepId) => getAllBySessionId(STORES.fields, 'stepId', stepId),
};

// --- OPFS binary storage (screenshots, recording chunks) ---

async function getOpfsRoot() {
  return navigator.storage.getDirectory();
}

export async function writeBinaryArtifact(artifactId, blob) {
  const root = await getOpfsRoot();
  const dir = await root.getDirectoryHandle('artifacts', { create: true });
  const fileHandle = await dir.getFileHandle(`${artifactId}.bin`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `opfs:artifacts/${artifactId}.bin`;
}

export async function readBinaryArtifact(artifactId) {
  const root = await getOpfsRoot();
  const dir = await root.getDirectoryHandle('artifacts', { create: false });
  const fileHandle = await dir.getFileHandle(`${artifactId}.bin`);
  return fileHandle.getFile();
}

// --- Graceful degradation (4-state machine, per Data Architecture Spec) ---

export const QuotaState = Object.freeze({
  NORMAL: 'NORMAL', // < 70%
  WARNING: 'WARNING', // 70-90%
  CRITICAL: 'CRITICAL', // 90-95%
  BLOCKED: 'BLOCKED', // >= 95%
});

export async function getQuotaState() {
  if (!navigator.storage?.estimate) return QuotaState.NORMAL; // no API support, don't block
  const { usage, quota } = await navigator.storage.estimate();
  if (!quota) return QuotaState.NORMAL;
  const pct = usage / quota;
  if (pct >= 0.95) return QuotaState.BLOCKED;
  if (pct >= 0.9) return QuotaState.CRITICAL;
  if (pct >= 0.7) return QuotaState.WARNING;
  return QuotaState.NORMAL;
}

/**
 * Never silently deletes user data. BLOCKED state must surface an
 * export-only release valve in the UI, not an automatic prune — enforced by
 * callers checking this before starting a new recording, not by this module
 * deleting anything on its own.
 */
export async function canStartNewRecording() {
  const state = await getQuotaState();
  return state !== QuotaState.BLOCKED;
}
