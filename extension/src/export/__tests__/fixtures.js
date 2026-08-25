// Shared test fixtures — a small in-memory "export model" matching the
// shape data-loader.js produces, so renderer tests don't depend on
// IndexedDB/OPFS/OffscreenCanvas (none of which exist in Node).

export function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    title: 'Refund a customer order',
    createdAt: 1700000000000,
    status: 'complete',
    ...overrides,
  };
}

// A tiny fake "JPEG" payload — not a real decodable image, just enough
// bytes to exercise the embedding path (XObject stream / docx media part)
// structurally.
export function makeScreenshot(overrides = {}) {
  return {
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02, 0x03, 0xff, 0xd9]),
    mime: 'image/jpeg',
    width: 640,
    height: 480,
    ...overrides,
  };
}

export function makeModel(overrides = {}) {
  const base = {
    session: makeSession(),
    steps: [
      {
        step: { id: 'step-1', sessionId: 'session-1', order: 1, url: 'https://example.com/orders/42', timestamp: 1700000001000, screenshotRef: 'opfs:artifacts/step-1.bin' },
        fields: [
          { id: 'f1', stepId: 'step-1', label: 'Order ID', value: '42', tier: null, category: null, redacted: false, timestamp: 1700000001500 },
          { id: 'f2', stepId: 'step-1', label: 'Customer Email', value: '[Redacted email]', tier: 'B', category: 'email', redacted: true, timestamp: 1700000001600 },
        ],
        screenshot: makeScreenshot(),
      },
      {
        step: { id: 'step-2', sessionId: 'session-1', order: 2, url: 'https://example.com/orders/42/refund', timestamp: 1700000002000, screenshotRef: null },
        fields: [],
        screenshot: null,
      },
    ],
  };
  return { ...base, ...overrides };
}
