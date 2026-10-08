'use strict';
// Draws the Baton icon (two interlocked rings on a deep ink tile) as PNG and ICO files, no dependencies.
// Writes build/icon.png (512), build/tray.png (64) and build/icon.ico (16-256, PNG-compressed entries).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const INK_TOP = [0x1f, 0x1e, 0x1d], INK_BOTTOM = [0x2b, 0x29, 0x26];
const CLAY = [0xd9, 0x77, 0x57], CREAM = [0xf6, 0xf1, 0xe7];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function render(size) {
  const SS = size <= 64 ? 8 : 4; // supersampling: small sizes get more samples, they are the ones that show jaggies
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const R = size * 0.215, W = size * 0.078, d = size * 0.12; // ring radius, stroke, half the distance between centres
  const gap = size * 0.014; // dark seam where one ring passes over the other
  const edge = Math.max(1, size / 512 * 1.5); // the faint highlight along the top edge of the tile

  const tileDist = (x, y) => { // signed distance to the rounded tile (negative inside)
    const r = size * 0.22, qx = Math.abs(x - cx) - (cx - r), qy = Math.abs(y - cy) - (cy - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const ringDist = (x, y, ox) => Math.abs(Math.hypot(x - ox, y - cy) - R); // distance to a ring's centre line
  const left = cx - d, right = cx + d;

  function shade(x, y) {
    let col = mix(INK_TOP, INK_BOTTOM, y / size);
    const sd = tileDist(x, y);
    if (sd > -edge) col = mix(col, [255, 255, 255], 0.14 * Math.max(0, 1 - y / (size * 0.3)));
    const dClay = ringDist(x, y, left), dCream = ringDist(x, y, right);
    const inClay = dClay <= W / 2, inCream = dCream <= W / 2;
    if (!inClay && !inCream) return col;
    if (inClay && inCream) return y < cy ? CLAY : CREAM; // clay passes over at the top crossing, cream over at the bottom
    // a ring that goes under gets a dark seam next to the ring above it, so the link reads as real
    if (inCream && y < cy && dClay <= W / 2 + gap) return mix(CREAM, INK_TOP, 0.7);
    if (inClay && y >= cy && dCream <= W / 2 + gap) return mix(CLAY, INK_TOP, 0.7);
    return inClay ? CLAY : CREAM;
  }

  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let a = 0, rr = 0, gg = 0, bb = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const x = i + (si + 0.5) / SS, y = j + (sj + 0.5) / SS;
      if (tileDist(x, y) > 0) continue;
      const col = shade(x, y);
      a += 1; rr += col[0]; gg += col[1]; bb += col[2];
    }
    const o = (j * size + i) * 4;
    if (a) { px[o] = Math.round(rr / a); px[o + 1] = Math.round(gg / a); px[o + 2] = Math.round(bb / a); px[o + 3] = Math.round((a / (SS * SS)) * 255); }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let j = 0; j < size; j++) { raw[j * (size * 4 + 1)] = 0; px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ICO container: ICONDIR, one ICONDIRENTRY per image, then the PNG files themselves (supported since Windows Vista).
function makeIco(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, k) => {
    const e = 6 + 16 * k;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size; // 0 means 256
    head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.png)]);
}

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
const cache = new Map();
const png = (size) => { if (!cache.has(size)) cache.set(size, render(size)); return cache.get(size); };

fs.writeFileSync(path.join(out, 'icon.png'), png(512));
fs.writeFileSync(path.join(out, 'tray.png'), png(64));
fs.writeFileSync(path.join(out, 'icon.ico'), makeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))));
console.log('wrote build/icon.png, build/tray.png and build/icon.ico');
