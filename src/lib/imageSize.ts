/**
 * Pixel dimensions from the first bytes of an image, without decoding it.
 *
 * The cephalometric analysis needs the aspect ratio: landmarks come back on a 0–1000 grid per
 * axis, and on a non-square film that grid is stretched, so every angle would be wrong without
 * the width and height to undo it. The server already has the bytes in hand for the model call;
 * reading two integers out of the header is cheaper than any image library.
 *
 * JPEG, PNG and WebP (VP8, VP8L, VP8X) are covered — every export a clinic's ceph software or
 * phone produces. Anything else returns null and the caller falls back to a square, saying so.
 */
export function imageDimensions(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;

  // PNG: 8-byte signature, then the IHDR chunk with width and height as big-endian u32.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = readU32BE(buf, 16);
    const h = readU32BE(buf, 20);
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  }

  // JPEG: walk the segments to the first SOFn frame header.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      // Padding bytes and standalone markers carry no length.
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const h = (buf[i + 5] << 8) | buf[i + 6];
        const w = (buf[i + 7] << 8) | buf[i + 8];
        return w > 0 && h > 0 ? { width: w, height: h } : null;
      }
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }

  // WebP: "RIFF" .... "WEBP" then a VP8 / VP8L / VP8X chunk.
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") {
    const chunk = ascii(buf, 12, 16);
    if (chunk === "VP8 " && buf.length >= 30) {
      const w = (buf[26] | (buf[27] << 8)) & 0x3fff;
      const h = (buf[28] | (buf[29] << 8)) & 0x3fff;
      return w > 0 && h > 0 ? { width: w, height: h } : null;
    }
    if (chunk === "VP8L" && buf.length >= 25) {
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const w = 1 + (((b1 & 0x3f) << 8) | b0);
      const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width: w, height: h };
    }
    if (chunk === "VP8X" && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
  }

  return null;
}

function readU32BE(b: Uint8Array, i: number): number {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}

function ascii(b: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}
