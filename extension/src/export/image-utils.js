/**
 * Browser-native image normalization for embedding screenshots into
 * PDF/DOCX exports. Whatever binary format offscreen.js eventually captures
 * screenshots in, this re-encodes it to JPEG via OffscreenCanvas so
 * pdf-renderer/docx-renderer only ever deal with one binary image format
 * (DCTDecode-compatible JPEG bytes).
 *
 * Browser-native only (createImageBitmap + OffscreenCanvas) — no network
 * call, no third-party dependency, per this ticket's guardrails.
 */

export async function blobToJpegBytes(blob, quality = 0.85) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buf = await jpegBlob.arrayBuffer();
    return { bytes: new Uint8Array(buf), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

// Uses Buffer when present (Node test environment — this module has no
// browser APIs available there); otherwise chunks through
// String.fromCharCode + btoa (the real extension execution context) to
// avoid blowing the call stack on large images.
export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
