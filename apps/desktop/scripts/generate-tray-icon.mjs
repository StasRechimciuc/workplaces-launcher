// One-time generator for the tray's PLACEHOLDER icon (see
// WCs/WC__global-hotkeys.md — real artwork is a known, flagged
// follow-up, not something generated well by hand-rolled pixel math).
// Not part of the build pipeline: run manually (`node
// scripts/generate-tray-icon.mjs`) only if the placeholder bitmap below
// ever needs regenerating; the committed PNGs under resources/tray/
// are the actual build input.
//
// macOS menu-bar icons must be "template images" — monochrome
// black-with-alpha PNGs, filename ending in "Template" — so the OS can
// auto-invert them for light/dark menu bars. There is no Node image
// library in this repo's dependencies, so this hand-rolls a minimal
// PNG encoder (IHDR/IDAT/IEND chunks, zlib-deflated scanlines, a
// standard CRC32) rather than adding a new dependency for a one-time,
// throwaway placeholder asset.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../resources/tray');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** `pixels` is a size*size array of 0 (transparent) or 1 (opaque black)
 * — a simplified three-bar "stack" glyph, standing in for the app's
 * real "layers" mark (icons.tsx's `layers` path) until real artwork
 * exists. */
function buildStackGlyph(size) {
  const pixels = Array.from({ length: size }, () => new Array(size).fill(0));
  const barHeight = Math.max(1, Math.round(size * 0.14));
  const gap = Math.max(1, Math.round(size * 0.12));
  const inset = Math.max(1, Math.round(size * 0.12));
  const barCount = 3;
  const totalHeight = barCount * barHeight + (barCount - 1) * gap;
  const startY = Math.round((size - totalHeight) / 2);

  for (let bar = 0; bar < barCount; bar++) {
    // Each bar a little narrower than the last, mimicking a stack of
    // layers viewed in perspective — purely a placeholder silhouette.
    const shrink = bar * Math.max(1, Math.round(size * 0.08));
    const x0 = inset + shrink;
    const x1 = size - inset - shrink;
    const y0 = startY + bar * (barHeight + gap);
    const y1 = y0 + barHeight;
    for (let y = y0; y < y1 && y < size; y++) {
      for (let x = x0; x < x1 && x < size; x++) {
        pixels[y][x] = 1;
      }
    }
  }
  return pixels;
}

function encodePng(size) {
  const pixels = buildStackGlyph(size);
  const bytesPerPixel = 4; // RGBA
  const rowBytes = size * bytesPerPixel;
  const raw = Buffer.alloc((rowBytes + 1) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const opaque = pixels[y][x] === 1;
      const offset = rowStart + 1 + x * bytesPerPixel;
      // Template images are pure black with alpha — macOS derives the
      // actual on-screen tint (light/dark) from the alpha channel.
      raw[offset] = 0;
      raw[offset + 1] = 0;
      raw[offset + 2] = 0;
      raw[offset + 3] = opaque ? 255 : 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(outDir, 'trayIconTemplate.png'), encodePng(16));
writeFileSync(join(outDir, 'trayIconTemplate@2x.png'), encodePng(32));
console.log('Wrote trayIconTemplate.png (16x16) and trayIconTemplate@2x.png (32x32) to', outDir);
