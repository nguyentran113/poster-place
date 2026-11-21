// VELMORA — a travel poster for a place that does not exist.
//
// Velmora is the bay where the moon comes down to anchor: a great crescent
// moon rests on the horizon water, and a lighthouse stands on the dark
// island beneath it, throwing its beam up to meet the moon.
//
// The poster is drawn procedurally, one sample at a time, with signed
// distance shapes — no dependencies, no network, no assets. The output is
// a 1024x1024 palette PNG written to /output/entry.png (or
// $MAKEFUN_OUTPUT_DIR/entry.png), deterministic byte for byte.

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const SS = 2; // supersampling per axis

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (c1, c2, t) => [
  lerp(c1[0], c2[0], t),
  lerp(c1[1], c2[1], t),
  lerp(c1[2], c2[2], t),
];
const add = (c, k, t) => [
  c[0] + k[0] * t,
  c[1] + k[1] * t,
  c[2] + k[2] * t,
];
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >> 13), 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = clamp(t, 0, 1);
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return Math.sqrt(ex * ex + ey * ey);
}
function ellipseSDF(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  return (d - 1) * Math.min(rx, ry);
}
function boxSDF(px, py, cx, cy, hx, hy) {
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0);
}
function grad(stops, t) {
  // stops: [[pos, [r,g,b]], ...] sorted by pos
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const p0 = stops[i - 1][0];
      const p1 = stops[i][0];
      return mix(stops[i - 1][1], stops[i][1], (t - p0) / (p1 - p0));
    }
  }
  return stops[stops.length - 1][1];
}

// ---------------------------------------------------------------- palette
const SKY = [
  [0.0, [16, 22, 52]],
  [0.3, [38, 48, 98]],
  [0.52, [88, 70, 128]],
  [0.6, [168, 96, 116]],
  [0.633, [226, 148, 106]],
  [1.0, [240, 178, 112]],
];
const SEA = [
  [0.0, [96, 66, 84]],
  [0.06, [38, 74, 88]],
  [0.3, [18, 56, 72]],
  [1.0, [7, 26, 40]],
];
const CREAM = [246, 238, 210];
const GOLD = [203, 158, 82];
const MOON_HI = [253, 240, 205];
const MOON_LO = [233, 188, 116];
const ISLAND = [11, 27, 36];
const ISLAND_RIM = [43, 92, 98];
const CORAL = [206, 82, 66];
const DARK = [22, 29, 46];
const LAMP = [255, 196, 92];

const HORIZON = 648;
const MOON = { x: 706, y: 372, r: 178 };
const CUT = { x: 772, y: 312, r: 162 };
const LAMP_POS = { x: 415, y: 450 };

// ---------------------------------------------------------------- letters
// Stroke glyphs in a 64x84 box, drawn as polylines.
function ellipsePts(cx, cy, rx, ry, n, a0, a1) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
const GLYPHS = {
  V: [[[8, 6], [32, 78], [56, 6]]],
  E: [
    [[52, 6], [12, 6], [12, 78], [54, 78]],
    [[12, 42], [44, 42]],
  ],
  L: [[[14, 6], [14, 78], [52, 78]]],
  M: [[[8, 78], [8, 6], [32, 54], [56, 6], [56, 78]]],
  O: [ellipsePts(32, 42, 23, 35, 22, 0, Math.PI * 2)],
  R: [
    [[14, 78], [14, 6]],
    ellipsePts(31, 24, 18, 18, 12, -Math.PI / 2, Math.PI / 2),
    [[27, 42], [54, 78]],
  ],
  A: [
    [[6, 78], [32, 6], [58, 78]],
    [[17, 54], [47, 54]],
  ],
};
const WORD = "VELMORA";
const TSCALE = 1.18;
const TADV = 64 * TSCALE;
const TSPACE = 15;
const TWIDTH = WORD.length * TADV + (WORD.length - 1) * TSPACE;
const TX0 = (W - TWIDTH) / 2;
const TY0 = 84;
function textDist(x, y) {
  let best = 1e9;
  for (let i = 0; i < WORD.length; i++) {
    const glyph = GLYPHS[WORD[i]];
    const ox = TX0 + i * (TADV + TSPACE);
    for (const line of glyph) {
      for (let s = 0; s + 1 < line.length; s++) {
        const d = segDist(
          x,
          y,
          ox + line[s][0] * TSCALE,
          TY0 + line[s][1] * TSCALE,
          ox + line[s + 1][0] * TSCALE,
          TY0 + line[s + 1][1] * TSCALE
        );
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- island
function islandDist(x, y) {
  let d = ellipseSDF(x, y, 400, 694, 306, 66);
  d = Math.min(d, ellipseSDF(x, y, 622, 708, 182, 44));
  d = Math.min(d, ellipseSDF(x, y, 505, 720, 335, 30));
  return d;
}

// ---------------------------------------------------------------- scene
function scene(x, y) {
  let col;
  const inSky = y < HORIZON;
  if (inSky) {
    col = grad(SKY, y / HORIZON);
    // stars: hash cells, fading toward the horizon glow
    const cell = 26;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const h = hash2(cx, cy);
    if (h > 0.82 && y < 520) {
      const sx = (cx + 0.2 + 0.6 * hash2(cx + 9, cy)) * cell;
      const sy = (cy + 0.2 + 0.6 * hash2(cx, cy + 7)) * cell;
      const d = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy));
      const tw = 0.55 + 0.45 * hash2(cx + 31, cy + 17);
      const fade = 1 - smooth(300, 520, y);
      const b = smooth(3.2, 0.4, d) * tw * fade * (h - 0.8) * 4.2;
      if (b > 0) col = add(col, [255, 244, 214], clamp(b, 0, 0.85));
    }
    // two slow cloud wisps, lighter than the sky behind them
    const cl =
      Math.min(
        ellipseSDF(x, y, 238, 236, 148, 17),
        ellipseSDF(x, y, 300, 252, 120, 13)
      ) * 1.0;
    const cl2 = ellipseSDF(x, y, 838, 168, 108, 12);
    const cw = smooth(26, -14, Math.min(cl, cl2)) * 0.16;
    if (cw > 0) col = mix(col, [172, 158, 198], cw);
  } else {
    col = grad(SEA, (y - HORIZON) / (H - HORIZON));
    // gentle wave light
    const wv =
      Math.sin(y * 0.32 + Math.sin(x * 0.012) * 2.4) * 0.5 +
      Math.sin(y * 0.11 - x * 0.004) * 0.5;
    const wl = smooth(0.86, 1.0, wv) * 0.1 * (1 - (y - HORIZON) / 420);
    if (wl > 0) col = add(col, [120, 190, 195], wl);
    // reflections: moon path (strong) and lamp path (faint)
    const refl = (srcX, strength, wob) => {
      const px = srcX + Math.sin(y * 0.105) * wob + Math.sin(y * 0.029 + 1.7) * wob * 1.7;
      const dx = Math.abs(x - px);
      const rowH = 5;
      const row = Math.floor(y / rowH);
      const dash = hash2(row, 77) > 0.34 ? 1 : 0.25;
      const width = 26 + (y - HORIZON) * 0.16;
      const b =
        smooth(width, width * 0.25, dx) *
        dash *
        strength *
        (1 - (y - HORIZON) / (H - HORIZON)) ** 1.4;
      return b;
    };
    const mb = refl(MOON.x, 1.0, 7);
    if (mb > 0) col = add(col, [255, 203, 128], mb * 0.85);
    const lb = refl(LAMP_POS.x, 0.4, 4);
    if (lb > 0) col = add(col, [255, 190, 105], lb * 0.6);
  }

  // moon glow (both sides of the horizon)
  {
    const dOut = Math.sqrt((x - MOON.x) ** 2 + (y - MOON.y) ** 2) - MOON.r;
    const dCut = Math.sqrt((x - CUT.x) ** 2 + (y - CUT.y) ** 2) - CUT.r;
    const glow = Math.exp(-Math.max(0, Math.max(dOut, -dCut)) / 120) * 0.34;
    col = add(col, [255, 205, 130], glow);
    // crescent body
    if (dOut < 0 && dCut > 0) {
      const t = clamp((y - (MOON.y - MOON.r)) / (2 * MOON.r), 0, 1);
      col = mix(MOON_HI, MOON_LO, t * 0.85);
      // soft maria blotches on the lit face
      const m1 = ellipseSDF(x, y, 640, 420, 30, 20);
      const m2 = ellipseSDF(x, y, 600, 480, 24, 15);
      const m3 = ellipseSDF(x, y, 700, 505, 16, 11);
      const md = Math.min(m1, m2, m3);
      const mw = smooth(6, -10, md) * 0.13;
      if (mw > 0) col = mix(col, [196, 148, 92], mw);
      // bright rim on the outer edge
      const rim = smooth(-16, -2, dOut) * 0.25;
      col = add(col, [255, 250, 225], rim);
    }
  }

  // island: moonlit rim copy, then the dark body
  {
    const dRim = islandDist(x - 6, y + 5);
    if (dRim < 0) col = ISLAND_RIM.slice();
    const d = islandDist(x, y);
    if (d < 0) {
      col = ISLAND.slice();
      // faint top light
      const tl = smooth(0, -34, d) * 0.25;
      col = mix(col, [26, 54, 62], tl);
    }
  }

  // pine silhouettes on the island
  const pines = [
    [566, 672, 66],
    [614, 682, 52],
    [528, 686, 44],
    [700, 694, 48],
  ];
  for (const [px, base, ph] of pines) {
    const top = base - ph;
    if (y > top && y < base + 6 && x > px - ph * 0.38 && x < px + ph * 0.38) {
      const halfAt = ((y - top) / ph) * ph * 0.38 + 1.5;
      if (Math.abs(x - px) < halfAt) col = ISLAND.slice();
    }
  }

  // lighthouse
  {
    // light beam toward the moon, under the tower but over the sky
    const bx = LAMP_POS.x;
    const by = LAMP_POS.y;
    const dx = 905 - bx;
    const dy = 292 - by;
    const bl = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / bl;
    const uy = dy / bl;
    const rx = x - bx;
    const ry = y - by;
    const along = rx * ux + ry * uy;
    if (along > 0 && along < bl) {
      const perp = Math.abs(rx * -uy + ry * ux);
      const width = 7 + (along / bl) * 105;
      const beam =
        smooth(width, width * 0.15, perp) * (1 - along / bl) ** 1.7 * 0.42;
      if (beam > 0) col = add(col, [255, 214, 140], beam);
    }
    // tower: tapered, cream with two coral bands
    if (y >= 474 && y <= 640) {
      const halfW = lerp(31, 19.5, (640 - y) / (640 - 474));
      if (Math.abs(x - 415) < halfW) {
        const band = (y > 516 && y < 546) || (y > 588 && y < 618);
        col = band ? CORAL.slice() : [238, 229, 200];
        const shade = 0.9 + 0.1 * ((x - (415 - halfW)) / (2 * halfW));
        col = [col[0] * shade, col[1] * shade, col[2] * shade];
        // two small lit windows
        const w1 = (x - 415) ** 2 + (y - 566) ** 2;
        const w2 = (x - 415) ** 2 + (y - 500) ** 2;
        if (w1 < 20 || w2 < 13) col = LAMP.slice();
      }
    }
    // gallery + lamp room + cap
    if (boxSDF(x, y, 415, 472, 35, 6) < 0) col = DARK.slice();
    if (boxSDF(x, y, 415, 449, 16, 17) < 0) col = LAMP.slice();
    if (boxSDF(x, y, 415, 449, 19, 20) < 0 && boxSDF(x, y, 415, 449, 16, 17) >= 0)
      col = DARK.slice();
    {
      // cap: trapezoid from y 408 (half 7) to y 430 (half 27)
      if (y >= 408 && y <= 430) {
        const halfW = lerp(7, 27, (y - 408) / 22);
        if (Math.abs(x - 415) < halfW) col = DARK.slice();
      }
      if ((x - 415) ** 2 + (y - 402) ** 2 < 20) col = DARK.slice();
    }
    // lamp glow
    const dg = Math.sqrt((x - LAMP_POS.x) ** 2 + (y - LAMP_POS.y) ** 2);
    const gl = Math.exp(-(dg * dg) / (2 * 40 * 40)) * 0.75;
    if (gl > 0.01) col = add(col, [255, 200, 110], gl);
  }

  // a small boat with a lantern, right of the island
  {
    const hull =
      y > 782 && y < 802 &&
      Math.abs(x - 842) < 44 - Math.abs(y - 792) * 1.1;
    if (hull) col = [9, 20, 28];
    if (Math.abs(x - 842) < 2.2 && y > 732 && y < 784) col = [9, 20, 28];
    const sail =
      y > 738 && y < 782 && x > 844 && x < 844 + (782 - y) * 0.62;
    if (sail) col = [226, 214, 182];
    const dg = Math.sqrt((x - 824) ** 2 + (y - 774) ** 2);
    if (dg < 4.5) col = LAMP.slice();
    const gl = Math.exp(-(dg * dg) / (2 * 17 * 17)) * 0.55;
    if (gl > 0.01) col = add(col, [255, 196, 105], gl);
  }

  // birds: three small paired strokes in the left sky
  const birds = [
    [238, 316, 15],
    [292, 282, 11],
    [196, 366, 9],
  ];
  for (const [bx, by, s] of birds) {
    const d = Math.min(
      segDist(x, y, bx - s, by, bx - s * 0.15, by - s * 0.42),
      segDist(x, y, bx + s * 0.15, by - s * 0.42, bx + s, by)
    );
    const bw = smooth(2.6, 1.2, d) * 0.75;
    if (bw > 0) col = mix(col, [18, 24, 44], bw);
  }

  // the name, set into the picture: gold shadow, cream face
  if (y > 60 && y < 216) {
    const dShadow = textDist(x - 4, y - 5);
    const sw = smooth(8.4, 6.6, dShadow);
    if (sw > 0) col = mix(col, [150, 104, 44], sw);
    const d = textDist(x, y);
    const fw = smooth(8.4, 6.6, d);
    if (fw > 0) col = mix(col, CREAM, fw);
    // a fine gold rule under the name, with a diamond at its centre
    const ruleY = 208;
    if (Math.abs(y - ruleY) < 1.6 && x > TX0 + 6 && x < TX0 + TWIDTH - 6)
      col = mix(col, GOLD, 0.85);
    const dd =
      Math.abs(x - 512) / 11 + Math.abs(y - ruleY) / 7;
    if (dd < 1) col = GOLD.slice();
  }

  // vignette
  const vd = Math.sqrt((x - 512) ** 2 + (y - 545) ** 2);
  const vf = 1 - 0.16 * smooth(520, 780, vd);
  col = [col[0] * vf, col[1] * vf, col[2] * vf];

  // frame: cream outer band + gold hairline
  const fd = boxSDF(x, y, 512, 512, 486, 486); // <0 inside the hairline box
  if (Math.abs(fd) < 1.8) col = GOLD.slice();
  if (x < 27 || x > W - 27 || y < 27 || y > H - 27) {
    const t = y / H;
    col = mix([240, 231, 199], [228, 214, 172], t);
  }
  if (x < 27 || x > W - 27 || y < 27 || y > H - 27) {
    // thin dark keyline just inside the cream band
    const inset = Math.min(x, y, W - x, H - y);
    if (inset > 24.4 && inset < 27) col = [120, 100, 62];
  }
  return col;
}

// ---------------------------------------------------------------- render
const RW = W * SS;
const RH = H * SS;
const acc = new Float32Array(W * H * 3);
for (let sy = 0; sy < RH; sy++) {
  const yBase = (sy + 0.5) / SS;
  for (let sx = 0; sx < RW; sx++) {
    const c = scene((sx + 0.5) / SS, yBase);
    const ox = sx >> 1;
    const oy = sy >> 1;
    const idx = (oy * W + ox) * 3;
    acc[idx] += c[0];
    acc[idx + 1] += c[1];
    acc[idx + 2] += c[2];
  }
}
const rgb = new Uint8Array(W * H * 3);
const inv = 1 / (SS * SS);
for (let i = 0; i < W * H; i++) {
  // fine print grain
  const gx = i % W;
  const gy = (i / W) | 0;
  const g = (hash2(gx, gy) - 0.5) * 7;
  for (let ch = 0; ch < 3; ch++) {
    rgb[i * 3 + ch] = clamp(Math.round(acc[i * 3 + ch] * inv + g), 0, 255);
  }
}

// ------------------------------------------------------- palette (median cut)
function buildPalette(pixels, maxColors) {
  // pixels: Uint32Array of packed 0xRRGGBB
  let boxes = [pixels];
  const stats = (arr) => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    return [rMax - rMin, gMax - gMin, bMax - bMin];
  };
  while (boxes.length < maxColors) {
    // pick the box with the largest channel range (weighted by count)
    let bi = -1, bRange = -1, bCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      const st = stats(boxes[i]);
      const ch = st[0] >= st[1] && st[0] >= st[2] ? 0 : st[1] >= st[2] ? 1 : 2;
      const range = st[ch] * Math.sqrt(boxes[i].length);
      if (range > bRange) { bRange = range; bi = i; bCh = ch; }
    }
    if (bi < 0 || bRange <= 0) break;
    const box = boxes[bi];
    const shift = bCh === 0 ? 16 : bCh === 1 ? 8 : 0;
    const sorted = Array.from(box);
    sorted.sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
    const mid = sorted.length >> 1;
    boxes.splice(
      bi,
      1,
      new Uint32Array(sorted.slice(0, mid)),
      new Uint32Array(sorted.slice(mid))
    );
  }
  return boxes.map((arr) => {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < arr.length; i++) {
      r += (arr[i] >> 16) & 255;
      g += (arr[i] >> 8) & 255;
      b += arr[i] & 255;
    }
    const n = Math.max(1, arr.length);
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

const sample = [];
for (let i = 0; i < W * H; i += 2) {
  sample.push((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2]);
}
const palette = buildPalette(new Uint32Array(sample), 256);
while (palette.length < 256) palette.push([0, 0, 0]);

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const cache = new Int16Array(32768).fill(-1);
function nearest(r, g, b) {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  const hit = cache[key];
  if (hit >= 0) return hit;
  let best = 0, bd = 1e18;
  for (let i = 0; i < 256; i++) {
    const p = palette[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
    if (d < bd) { bd = d; best = i; }
  }
  cache[key] = best;
  return best;
}
const indices = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const off = (BAYER[y & 3][x & 3] - 7.5) * 2.1;
    indices[i] = nearest(
      clamp(rgb[i * 3] + off, 0, 255),
      clamp(rgb[i * 3 + 1] + off, 0, 255),
      clamp(rgb[i * 3 + 2] + off, 0, 255)
    );
  }
}

// ---------------------------------------------------------------- PNG out
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  // CRC32
  let crc = 0xffffffff;
  for (let i = 0; i < body.length; i++) {
    crc ^= body[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, body, crcBuf]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 3; // colour type: palette
const plte = Buffer.alloc(256 * 3);
for (let i = 0; i < 256; i++) {
  plte[i * 3] = palette[i][0];
  plte[i * 3 + 1] = palette[i][1];
  plte[i * 3 + 2] = palette[i][2];
}
const raw = Buffer.alloc(H * (W + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W + 1)] = 0;
  raw.set(indices.subarray(y * W, (y + 1) * W), y * (W + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("PLTE", plte),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + "/entry.png", png);
console.log("wrote " + outDir + "/entry.png (" + png.length + " bytes)");
