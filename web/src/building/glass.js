// Procedural stained glass in the manner of Joan Vila-Grau's windows for the
// basilica: fields of small irregular pieces held in lead, colour graded from
// dense and dark at the bottom to lighter and more transparent at the top,
// with blue–green on the Nativity side (morning) and red–orange on the Passion
// side (evening). These are original compositions, not copies of his windows.
//
// Output: two atlases (tall lancets and round oculi). The same texture is used
// to draw the glass and as its transmittance when projecting sunlight.

import * as THREE from 'three';

// Colour ramps, darkest/densest first. A window's colour at a point is read
// from its ramp by height (lower = denser) plus a slow noise field, so each
// light has broad coherent zones of hue the way Vila-Grau's do, rather than
// confetti — which also keeps the light it casts saturated.
const RAMPS = {
  passion: [[110, 8, 16], [170, 18, 20], [205, 45, 18], [228, 90, 20], [240, 140, 30], [248, 190, 60], [250, 225, 140], [252, 244, 220]],
  nativity: [[10, 24, 110], [18, 52, 160], [22, 96, 190], [16, 130, 150], [40, 150, 90], [110, 190, 120], [170, 220, 215], [232, 246, 244]],
  glory: [[60, 20, 110], [40, 60, 170], [30, 120, 150], [70, 160, 80], [200, 170, 40], [240, 200, 90], [245, 230, 180], [250, 248, 235]],
  apse: [[160, 70, 10], [200, 110, 15], [225, 150, 25], [240, 185, 45], [248, 210, 90], [252, 228, 150], [254, 242, 200], [255, 252, 238]],
  clear: [[200, 206, 200], [214, 216, 206], [224, 226, 218], [232, 234, 228], [238, 240, 236], [244, 245, 240], [248, 248, 244], [252, 252, 250]],
};
export const FACADES = Object.keys(RAMPS);
export const BANDS = 3; // low, middle, high on the wall

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rampAt(ramp, v) {
  const f = Math.min(ramp.length - 1.001, Math.max(0, v * (ramp.length - 1)));
  const i = Math.floor(f);
  const t = f - i;
  return ramp[i].map((c, k) => c + (ramp[i + 1][k] - c) * t);
}

// Smooth value noise for the colour field.
function valueNoise(seed) {
  const rand = mulberry(seed);
  const N = 64;
  const grid = Array.from({ length: N * N }, rand);
  const at = (i, j) => grid[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const u = x - i;
    const v = y - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
  };
}

// Paint one tile: pieces of cut glass on a jittered grid of varying size,
// each filled from the colour field at its centre, held in thin lead.
function paintTile(data, stride, x0, y0, w, h, { ramp, band, seed, cell }) {
  const rand = mulberry(seed);
  const noise = valueNoise(seed * 3 + 1);
  const cols = Math.ceil(w / cell) + 2;
  const rows = Math.ceil(h / (cell * 1.5)) + 2;
  const sites = [];
  const bandLift = band / (BANDS - 1);
  const zoneScale = 3.2 / w; // a few colour zones across a light
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const px = (i - 1 + 0.1 + rand() * 0.8) * cell;
      const py = (j - 1 + 0.1 + rand() * 0.8) * cell * 1.5;
      const up = Math.min(1, Math.max(0, 1 - py / h)); // 0 at the bottom
      const field = noise(px * zoneScale, py * zoneScale * 0.6) * 0.75 + noise(px * zoneScale * 3, py * zoneScale * 2) * 0.25;
      let v = 0.08 + up * 0.42 + bandLift * 0.38 + (field - 0.5) * 0.55;
      // light, almost clear pieces rise through the upper part of every window,
      // more of them in the higher bands — the glass "opens" towards the top
      if (rand() < (0.04 + 0.22 * bandLift) * up * up) v = 0.86 + rand() * 0.12;
      // occasional accent pieces from the light end of the ramp (pale blue in a
      // red window, warm gold in a blue one, as in the real glass)
      else if (rand() < 0.035) v = Math.min(1, v + 0.45);
      const color = rampAt(ramp, Math.min(1, Math.max(0, v))).map((c) => Math.min(255, c * (0.88 + rand() * 0.22)));
      sites.push({ x: px, y: py, color, grain: rand() * 6.28 });
    }
  }
  const rowH = cell * 1.5;
  for (let y = 0; y < h; y++) {
    const gj = Math.floor(y / rowH) + 1;
    for (let x = 0; x < w; x++) {
      const gi = Math.floor(x / cell) + 1;
      let d1 = 1e9;
      let d2 = 1e9;
      let best = null;
      for (let dj = -1; dj <= 1; dj++) {
        const j = gj + dj;
        if (j < 0 || j >= rows) continue;
        for (let di = -1; di <= 1; di++) {
          const i = gi + di;
          if (i < 0 || i >= cols) continue;
          const s = sites[j * cols + i];
          const dx = x - s.x;
          const dy = (y - s.y) / 1.35;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = s;
          } else if (d < d2) d2 = d;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const k = ((y0 + y) * stride + x0 + x) * 4;
      if (edge < 0.9) {
        data[k] = data[k + 1] = data[k + 2] = 10;
        data[k + 3] = 255;
        continue;
      }
      // cast glass: faint streaks, slightly denser towards the lead
      const streak = 0.93 + 0.07 * Math.sin((x * Math.cos(best.grain) + y * Math.sin(best.grain)) * 0.45);
      const f = streak * Math.min(1, 0.82 + edge * 0.06);
      data[k] = best.color[0] * f;
      data[k + 1] = best.color[1] * f;
      data[k + 2] = best.color[2] * f;
      data[k + 3] = 255;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) {
        const k = ((y0 + y) * stride + x0 + x) * 4;
        data[k] = data[k + 1] = data[k + 2] = 10;
      }
    }
  }
}

// Lancets: 16 × 4 tiles of 128 × 512 px. Tile index = facade × 12 + band × 4 + variant.
// Oculi:   16 × 8 tiles of 256 × 256 px, same indexing.
export const ATLAS = {
  lancet: { tileW: 128, tileH: 512, cols: 16, rows: 4 },
  round: { tileW: 256, tileH: 256, cols: 16, rows: 4 },
};
export const VARIANTS = 4;
export function tileIndex(facade, band, variant) {
  return FACADES.indexOf(facade) * BANDS * VARIANTS + band * VARIANTS + (variant % VARIANTS);
}

function buildAtlas(kind) {
  const a = ATLAS[kind];
  const W = a.tileW * a.cols;
  const H = a.tileH * a.rows;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W, H);
  let index = 0;
  for (const facade of FACADES) {
    for (let band = 0; band < BANDS; band++) {
      for (let variant = 0; variant < VARIANTS; variant++) {
        const tx = (index % a.cols) * a.tileW;
        const ty = Math.floor(index / a.cols) * a.tileH;
        paintTile(image.data, W, tx, ty, a.tileW, a.tileH, {
          ramp: RAMPS[facade],
          band,
          seed: index * 7919 + (kind === 'round' ? 104729 : 0),
          cell: kind === 'round' ? 24 : 19, // pieces ~20–30 cm, like cut cathedral glass
        });
        index++;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

export function buildGlassAtlases() {
  return { lancet: buildAtlas('lancet'), round: buildAtlas('round') };
}

// UV rectangle of a tile (v flipped: canvas y grows down, texture v grows up).
export function tileRect(kind, index) {
  const a = ATLAS[kind];
  const col = index % a.cols;
  const row = Math.floor(index / a.cols);
  const u0 = (col * a.tileW) / (a.tileW * a.cols);
  const u1 = ((col + 1) * a.tileW) / (a.tileW * a.cols);
  const v1 = 1 - (row * a.tileH) / (a.tileH * a.rows);
  const v0 = 1 - ((row + 1) * a.tileH) / (a.tileH * a.rows);
  return { u0, u1, v0, v1 };
}

// Average transmittance of a facade/band, for the diffuse light a window sheds.
export function averageGlassColor(facade, band) {
  const ramp = RAMPS[facade];
  const sum = [0, 0, 0];
  for (let i = 0; i < 32; i++) {
    const v = 0.08 + (i / 31) * 0.42 + (band / (BANDS - 1)) * 0.38;
    const c = rampAt(ramp, Math.min(1, v));
    for (let k = 0; k < 3; k++) sum[k] += Math.min(0.92, Math.pow(c[k] / 255, 1.45) * 1.3) * 0.85;
  }
  return sum.map((v) => v / 32);
}
