// Tree columns.
//
// Shaft: Gaudí's double twist. A star-shaped section with n points is copied
// twice; one copy turns right as it rises and the other left, and the column
// is their intersection. After n metres the copies have each turned by
// π/(2n), so their points interleave and the intersection has 2n shallower
// points; that becomes the next section's profile, which twists by half the
// angle over half the height, and so on — the column rounds off as it climbs.
//
// Knot: the "capital", shaped like a knot in a tree, where the column branches.
// Branches: straight, inclined, faceted members that climb to the low points
// of the vault (where hyperboloids meet), splitting again part-way when several
// land near each other.

import * as THREE from 'three';
import { columns, COLUMN_TYPES, HEIGHTS, GALLERIES } from './plan.js';
import { vaults, landingSites } from './vaults.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ shaft

function starProfile(n, R, valley) {
  const sector = TAU / n;
  return (phi) => {
    let f = (((phi % sector) + sector) % sector) / sector; // 0…1 across the sector
    f = f * 2 - 1; // points at ±1, flute bottom at 0
    return R * (valley + (1 - valley) * f * f);
  };
}

// Profile at section k (k = 0 is the base star).
function sectionProfile(base, n, k) {
  let p = base;
  for (let s = 0; s < k; s++) {
    const a = Math.PI / (2 * n * 2 ** s);
    const prev = p;
    p = (phi) => Math.min(prev(phi - a), prev(phi + a));
  }
  return p;
}

export function doubleTwistRadius(type) {
  const { points: n, diameter } = COLUMN_TYPES[type];
  const base = starProfile(n, diameter / 2, 0.84);
  const sections = 5;
  const profiles = Array.from({ length: sections + 1 }, (_, k) => sectionProfile(base, n, k));
  const starts = [0];
  for (let k = 0; k < sections; k++) starts.push(starts[k] + n / 2 ** k);
  return (phi, y) => {
    let k = 0;
    while (k < sections - 1 && y >= starts[k + 1]) k++;
    if (y >= starts[sections]) return profiles[sections](phi);
    const f = (y - starts[k]) / (starts[k + 1] - starts[k]);
    const a = (f * Math.PI) / (2 * n * 2 ** k);
    return Math.min(profiles[k](phi - a), profiles[k](phi + a));
  };
}

function shaftGeometry(type) {
  const { knot: height } = COLUMN_TYPES[type];
  const radius = doubleTwistRadius(type);
  const A = 216;
  const rows = [];
  // the profile turns slowly (π/2n over n metres), so 0.2 m rows are plenty;
  // a few extra at the foot where it flares
  for (let y = 0; y < height; y += y < 0.5 ? 0.1 : 0.2) rows.push(y);
  rows.push(height);
  const pos = [];
  const uv = [];
  for (const y of rows) {
    for (let a = 0; a <= A; a++) {
      const phi = (a / A) * TAU;
      const r = radius(phi, y) * (y < 0.4 ? 1 + 0.05 * (1 - y / 0.4) : 1); // slight foot
      pos.push(Math.cos(phi) * r, y, Math.sin(phi) * r);
      uv.push((a / A) * Math.PI * COLUMN_TYPES[type].diameter, y);
    }
  }
  const idx = [];
  for (let j = 0; j < rows.length - 1; j++) {
    for (let a = 0; a < A; a++) {
      const p = j * (A + 1) + a;
      const q = p + A + 1;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ knots

// Lathe around y with an angular modulation function.
function lathe(profile, modulate, segments = 96, rows = 40) {
  const pos = [];
  const uv = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const { r, y } = profile(t);
    for (let a = 0; a <= segments; a++) {
      const phi = (a / segments) * TAU;
      const rr = r * modulate(phi, t);
      pos.push(Math.cos(phi) * rr, y, Math.sin(phi) * rr);
      uv.push((a / segments) * TAU * r, y);
    }
  }
  const idx = [];
  for (let j = 0; j < rows; j++) {
    for (let a = 0; a < segments; a++) {
      const p = j * (segments + 1) + a;
      const q = p + segments + 1;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const KNOTS = {
  // pale ellipsoid carrying round lamps
  granite: { height: 2.6, bulge: 1.45, top: 0.55 },
  // dark, built from stacked rounded scales
  basalt: { height: 2.4, bulge: 1.3, top: 0.55, scales: true },
  // large ellipsoid with the four evangelists' oval glass medallions
  porphyry: { height: 3.6, bulge: 1.35, top: 0.55 },
  // bell capital carrying the choir gallery
  sandstone: { height: 2.1, bell: true },
};

export function knotTop(type) {
  const t = COLUMN_TYPES[type];
  return t.knot + KNOTS[type].height;
}

function knotGeometry(type) {
  const { diameter } = COLUMN_TYPES[type];
  const R = diameter / 2;
  const k = KNOTS[type];
  if (k.bell) {
    // flares from the shaft to a serrated rim under the gallery soffit
    const rim = 1.55;
    return lathe(
      (t) => {
        if (t < 0.85) {
          const s = t / 0.85;
          return { r: R + (rim - R) * s ** 2.2, y: k.height * 0.8 * s };
        }
        const s = (t - 0.85) / 0.15;
        return { r: rim * (1 - s), y: k.height * (0.8 + 0.2 * Math.min(1, s * 3)) };
      },
      // the shaft's flutes run up into the bell and end in a serrated rim
      (phi, t) => {
        const flute = 1 - Math.abs((((phi / TAU) * 12) % 1) * 2 - 1);
        return t < 0.86 ? 1 + 0.06 * flute * Math.min(1, t * 1.5) : 1;
      },
      144,
      36,
    );
  }
  const H = k.height;
  const profile = (t) => {
    // ellipsoid from the shaft radius, bulging, closing on the branch cluster
    const s = Math.sin(Math.PI * t);
    const r0 = R * (1 - t) + R * k.top * t;
    return { r: r0 + R * (k.bulge - 1) * 1.6 * s ** 0.8, y: H * t };
  };
  if (!k.scales) return lathe(profile, () => 1, 96, 40);
  // basalt: three staggered rows of rounded scales
  return lathe(
    profile,
    (phi, t) => {
      const row = Math.min(2, Math.floor(t * 3));
      const local = t * 3 - row;
      const count = 10;
      const f = ((phi / TAU) * count + (row % 2) * 0.5) % 1;
      const bump = Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2)) * Math.sin(Math.PI * local) ** 0.6;
      return 0.9 + 0.16 * bump;
    },
    160,
    60,
  );
}

// Lamps set into the granite and porphyry knots (oval discs facing out).
// Lamps set into the granite knots (four small frosted ovals), and on the
// four porphyry columns of the crossing the Evangelists' symbols: one large
// oval medallion of coloured glass each, facing into the crossing.
const CROSSING = { x: 0, z: 60 };
function medallions(type, x, z, out) {
  if (type !== 'granite' && type !== 'porphyry') return;
  const { knot, diameter } = COLUMN_TYPES[type];
  const k = KNOTS[type];
  const R = (diameter / 2) * (1 + (k.bulge - 1) * 1.6 * 0.95);
  const place = (a, w, h, kind, y) => {
    const g = new THREE.CircleGeometry(0.5, 48);
    g.scale(w, h, 1);
    g.rotateY(Math.PI / 2 - a);
    g.translate(x + Math.cos(a) * (R + 0.04), y, z + Math.sin(a) * (R + 0.04));
    const n = g.getAttribute('position').count;
    g.setAttribute('medallion', new THREE.Float32BufferAttribute(new Array(n).fill(kind), 1));
    out.push(g);
  };
  if (type === 'porphyry') {
    const a = Math.atan2(CROSSING.z - z, CROSSING.x - x);
    // which Evangelist: by quadrant around the crossing
    const kind = 1 + (x < 0 ? 0 : 1) + (z < CROSSING.z ? 0 : 2);
    place(a, 1.7, 2.3, kind, knot + k.height * 0.52);
    return;
  }
  for (let i = 0; i < 4; i++) place((i * TAU) / 4 + Math.PI / 4, 0.62, 0.78, 0, knot + k.height * 0.5);
}

// ------------------------------------------------------------------ branches

// A branch is itself a small double-twist column: an n-pointed star section
// copied twice, the copies turning in opposite senses as the branch climbs,
// the branch being their intersection. Over its length the copies turn by
// π/(2n), so the n sharp points at the foot become 2n shallow ones at the
// top — the same rounding-off the shafts show. Tapered from r0 to r1.
function branchGeometry(a, b, r0, r1, points = 8, spin = 0) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  dir.normalize();
  const ref = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const rows = Math.max(4, Math.ceil(len / 0.8));
  const star = starProfile(points, 1, 0.8);
  const A = points * 4; // samples per ring: point, flank, valley, flank
  const pos = [];
  const uv = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const r = r0 + (r1 - r0) * t;
    const tw = (t * Math.PI) / (2 * points);
    const c = new THREE.Vector3().copy(a).addScaledVector(dir, len * t);
    for (let s = 0; s <= A; s++) {
      const phi = (s / A) * TAU;
      const rr = r * Math.min(star(phi - tw + spin), star(phi + tw + spin));
      const p = c.clone().addScaledVector(u, Math.cos(phi) * rr).addScaledVector(v, Math.sin(phi) * rr);
      pos.push(p.x, p.y, p.z);
      uv.push((s / A) * TAU * r, t * len);
    }
  }
  const idx = [];
  const ring = A + 1;
  for (let j = 0; j < rows; j++) {
    for (let s = 0; s < A; s++) {
      const p = j * ring + s;
      const q = p + ring;
      idx.push(p, p + 1, q, p + 1, q + 1, q); // outward-facing
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Secondary knot where a limb forks: an ellipsoid stretched along the limb,
// with shallow lobes where the twigs leave it.
function smallKnot(p, r, along, points) {
  const g = new THREE.SphereGeometry(r, 24, 16);
  const pos = g.getAttribute('position');
  const q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    q.fromBufferAttribute(pos, i);
    const phi = Math.atan2(q.z, q.x);
    const lobe = 1 + 0.08 * Math.cos(phi * points) * (1 - Math.abs(q.y / r));
    pos.setXYZ(i, q.x * lobe, q.y * 1.55, q.z * lobe);
  }
  g.computeVertexNormals();
  // stand the ellipsoid along the limb
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along));
  g.translate(p.x, p.y, p.z);
  return g;
}

// A small frosted lamp set into a secondary knot, facing down and out.
function knotLamp(p, knotR, outward, out) {
  const size = knotR * 0.55;
  const g = new THREE.CircleGeometry(0.5, 24);
  g.scale(size * 0.9, size * 1.2, 1);
  const n = new THREE.Vector3(outward.x, -0.55, outward.z).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
  // distance to the ellipsoid's surface (×1.55 tall) along n, plus the lobes
  const h = Math.hypot(n.x, n.z);
  const d = (1.1 * knotR) / Math.hypot(h, n.y / 1.55);
  g.translate(p.x + n.x * d, p.y + n.y * d, p.z + n.z * d);
  g.setAttribute('medallion', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count).fill(0), 1));
  out.push(g);
}

const REACH = { side: 7.2, nave: 9.5, crossing: 11, apse: 10 };
const MAX_SITES = { sandstone: 4, granite: 6, basalt: 6, porphyry: 9 };
const SECTORS = { sandstone: 2, granite: 3, basalt: 3, porphyry: 4 };

// Split a column's landing sites into limbs: by vault first (low side vaults vs
// the high central vault), then by direction around the column.
function branchGroups(c, sites, sectors) {
  const byVault = new Map();
  for (const s of sites) {
    if (!byVault.has(s.vault.name)) byVault.set(s.vault.name, []);
    byVault.get(s.vault.name).push(s);
  }
  const groups = [];
  const vaultCount = byVault.size;
  for (const list of byVault.values()) {
    const k = Math.max(1, Math.round(sectors / vaultCount));
    list.sort((a, b) => Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x));
    // split the angularly sorted list at its k − 1 widest gaps
    const angles = list.map((s) => Math.atan2(s.z - c.z, s.x - c.x));
    const gaps = angles.map((a, i) => ({ i, gap: (i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2) - a }));
    const cuts = gaps.sort((a, b) => b.gap - a.gap).slice(0, Math.min(k, list.length)).map((g) => g.i).sort((a, b) => a - b);
    for (let j = 0; j < cuts.length; j++) {
      const from = cuts[j] + 1;
      const to = j + 1 < cuts.length ? cuts[j + 1] + 1 : cuts[0] + 1 + list.length;
      const group = [];
      for (let i = from; i < to; i++) group.push(list[i % list.length]);
      if (group.length) groups.push(group);
    }
  }
  return groups;
}

function planBranches() {
  // every landing site goes to the nearest column that can reach it
  const assignments = new Map(columns.map((c) => [c, []]));
  for (const vault of vaults) {
    for (const site of landingSites(vault)) {
      let best = null;
      let bestD = REACH[vault.name];
      for (const c of columns) {
        const top = knotTop(c.type);
        if (top > site.y - 5) continue;
        const d = Math.hypot(site.x - c.x, site.z - c.z);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best) assignments.get(best).push(site);
    }
  }
  return assignments;
}

export function buildColumns() {
  const shafts = {};
  const knots = {};
  for (const type of Object.keys(COLUMN_TYPES)) {
    shafts[type] = { geometry: shaftGeometry(type), placements: [] };
    knots[type] = { geometry: knotGeometry(type), placements: [] };
  }
  const branchParts = [];
  const lampParts = [];
  const colliders = [];

  const assignments = planBranches();
  for (const c of columns) {
    const T = COLUMN_TYPES[c.type];
    shafts[c.type].placements.push(new THREE.Vector3(c.x, 0, c.z));
    knots[c.type].placements.push(new THREE.Vector3(c.x, T.knot, c.z));
    medallions(c.type, c.x, c.z, lampParts);
    colliders.push({ x: c.x, z: c.z, r: T.diameter / 2 + 0.08 });

    const origin = new THREE.Vector3(c.x, knotTop(c.type) - 0.35, c.z);
    // keep the nearest sites; the vault spans the rest by itself
    const sites = assignments
      .get(c)
      .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))
      .slice(0, MAX_SITES[c.type]);
    const baseR = T.diameter * 0.42;
    // limbs keep the column's number of points; the twigs above a fork have fewer
    const limbPoints = T.points;
    const twigPoints = Math.max(5, Math.round(T.points * 0.75));
    let g = 0;
    for (const group of branchGroups(c, sites, SECTORS[c.type])) {
      const spin = g++ * 0.37; // neighbouring limbs don't line their points up
      const targets = group.map((s) => new THREE.Vector3(s.x, s.y + 0.3, s.z));
      if (targets.length === 1) {
        branchParts.push(branchGeometry(origin, targets[0], baseR * 0.85, baseR * 0.6, limbPoints, spin));
        continue;
      }
      const centroid = targets.reduce((acc, t) => acc.add(t), new THREE.Vector3()).divideScalar(targets.length);
      const low = Math.min(...targets.map((t) => t.y));
      // the limb climbs most of the way, then forks at a small knot
      const split = new THREE.Vector3(
        THREE.MathUtils.lerp(origin.x, centroid.x, 0.5),
        THREE.MathUtils.lerp(origin.y, low, 0.66),
        THREE.MathUtils.lerp(origin.z, centroid.z, 0.5),
      );
      const limbR = baseR * Math.min(1.25, 0.85 + 0.1 * targets.length);
      branchParts.push(branchGeometry(origin, split, limbR, limbR * 0.82, limbPoints, spin));
      const along = new THREE.Vector3().subVectors(split, origin).normalize();
      branchParts.push(smallKnot(split, limbR * 1.25, along, limbPoints));
      // the granite columns of the central nave carry small lamps in these knots
      if (c.type === 'granite') {
        const outward = new THREE.Vector3(split.x - c.x, 0, split.z - c.z).normalize();
        knotLamp(split, limbR * 1.25, outward, lampParts);
      }
      for (const t of targets) branchParts.push(branchGeometry(split, t, limbR * 0.74, limbR * 0.58, twigPoints, spin + 0.2));
    }
  }
  return { shafts, knots, branchParts, lampParts, colliders };
}

export { GALLERIES, HEIGHTS };
