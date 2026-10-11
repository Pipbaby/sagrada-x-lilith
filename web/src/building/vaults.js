// Hyperboloid vaults.
//
// Gaudí roofed each nave with intersecting hyperboloids of one sheet whose
// necks are skylights (289 of them in the finished basilica). Seen from below,
// each hyperboloid is a funnel narrowing upward to its neck; where neighbouring
// funnels meet they form creases that hang down, and it is there that the
// branches of the columns arrive. On the central nave, crossing and apse the
// surfaces are tiled along the generatrices with triangles of green and gold
// Venetian glass between (palm leaves); the side-nave vaults are white concrete.
//
// Surface model: for a neck of radius r at height H, the funnel wall at plan
// distance d is H − c·√((d/r)² − 1) — a hyperbola, the meridian of the
// hyperboloid. The vault is the upper envelope (max) of all funnels, lifted to
// H where it meets a wall so it closes against the clerestory and outer walls.

import * as THREE from 'three';
import { zoneAt, HEIGHTS, M, APSE } from './plan.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ regions

function neck(x, z, r, drop, reach, teeth, kind = 'star') {
  // choose c so the funnel has fallen `drop` metres at distance `reach`
  const c = drop / Math.sqrt(Math.max(0.01, (reach / r) ** 2 - 1));
  return { x, z, r, c, teeth, kind };
}

function sideNecks() {
  const list = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 10; j++) {
      const x = -30 + (i + 0.5) * M;
      const z = (j + 0.5) * M;
      if (zoneAt(x, z) === HEIGHTS.side) list.push(neck(x, z, 0.6, 5.2, 3.75, 9));
    }
  }
  // ambulatory: a ring between the presbytery columns and the chapels
  for (let k = 0; k <= 6; k++) {
    const a = (Math.PI * (k + 0.5)) / 7;
    list.push(neck(APSE.cx + Math.cos(a) * 11.25, APSE.cz + Math.sin(a) * 11.25, 0.6, 5.2, 3.75, 9));
  }
  return list;
}

// Central nave: per 7.5 m bay one large gilt star on the axis and one flanking
// star each side, set on the bay line so the rows interlock (as in the
// photographs). Sizes vary a little from bay to bay; nothing is repeated
// exactly, so the vault reads as grown rather than tiled.
function jitter(i, amp) {
  const f = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return (f - Math.floor(f) - 0.5) * 2 * amp;
}
function naveNecks() {
  const list = [];
  for (let k = 0; k < 7; k++) {
    const z = 3.75 + k * M;
    list.push(neck(0, z + jitter(k, 0.25), 1.15 + jitter(k + 10, 0.1), 7.0, 3.9, 16, 'medallion'));
    if (k > 0) {
      for (const s of [-1, 1]) {
        const i = k * 2 + (s > 0 ? 1 : 0);
        list.push(neck(s * (4.7 + jitter(i + 20, 0.2)), k * M + jitter(i + 30, 0.3), 0.62 + jitter(i + 40, 0.08), 5.6, 3.3, 12));
      }
    }
  }
  // transept central naves: the same pattern turned 90°
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = s * (11.25 + k * M);
      list.push(neck(x + jitter(k + 50, 0.25), 60, 1.15, 7.0, 3.9, 16, 'medallion'));
      if (k < 2) {
        const xm = s * (15 + k * M);
        for (const t of [-1, 1]) list.push(neck(xm + jitter(k + t + 60, 0.3), 60 + t * 4.7, 0.62, 5.6, 3.3, 12));
      }
    }
  }
  return list;
}

// Crossing (60 m): concentric vaults radiating from the great central
// hyperboloid — an inner ring of eight and an outer ring of twelve smaller
// stars, the outer ring turned half a step so the two interlock.
function crossingNecks() {
  const list = [neck(0, 60, 2.2, 9, 7, 24, 'sun')];
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * 2 * k) / 8 + Math.PI / 8;
    list.push(neck(Math.cos(a) * 4.3, 60 + Math.sin(a) * 4.3, 0.55, 5.0, 2.2, 12));
  }
  for (let k = 0; k < 12; k++) {
    const a = (Math.PI * 2 * (k + 0.5)) / 12;
    const r = 6.3;
    const x = Math.cos(a) * r;
    const z = 60 + Math.sin(a) * r;
    if (Math.abs(x) > 6.6 || Math.abs(z - 60) > 6.6) continue; // stay inside the 15 m square
    list.push(neck(x, z, 0.4, 4.2, 1.8, 9));
  }
  return list;
}

function apseNecks() {
  const list = [neck(0, 75.5, 2.8, 10, 7.4, 24, 'trinity')];
  for (let k = 0; k < 7; k++) {
    const a = (Math.PI * (k + 0.5)) / 7;
    list.push(neck(Math.cos(a) * 5.6, 75 + Math.sin(a) * 5.6, 0.5, 5.0, 2.4, 9));
  }
  list.push(neck(-4.2, 70.2, 0.5, 5.0, 2.4, 9), neck(4.2, 70.2, 0.5, 5.0, 2.4, 9));
  return list;
}

export const REGIONS = [
  { name: 'side', H: HEIGHTS.side, finish: 0, necks: sideNecks() },
  { name: 'nave', H: HEIGHTS.nave, finish: 1, necks: naveNecks() },
  { name: 'crossing', H: HEIGHTS.crossing, finish: 1, necks: crossingNecks() },
  { name: 'apse', H: HEIGHTS.apse, finish: 2, necks: apseNecks() },
];

// ------------------------------------------------------------------ distance to walls
//
// Each region gets a chamfer distance field (0.25 m grid) to its boundary; the
// vault is lifted towards H within a few metres of a wall.

const DF = { x0: -31, z0: -1, step: 0.25, nx: 249, nz: 369 };

function distanceField(H) {
  const { nx, nz, step } = DF;
  const d = new Float32Array(nx * nz);
  const BIG = 1e6;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const inside = zoneAt(DF.x0 + i * step, DF.z0 + j * step) === H;
      d[j * nx + i] = inside ? BIG : 0;
    }
  }
  const a = step;
  const b = step * Math.SQRT2;
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? 0 : d[j * nx + i]);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!d[k]) continue;
      d[k] = Math.min(d[k], at(i - 1, j) + a, at(i, j - 1) + a, at(i - 1, j - 1) + b, at(i + 1, j - 1) + b);
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!d[k]) continue;
      d[k] = Math.min(d[k], at(i + 1, j) + a, at(i, j + 1) + a, at(i + 1, j + 1) + b, at(i - 1, j + 1) + b);
    }
  }
  return d;
}

function sampleField(d, x, z) {
  const fx = (x - DF.x0) / DF.step;
  const fz = (z - DF.z0) / DF.step;
  const i = Math.max(0, Math.min(DF.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(DF.nz - 2, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i));
  const v = Math.min(1, Math.max(0, fz - j));
  const k = j * DF.nx + i;
  return (d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + DF.nx] * (1 - u) + d[k + DF.nx + 1] * u) * v;
}

// ------------------------------------------------------------------ surface

const WALL_LIFT = 1.1; // slope of the lift towards walls (m per m)

class Vault {
  constructor(region) {
    Object.assign(this, region);
    this.field = distanceField(region.H);
    // spatial hash so each query only looks at nearby necks
    this.hash = new Map();
    region.necks.forEach((n, index) => {
      n.index = index;
      const key = `${Math.floor(n.x / M)},${Math.floor(n.z / M)}`;
      if (!this.hash.has(key)) this.hash.set(key, []);
      this.hash.get(key).push(n);
    });
  }

  nearby(x, z) {
    const ci = Math.floor(x / M);
    const cj = Math.floor(z / M);
    const out = [];
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        const bucket = this.hash.get(`${ci + di},${cj + dj}`);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }

  funnel(n, x, z) {
    const q = Math.hypot(x - n.x, z - n.z) / n.r;
    return q <= 1 ? this.H : this.H - n.c * Math.sqrt(q * q - 1);
  }

  // Envelope height and the neck that owns this point.
  evaluate(x, z, candidates = this.nearby(x, z)) {
    let best = -Infinity;
    let owner = null;
    for (const n of candidates) {
      const f = this.funnel(n, x, z);
      if (f > best) {
        best = f;
        owner = n;
      }
    }
    const lift = this.H - WALL_LIFT * sampleField(this.field, x, z);
    return { y: Math.min(this.H, Math.max(best, lift)), owner };
  }

  height(x, z) {
    return this.evaluate(x, z).y;
  }

  inside(x, z) {
    return zoneAt(x, z) === this.H;
  }
}

export const vaults = REGIONS.map((r) => new Vault(r));

export function vaultAbove(x, z) {
  const H = zoneAt(x, z);
  return vaults.find((v) => v.H === H) || null;
}

// ------------------------------------------------------------------ mesh

// Serrated rim: white triangles reach in from the crease towards the neck,
// between the points of the gilt star, and hang slightly below it.
export const TOOTH_REACH = 0.62; // how far in (fraction of neck→crease) the white reaches
function tooth(theta, count) {
  const f = (theta / TAU) * count;
  return 1 - Math.abs((f - Math.floor(f)) * 2 - 1); // triangle wave 0…1
}
function whiteMask(t, tri, soft = 0.04) {
  const edge = 1 - TOOTH_REACH * tri;
  return THREE.MathUtils.smoothstep(t, edge - soft, edge + soft);
}

function buildVaultGeometry(vault) {
  const positions = [];
  const attrib = []; // (u: neck→crease, θ/2π, neck radius, finish)
  const neckInfo = []; // (neckX, neckZ, teeth, kind)
  const indices = [];
  const kinds = { star: 0, medallion: 1, sun: 2, trinity: 3 };

  for (const n of vault.necks) {
    const candidates = vault.nearby(n.x, n.z);
    // Concrete side vaults are read as folded ruled planes: sample the angle
    // at tooth resolution so each fold is a flat facet. Tiled vaults stay smooth.
    const K = vault.finish === 0 ? n.teeth * 6 : n.r > 1.5 ? 288 : n.r > 0.8 ? 192 : 144;
    const R = vault.finish === 0 ? 20 : 28;
    const toothDepth = (vault.finish === 0 ? 0.55 : 0.7) + n.r * 0.25;
    const base = positions.length / 3;

    const owns = (x, z) => vault.inside(x, z) && vault.evaluate(x, z, candidates).owner === n;

    for (let k = 0; k < K; k++) {
      const theta = (k / K) * TAU;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      // march to the crease (or the region edge), then refine by bisection
      let lo = n.r;
      let hi = n.r;
      const step = 0.12;
      while (hi < 16 && owns(n.x + dx * (hi + step), n.z + dz * (hi + step))) hi += step;
      lo = hi;
      hi = hi + step;
      for (let it = 0; it < 14; it++) {
        const mid = (lo + hi) / 2;
        if (owns(n.x + dx * mid, n.z + dz * mid)) lo = mid;
        else hi = mid;
      }
      const end = lo + 0.03; // overlap the neighbour slightly to hide seams

      for (let s = 0; s <= R; s++) {
        const u = s / R;
        // denser rings near the neck and near the crease
        const w = 0.5 - 0.5 * Math.cos(Math.PI * u);
        const rho = n.r + (end - n.r) * (0.25 * u + 0.75 * w);
        const x = n.x + dx * rho;
        const z = n.z + dz * rho;
        let y = vault.evaluate(x, z, candidates).y;
        const t = (rho - n.r) / Math.max(0.001, end - n.r);
        // the white plates hang below the gilt field, deepest at the crease
        y -= toothDepth * whiteMask(t, tooth(theta + Math.PI / n.teeth, n.teeth)) * (0.35 + 0.65 * t);
        positions.push(x, y, z);
        attrib.push(t, k / K, n.r, vault.finish);
        neckInfo.push(n.x, n.z, n.teeth, kinds[n.kind]);
      }
    }
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      for (let s = 0; s < R; s++) {
        const a = base + k * (R + 1) + s;
        const b = base + k2 * (R + 1) + s;
        // faces point down, into the building
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('vault', new THREE.Float32BufferAttribute(attrib, 4));
  g.setAttribute('neck', new THREE.Float32BufferAttribute(neckInfo, 4));
  g.setIndex(indices);
  g.computeVertexNormals();
  // fix winding if the normals came out pointing up
  const nrm = g.getAttribute('normal');
  let up = 0;
  for (let i = 0; i < nrm.count; i += 97) up += nrm.getY(i);
  if (up > 0) {
    const idx = g.getIndex().array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.computeVertexNormals();
  }
  return g;
}

// Skylight necks: short star-lipped tubes rising above each neck, capped by a
// disc that glows with light from above.
function buildNeckGeometry(vault) {
  const tubes = [];
  const caps = [];
  const lamps = [];
  const rings = [];
  for (const n of vault.necks) {
    const segs = Math.max(24, n.teeth * 2);
    const h = 0.8 + n.r * 0.6;
    const tube = new THREE.CylinderGeometry(n.r * 0.82, n.r, h, segs, 1, true);
    tube.translate(n.x, vault.H + h / 2, n.z);
    tubes.push(tube);
    const cap = new THREE.CircleGeometry(n.r * 0.82, segs);
    cap.rotateX(Math.PI / 2); // face down
    cap.translate(n.x, vault.H + h - 0.01, n.z);
    const kind = { star: 0, medallion: 1, sun: 2, trinity: 3 }[n.kind];
    const count = cap.getAttribute('position').count;
    cap.setAttribute('kind', new THREE.Float32BufferAttribute(new Array(count).fill(kind), 1));
    const uv = cap.getAttribute('uv');
    caps.push(cap);
    void uv;
    // "Lamps": metal elements hung in the larger skylights to scatter the
    // light; here a glowing disc inside a star-pointed metal ring.
    if (n.kind === 'sun') {
      // the crossing: a ring of small glowing globes round the great skylight
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const rr = n.r * 1.9;
        const globe = new THREE.SphereGeometry(0.38, 14, 10);
        const gx = n.x + Math.cos(a) * rr;
        const gz = n.z + Math.sin(a) * rr;
        globe.translate(gx, vault.height(gx, gz) - 0.7 - (k % 2) * 0.45, gz); // hung just under the funnel
        lamps.push(globe); // indexed, like the discs (mergeGeometries needs one kind)
      }
    }
    if (n.kind !== 'star' || n.r >= 0.55) {
      const y = vault.H - 0.35 - n.r * 0.3;
      const disc = new THREE.CircleGeometry(n.r * 0.42, 24).rotateX(Math.PI / 2);
      disc.translate(n.x, y, n.z);
      lamps.push(disc);
      const pts = [];
      const points = 12;
      for (let k = 0; k <= points * 2; k++) {
        const a = (k / (points * 2)) * Math.PI * 2;
        const rr = n.r * (k % 2 ? 0.62 : 0.8);
        pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
      }
      const star = new THREE.Shape(pts);
      star.holes.push(new THREE.Path(new THREE.Path().absarc(0, 0, n.r * 0.44, 0, Math.PI * 2, true).getPoints(24)));
      const ring = new THREE.ExtrudeGeometry(star, { depth: 0.05, bevelEnabled: false });
      ring.rotateX(Math.PI / 2);
      ring.translate(n.x, y + 0.02, n.z);
      rings.push(ring);
    }
  }
  return { tubes, caps, lamps, rings };
}

export function buildVaults() {
  return vaults.map((vault) => ({
    vault,
    geometry: buildVaultGeometry(vault),
    necks: buildNeckGeometry(vault),
  }));
}

// ------------------------------------------------------------------ landing sites
//
// Where the creases of three or more funnels meet, the vault hangs lowest; those
// points are where the branches of the columns arrive.

export function landingSites(vault) {
  const sites = [];
  const step = 0.25;
  const xs = [];
  const zs = [];
  for (let x = -30; x <= 30; x += step) xs.push(x);
  for (let z = 0; z <= 90; z += step) zs.push(z);
  const H = new Float32Array(xs.length * zs.length).fill(Infinity);
  zs.forEach((z, j) =>
    xs.forEach((x, i) => {
      if (vault.inside(x, z) && sampleField(vault.field, x, z) > 1.4) H[j * xs.length + i] = vault.height(x, z);
    }),
  );
  const W = 5; // neighbourhood half-width (cells)
  for (let j = W; j < zs.length - W; j++) {
    for (let i = W; i < xs.length - W; i++) {
      const h = H[j * xs.length + i];
      if (!Number.isFinite(h)) continue;
      let lowest = true;
      for (let dj = -W; dj <= W && lowest; dj++) {
        for (let di = -W; di <= W; di++) {
          if ((di || dj) && H[(j + dj) * xs.length + i + di] < h - 1e-4) {
            lowest = false;
            break;
          }
        }
      }
      if (lowest && vault.H - h > 1.0) sites.push({ x: xs[i], z: zs[j], y: h, vault });
    }
  }
  // merge plateaus that produced several adjacent minima
  const merged = [];
  for (const s of sites) {
    if (!merged.some((m) => Math.hypot(m.x - s.x, m.z - s.z) < 1.2)) merged.push(s);
  }
  return merged;
}
