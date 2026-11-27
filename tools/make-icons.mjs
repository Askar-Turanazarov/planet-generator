// Draws the app icons (a small shaded planet with a ring) straight into PNG
// files: no image editor, no dependencies, no external assets. The pictures
// are committed; run this again only to change the artwork.
// Usage: node tools/make-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'icons');

// ---- a little vector maths -------------------------------------------------
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (x, lo = 0, hi = 1) => Math.min(Math.max(x, lo), hi);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
function valueNoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const at = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return mix(
    mix(mix(at(0, 0, 0), at(1, 0, 0), u), mix(at(0, 1, 0), at(1, 1, 0), u), v),
    mix(mix(at(0, 0, 1), at(1, 0, 1), u), mix(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  );
}
function fbm(x, y, z) {
  let sum = 0;
  let amplitude = 0.5;
  for (let i = 0; i < 5; i++) {
    sum += amplitude * valueNoise(x, y, z);
    x *= 2.03; y *= 2.03; z *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

// ---- the picture -------------------------------------------------------------
// Coordinates: the icon is the square [-1, 1]^2, y up. Everything stays inside
// a circle of radius 0.8, the "safe zone" of a maskable icon.
const PLANET = 0.52;
const RING_OUTER = 0.80;
const RING_INNER = 0.62;
const RING_FLAT = 0.24;                       // how far the ring plane is tipped
const TILT = (-20 * Math.PI) / 180;
const LIGHT = (() => {
  const v = [-0.55, 0.5, 0.67];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

/** Linear RGB of one sample point. */
function shade(x, y) {
  let color = [0, 0, 0];
  const r = Math.hypot(x, y);

  // Ring coordinates: rotate, then un-flatten the ellipse.
  const rx = x * Math.cos(TILT) + y * Math.sin(TILT);
  const ry = (-x * Math.sin(TILT) + y * Math.cos(TILT)) / RING_FLAT;
  const ringRadius = Math.hypot(rx, ry);
  let ring = smoothstep(RING_INNER - 0.012, RING_INNER + 0.012, ringRadius)
    * (1 - smoothstep(RING_OUTER - 0.012, RING_OUTER + 0.012, ringRadius));
  // A gap and a little banding, so it reads as a ring system.
  ring *= 1 - 0.75 * smoothstep(0.02, 0.0, Math.abs(ringRadius - 0.715));
  ring *= 0.72 + 0.28 * Math.sin(ringRadius * 90);
  const ringInFront = ry < 0;

  if (r < PLANET) {
    const nx = x / PLANET;
    const ny = y / PLANET;
    const nz = Math.sqrt(Math.max(1 - nx * nx - ny * ny, 0));
    const light = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
    const day = smoothstep(-0.12, 0.35, light);

    const land = smoothstep(0.5, 0.56, fbm(nx * 2.2 + 3.1, ny * 2.2 + 1.7, nz * 2.2));
    const cloud = smoothstep(0.52, 0.7, fbm(nx * 3.4 + 9.2, ny * 5.0, nz * 3.4 + 4.4));
    const ocean = [0.02, 0.13, 0.42];
    const ground = [0.16, 0.27, 0.1];
    let surface = ocean.map((c, i) => mix(c, ground[i], land));
    surface = surface.map((c) => mix(c, 0.92, cloud * 0.85));

    const diffuse = Math.max(light, 0) * 1.35 + 0.02;
    color = surface.map((c) => c * diffuse);
    // Atmosphere: a blue rim on the lit side.
    const rim = Math.pow(1 - nz, 2.6) * day;
    color = [color[0] + 0.1 * rim, color[1] + 0.32 * rim, color[2] + 0.9 * rim];
    // The ring's shadow falls across the globe where the ring is behind it.
    if (!ringInFront) ring = 0;
  } else {
    // A faint halo of scattered light just outside the limb.
    const halo = Math.exp(-(r - PLANET) / 0.035) * smoothstep(-0.3, 0.5, (x * LIGHT[0] + y * LIGHT[1]) / r);
    color = [0.05 * halo, 0.16 * halo, 0.42 * halo];
  }

  const ringColor = [0.82, 0.8, 0.74];
  const alpha = ring * 0.92;
  return color.map((c, i) => mix(c, ringColor[i], alpha));
}

const toSrgb = (c) => {
  c = clamp(c);
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

/** RGB bytes of a size x size icon, 4 x 4 samples per pixel. */
function render(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) / size) * 2 - 1;
          const y = 1 - ((py + (sy + 0.5) / samples) / size) * 2;
          const c = shade(x, y);
          sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
        }
      }
      const o = (py * size + px) * 3;
      for (let i = 0; i < 3; i++) pixels[o + i] = toSrgb(sum[i] / (samples * samples));
    }
  }
  return pixels;
}

// ---- PNG ---------------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function encodePng(size, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;      // bits per channel
  header[9] = 2;      // colour type: RGB
  const row = size * 3;
  const raw = Buffer.alloc((row + 1) * size);
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

await mkdir(OUT, { recursive: true });
for (const [name, size] of ICONS) {
  const png = encodePng(size, render(size));
  await writeFile(join(OUT, name), png);
  console.log(`icons/${name}  ${size} x ${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
