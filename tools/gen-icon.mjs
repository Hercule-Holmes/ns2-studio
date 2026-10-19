#!/usr/bin/env node
/**
 * Generate apps/desktop/resources/icon.ico (S11) without any image deps:
 * draw 256x256 RGBA pixels (rounded dark tile + D-pad + ABXY dots),
 * encode a PNG (zlib + CRC32), wrap it in a PNG-in-ICO container.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const S = 256;
const px = new Uint8Array(S * S * 4);

function set(x, y, r, g, b, a = 255) {
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const na = a / 255;
  px[i] = Math.round(px[i] * (1 - na) + r * na);
  px[i + 1] = Math.round(px[i + 1] * (1 - na) + g * na);
  px[i + 2] = Math.round(px[i + 2] * (1 - na) + b * na);
  px[i + 3] = Math.min(255, px[i + 3] + a);
}

const inRound = (x, y, x0, y0, x1, y1, rad) => {
  if (x < x0 || y < y0 || x > x1 || y > y1) return false;
  const cx = Math.max(x0 + rad, Math.min(x, x1 - rad));
  const cy = Math.max(y0 + rad, Math.min(y, y1 - rad));
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
};

// Background: dark rounded tile with a 1px lighter rim.
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (inRound(x, y, 12, 12, S - 13, S - 13, 52)) {
      set(x, y, 0x16, 0x1a, 0x21);
    }
    if (inRound(x, y, 12, 12, S - 13, S - 13, 52) &&
        !inRound(x, y, 16, 16, S - 17, S - 17, 49)) {
      set(x, y, 0x4c, 0x8d, 0xff); // accent rim
    }
  }
}

function fillRound(cx, cy, rx, ry, rot, r, g, b) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const x0 = Math.floor(cx - Math.max(rx, ry) - 2);
  const x1 = Math.ceil(cx + Math.max(rx, ry) + 2);
  const y0 = Math.floor(cy - Math.max(rx, ry) - 2);
  const y1 = Math.ceil(cy + Math.max(rx, ry) + 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if ((u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1) {
        blend(x, y, r, g, b, 255);
      }
    }
  }
}

// D-pad cross (left half)
const dpX = 86, dpY = 128, arm = 34, len = 52;
fillRound(dpX, dpY - 26, arm, len, 0, 0xe8, 0xeb, 0xf0);
fillRound(dpX, dpY + 26, arm, len, 0, 0xe8, 0xeb, 0xf0);
fillRound(dpX - 26, dpY, len, arm, 0, 0xe8, 0xeb, 0xf0);
fillRound(dpX + 26, dpY, len, arm, 0, 0xe8, 0xeb, 0xf0);

// ABXY dots (right half), Switch layout: X top, B bottom, Y left, A right
const ab = 176, aby = 128, off = 34, rad = 17;
fillRound(ab, aby - off, rad, rad, 0, 0x4c, 0x8d, 0xff); // X blue
fillRound(ab, aby + off, rad, rad, 0, 0x3f, 0xb9, 0x6f); // B green
fillRound(ab - off, aby, rad, rad, 0, 0xd9, 0xa1, 0x3c); // Y yellow
fillRound(ab + off, aby, rad, rad, 0, 0xe0, 0x56, 0x4f); // A red

// ---------- PNG encode ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

// ---------- ICO container (PNG-in-ICO) ----------
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; // 256 => 0
entry[4] = 1; entry[5] = 0; // planes
entry[6] = 32; entry[7] = 0; // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // data offset
const ico = Buffer.concat([header, entry, png]);

const out = join(dirname(fileURLToPath(import.meta.url)), "../apps/desktop/resources/icon.ico");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, ico);
console.log(`written: ${out} (${ico.length} bytes)`);
