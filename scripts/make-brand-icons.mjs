/**
 * Generates all brand icons from the source Runora PNGs (pure Node, zlib only).
 *  - public/favicon.png          <- runora-icon-light @128
 *  - public/splash-icon.png      <- runora-icon @256 (alpha)
 *  - public/splash-text.png      <- runora-text @480w (alpha)
 *  - build/icon.ico              <- runora-app (16..256 PNG entries)
 *  - android mipmaps             <- runora-app (launcher/round/foreground)
 * Usage: node make-brand-icons.mjs <repoRoot>
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ── CRC32 ──
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function decodePNG(buf) {
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6))
    throw new Error(`unsupported PNG: bd=${bitDepth} ct=${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const srcBpp = colorType === 6 ? 4 : 3;
  const stride = width * srcBpp;
  const out = Buffer.alloc(width * height * 4); // always RGBA
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= srcBpp ? cur[x - srcBpp] : 0, b = prev[x], c = x >= srcBpp ? prev[x - srcBpp] : 0;
      let v = row[x];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev.set(cur);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * srcBpp;
      out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2];
      out[o + 3] = srcBpp === 4 ? cur[s + 3] : 255;
    }
  }
  return { width, height, rgba: out };
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function resize(img, tw, th = Math.round((img.height * tw) / img.width)) {
  const { width: sw, height: sh, rgba } = img;
  th = th || Math.max(1, Math.round((sh * tw) / sw));
  const out = Buffer.alloc(th * tw * 4);
  for (let ty = 0; ty < th; ty++) {
    const y0 = (ty * sh) / th, y1 = ((ty + 1) * sh) / th;
    for (let tx = 0; tx < tw; tx++) {
      const x0 = (tx * sw) / tw, x1 = ((tx + 1) * sw) / tw;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = Math.floor(y0); y < Math.min(sh, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.min(sw, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          const w = wx * wy, i = (y * sw + x) * 4;
          r += rgba[i] * w; g += rgba[i + 1] * w; b += rgba[i + 2] * w; a += rgba[i + 3] * w;
          n += w;
        }
      }
      if (!n) continue;
      const o = (ty * tw + tx) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: tw, height: th, rgba: out };
}

/** Composite src (resized to cover Sq) onto RGB bgSq, fully opaque result. */
function overBg(img, sq, bg) {
  const px = resize(img, sq, sq).rgba;
  const out = Buffer.alloc(sq * sq * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = px[i + 3] / 255;
    out[i] = px[i] * a + bg[0] * (1 - a);
    out[i + 1] = px[i + 1] * a + bg[1] * (1 - a);
    out[i + 2] = px[i + 2] * a + bg[2] * (1 - a);
    out[i + 3] = 255;
  }
  return { width: sq, height: sq, rgba: out };
}

/** Scale src content to `scale` fraction of canvas, centered, on transparent. */
function padded(img, sq, scale) {
  const inner = Math.round(sq * scale);
  const src = resize(img, inner, inner);
  const out = Buffer.alloc(sq * sq * 4);
  const ox = Math.floor((sq - inner) / 2), oy = ox;
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const o = ((y + oy) * sq + (x + ox)) * 4, s = (y * inner + x) * 4;
      const a = src.rgba[s + 3] / 255;
      if (a === 0) continue;
      out[o] = src.rgba[s] * a + out[o] * (1 - a);
      out[o + 1] = src.rgba[s + 1] * a + out[o + 1] * (1 - a);
      out[o + 2] = src.rgba[s + 2] * a + out[o + 2] * (1 - a);
      out[o + 3] = Math.round(255 * (a + out[o + 3] / 255 * (1 - a)));
    }
  }
  return { width: sq, height: sq, rgba: out };
}

/** Circular alpha mask (full-bleed round icon). */
function roundMask(img) {
  const sq = img.width, out = Buffer.from(img.rgba);
  const c = sq / 2, r = sq / 2;
  for (let y = 0; y < sq; y++) for (let x = 0; x < sq; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    if (d >= r) out[(y * sq + x) * 4 + 3] = 0;
  }
  return { width: sq, height: sq, rgba: out };
}

/** 32bpp BGRA + AND mask DIB entry (bottom-up). The legacy small-icon path reads BMP entries with alpha. */
function bmpDIB(size, rgba) {
  const { rgba: px } = resize(rgba, size, size);
  const w = size, h = size;
  const bih = Buffer.alloc(40);
  bih.writeInt32LE(40, 0);          // BITMAPINFOHEADER size
  bih.writeInt32LE(w, 4);
  bih.writeInt32LE(h * 2, 8);      // XOR + AND heights
  bih.writeUInt16LE(1, 12);        // planes
  bih.writeUInt16LE(32, 14);       // bits per pixel
  bih.writeUInt32LE(0, 16);        // BI_RGB
  bih.writeUInt32LE(w * h * 4, 20);
  const xor = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = ((h - 1 - y) * w + x) * 4; // bottom-up
      xor[d] = px[s + 2]; xor[d + 1] = px[s + 1]; xor[d + 2] = px[s]; xor[d + 3] = px[s + 3];
    }
  }
  const maskRow = (Math.ceil(w / 8) + 3) & ~3; // row of 1bpp mask padded to 4 bytes
  const mask = Buffer.alloc(maskRow * h);   // all opaque (alpha decides)
  return Buffer.concat([bih, xor, mask]);
}

function writeICO(file, img, sizes) {
  const pngSizes = sizes.filter((s) => s > 48);  // alpha honored by the modern path
  const bmpSizes = sizes.filter((s) => s <= 48); // legacy path needs BMP entries
  const entries = [
    ...bmpSizes.map((s) => ({ s, data: bmpDIB(s, img), isPng: false })),
    ...pngSizes.map((s) => ({ s, data: encodePNG(s, s, resize(img, s, s).rgba), isPng: true })),
  ];
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const d = dir.subarray(i * 16, i * 16 + 16);
    d[0] = e.s === 256 ? 0 : e.s; d[1] = e.s === 256 ? 0 : e.s;
    d.writeUInt16LE(1, 4);            // type: icon
    d.writeUInt16LE(e.isPng ? 32 : 32, 6); // bpp (ignored for PNG entries)
    d.writeUInt32LE(e.data.length, 8); d.writeUInt32LE(offset, 12);
    offset += e.data.length;
  });
  fs.writeFileSync(file, Buffer.concat([head, dir, ...entries.map((e) => e.data)]));
}

const root = process.argv[2] || process.cwd();
const dl = process.argv[3] || path.join(require('os').homedir(), 'Downloads');
const app = decodePNG(fs.readFileSync(path.join(dl, 'runora-app.png')));
const icon = decodePNG(fs.readFileSync(path.join(root, 'src/assets/runora-icon.png')));
const iconLight = decodePNG(fs.readFileSync(path.join(root, 'src/assets/runora-icon-light.png')));
const text = decodePNG(fs.readFileSync(path.join(root, 'src/assets/runora-text.png')));

// sample background color from a corner pixel of runora-app
const bgSample = [app.rgba[4 * (10 * app.width + 10)], app.rgba[4 * (10 * app.width + 10) + 1], app.rgba[4 * (10 * app.width + 10) + 2]];
const bgHex = '#' + bgSample.map((v) => v.toString(16).padStart(2, '0')).join('');
console.log('runora-app corner bg:', bgHex);

// public web assets
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/favicon.png'), encodePNG(128, 128, resize(iconLight, 128, 128).rgba));
fs.writeFileSync(path.join(root, 'public/splash-icon.png'), encodePNG(256, 256, resize(icon, 256, 256).rgba));
fs.writeFileSync(path.join(root, 'public/splash-text.png'), encodePNG(resize(text, 480).width, resize(text, 480).height, resize(text, 480).rgba));

// electron exe icon — circular, matching the Android launcher style
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
writeICO(path.join(root, 'build/icon.ico'), roundMask(overBg(app, 256, bgSample)), [16, 24, 32, 48, 64, 128, 256]);

// android mipmaps
const res = path.join(root, 'android/app/src/main/res');
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = path.join(res, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  const sq = Math.round(48 * k);
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), encodePNG(sq, sq, overBg(app, sq, bgSample).rgba));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), encodePNG(sq, sq, roundMask(overBg(app, sq, bgSample)).rgba));
  // adaptive foreground: content scaled into the safe zone on transparent
  const fg = Math.round(108 * k);
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), encodePNG(fg, fg, padded(app, fg, 0.64).rgba));
}
console.log('wrote favicon.png, splash-icon.png, splash-text.png, build/icon.ico + android mipmaps');

