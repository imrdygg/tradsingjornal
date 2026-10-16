/**
 * A minimal PNG encoder, for the diagnostic scripts.
 *
 * The repo holds no raster library and no chart image, and the checks that need a picture are
 * diagnostics whose entire value is that they run with nothing but an API key. So the ~35 lines that
 * turn coloured pixels into a real PNG live here once, rather than being copied into each script.
 *
 * Deliberately the dumbest correct encoder: 8-bit RGBA, no interlacing, no per-scanline filter. The
 * pictures are small, they are pictures, and the point is to hand a model something it will accept —
 * not to be a compression library.
 */

import { deflateSync } from 'node:zlib';

/** CRC-32, which every PNG chunk carries and nothing validates for us. */
export function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** An RGBA pixel buffer as PNG bytes. */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // no per-scanline filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The same bytes as an `image/png` data URL, which is the shape both the coach and the memory
 * endpoint accept as an inline picture.
 */
export function pngDataUrl(width: number, height: number, rgba: Buffer): string {
  return `data:image/png;base64,${encodePng(width, height, rgba).toString('base64')}`;
}
