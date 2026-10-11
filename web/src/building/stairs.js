// Spiral staircases up to the choir galleries at 15 m, and the galleries as a place to walk.
//
// Four stone drums: two in the Glory corners of the outer side naves (they serve the side
// galleries and the Glory gallery, which are joined) and two under the straight arms of the
// apse gallery (the children's choir). Each holds a stone spiral stair round a newel: a landing
// at the door, 76 steps of 20 cm in four whole turns, and a landing at the gallery opening,
// which is straight above the door. Taller than the gallery the drums carry on to the vault
// as before, closed off inside by a ceiling over the top landing.
//
// The walker's ground is one height per plan point, so the stair and the galleries are
// `shape` colliders whose heightAt(x, z, y) also takes the walker's height: on a spiral the
// same plan point has a step on every turn, and a gallery floor exists only up at 15 m.
//
// Angles in the plan: x = cx + r cos φ, z = cz + r sin φ (degrees). Climbing turns the
// stair's angle upwards (anticlockwise seen from above).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, APSE_GALLERY } from './plan.js';

export const GALLERY_FLOOR = 15.2; // top of the gallery slabs
const BODY = 0.3; // the walker's radius (controls.js)
const BLOCK = 999; // "a wall here": far too high to step onto

const R_OUT = 1.5;
export const STAIR_RADIUS = R_OUT;
const WALL = 0.2;
const R_IN = R_OUT - WALL;
const NEWEL = 0.18;
const TURNS = 4;
const LANDING = 72; // degrees of flat landing at the foot and at the top
const WEDGE = 18; // degrees per step: twenty steps a turn
const STEPS = (TURNS * 360 - LANDING) / WEDGE; // 76
const RISE = GALLERY_FLOOR / STEPS; // 0.2 m
const TREAD = 0.24; // thickness of each stone step
const DOOR = { from: 3, to: LANDING - 3, height: 2.4 }; // door sector (degrees from φ0) and height
const CEILING = GALLERY_FLOOR + 2.4; // inside the drum, over the top landing
const DRUM_TOP = 30; // the side-nave vault

// face: the direction (degrees) the door and the gallery opening look towards
export const STAIRS = [
  { x: -17, z: 1.65, face: 90 }, // Glory corners, opening towards the apse
  { x: 17, z: 1.65, face: 90 },
  { x: -12.9, z: 70.8, face: -90 }, // under the apse gallery's arms, opening towards the crossing
  { x: 12.9, z: 70.8, face: -90 },
].map((s) => ({ ...s, phi0: s.face - LANDING / 2 }));

const mod = (a, n) => ((a % n) + n) % n;
const deg = (rad) => (rad * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

// Height of the stair's walking surface a distance u (degrees) along the helix from the foot.
function treadHeight(u) {
  if (u < LANDING) return 0;
  if (u >= TURNS * 360) return GALLERY_FLOOR; // top landing
  return Math.min(STEPS, Math.floor((u - LANDING) / WEDGE) + 1) * RISE;
}

// ------------------------------------------------------------------ walking

// One stair: the steps under a walker at height y, the drum wall with its two openings, the newel.
function stairHeightAt(st, x, z, y) {
  const dx = x - st.x;
  const dz = z - st.z;
  const d = Math.hypot(dx, dz);
  if (d >= R_OUT + BODY) return null;
  const rel = mod(deg(Math.atan2(dz, dx)) - st.phi0, 360);
  if (d > R_IN - BODY) {
    // the drum wall: passable only through the door (at the foot) or the opening (at the top)
    if (rel >= DOOR.from && rel <= DOOR.to) {
      if (y < 1) return 0;
      if (y > GALLERY_FLOOR - 0.5) return GALLERY_FLOOR;
    }
    return BLOCK;
  }
  if (d < NEWEL + BODY) return BLOCK;
  // the step on the turn the walker is on: the highest one not above a step's reach
  let best = null;
  for (let t = 0; t <= TURNS; t++) {
    const u = rel + 360 * t;
    if (u >= TURNS * 360 + LANDING) break;
    const h = treadHeight(u);
    if (h <= y + 0.26 && (best === null || h > best)) best = h;
  }
  // no way down a whole turn: past the end of the top landing there is a wall
  if (best === null || y - best > 1.5) return BLOCK;
  return best;
}

// The galleries at 15 m, for a body centre (the railings and parapets are BODY in front).
const SIDE = { x0: 15.25, x1: 22.0, z0: 0.3, z1: 2 * 3 * M - 0.3 }; // |x|, to the end railing at z = 45
const GLORY = { x: 15.25, z0: 0.3, z1: 5.75 };
const ARMS = { x0: 8.2, x1: 14.5, z0: 9 * M + 0.3 }; // apse gallery's straight arms, to z = 75
const RING = { r0: 8.2, r1: 14.7 };

// Tiered choir seating on the side galleries: five tiers rising towards the outer wall, each
// 0.95 m deep and 0.38 m high, with a bench at the back of each; aisles of half steps cross
// the tiers in the middle of three of the bays.
const TIERS = { count: 5, depth: 0.95, rise: 0.38, z0: 7.0, z1: 44.4 };
const AISLES = [11.25, 26.25, 41.25].map((z) => ({ z0: z - 0.6, z1: z + 0.6 }));
const BENCH = { depth: 0.42, height: 0.44 };

function tierAt(ax, z) {
  if (z < TIERS.z0 || z > TIERS.z1) return null;
  const fromWall = 22.5 - ax;
  const k = TIERS.count - Math.floor(fromWall / TIERS.depth); // 1 at the front .. 5 at the wall
  if (k < 1) return null;
  const level = Math.min(k, TIERS.count);
  const inAisle = AISLES.some((a) => z >= a.z0 && z <= a.z1);
  if (inAisle) {
    // half steps: two per tier
    const half = Math.floor(((TIERS.count - fromWall / TIERS.depth) % 1) * 2);
    return GALLERY_FLOOR + (level - 1) * TIERS.rise + (Math.min(half, 1) + 1) * (TIERS.rise / 2);
  }
  const top = GALLERY_FLOOR + level * TIERS.rise;
  // the bench stands against the riser of the tier behind it
  const intoTier = mod(fromWall, TIERS.depth); // 0 at the back of the tier
  return intoTier < BENCH.depth ? top + BENCH.height : top;
}

function inGallery(x, z) {
  const ax = Math.abs(x);
  if (ax >= SIDE.x0 && ax <= SIDE.x1 && z >= SIDE.z0 && z <= SIDE.z1) return true;
  if (ax <= GLORY.x && z >= GLORY.z0 && z <= GLORY.z1) return true;
  if (ax >= ARMS.x0 && ax <= ARMS.x1 && z >= ARMS.z0 && z < APSE_GALLERY.cz) return true;
  if (z >= APSE_GALLERY.cz) {
    const r = Math.hypot(x - APSE_GALLERY.cx, z - APSE_GALLERY.cz);
    if (r >= RING.r0 && r <= RING.r1) return true;
  }
  return false;
}

function galleryHeightAt(x, z, y) {
  if (y < GALLERY_FLOOR - 0.3) return null; // down in the church the galleries are a roof
  for (const st of STAIRS) if (Math.hypot(x - st.x, z - st.z) < R_OUT + BODY) return null; // the stair's own
  if (!inGallery(x, z)) return BLOCK; // parapet, railing or the drop
  return (Math.abs(x) >= SIDE.x0 && tierAt(Math.abs(x), z)) || GALLERY_FLOOR;
}

// On the stair one climbs at a stair's pace, not a walk's.
const STAIR_PACE = 0.3;
const stairSpeedAt = (st, x, z) => (Math.hypot(x - st.x, z - st.z) < R_IN ? STAIR_PACE : 1);

export function galleryColliders() {
  return [
    ...STAIRS.map((st) => ({ type: 'shape', heightAt: (x, z, y = 0) => stairHeightAt(st, x, z, y), speedAt: (x, z) => stairSpeedAt(st, x, z) })),
    { type: 'shape', heightAt: (x, z, y = 0) => galleryHeightAt(x, z, y) },
  ];
}

// ------------------------------------------------------------------ geometry

// A triangle soup with positions, normals and UVs (UVs in metres).
class Soup {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
  }
  // quad a b c d (anticlockwise seen from the front), with per-vertex normals and UVs
  quad(a, b, c, d, na, nb, nc, nd, ua, ub, uc, ud) {
    for (const [p, n, u] of [
      [a, na, ua],
      [b, nb, ub],
      [c, nc, uc],
      [a, na, ua],
      [c, nc, uc],
      [d, nd, ud],
    ]) {
      this.p.push(...p);
      this.n.push(...n);
      this.uv.push(...u);
    }
  }
  flat(a, b, c, d, ua, ub, uc, ud) {
    const n = new THREE.Vector3()
      .subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a)))
      .normalize()
      .toArray();
    this.quad(a, b, c, d, n, n, n, n, ua, ub, uc, ud);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const at = (st, r, a, y) => [st.x + r * Math.cos(rad(a)), y, st.z + r * Math.sin(rad(a))];
const radial = (a, s = 1) => [s * Math.cos(rad(a)), 0, s * Math.sin(rad(a))];

// The drum's shell: outer face (seen from the church), inner face (seen on the stair), and the
// reveals of the door and the gallery opening.
function drum(st, outer, inner) {
  const SEG = 6; // degrees; segments start at DOOR.from so the openings fall on segment edges
  const bands = [0, DOOR.height, GALLERY_FLOOR, GALLERY_FLOOR + DOOR.height, DRUM_TOP];
  const isOpening = (a0, band) => (band === 0 || band === 2) && a0 >= DOOR.from - 1e-6 && a0 + SEG <= DOOR.to + 1e-6;
  for (let a0 = DOOR.from; a0 < DOOR.from + 360; a0 += SEG) {
    const a1 = a0 + SEG;
    const A0 = st.phi0 + a0;
    const A1 = st.phi0 + a1;
    for (let b = 0; b < 4; b++) {
      if (isOpening(a0, b)) continue;
      const [y0, y1] = [bands[b], bands[b + 1]];
      const s0 = rad(A0) * R_OUT;
      const s1 = rad(A1) * R_OUT;
      // outer face, normals outwards
      outer.quad(at(st, R_OUT, A0, y0), at(st, R_OUT, A0, y1), at(st, R_OUT, A1, y1), at(st, R_OUT, A1, y0), radial(A0), radial(A0), radial(A1), radial(A1), [s0, y0], [s0, y1], [s1, y1], [s1, y0]);
      // inner face, normals inwards (below the ceiling only: above it the drum is closed off)
      if (y0 < CEILING) {
        const yy1 = Math.min(y1, CEILING);
        inner.quad(at(st, R_IN, A0, y0), at(st, R_IN, A1, y0), at(st, R_IN, A1, yy1), at(st, R_IN, A0, yy1), radial(A0, -1), radial(A1, -1), radial(A1, -1), radial(A0, -1), [s0, y0], [s1, y0], [s1, yy1], [s0, yy1]);
      }
    }
  }
  // reveals: jambs, lintels and the top sill of both openings
  const from = st.phi0 + DOOR.from;
  const to = st.phi0 + DOOR.to;
  for (const [y0, y1] of [
    [0, DOOR.height],
    [GALLERY_FLOOR, GALLERY_FLOOR + DOOR.height],
  ]) {
    // jambs (facing into the opening)
    outer.flat(at(st, R_OUT, from, y0), at(st, R_OUT, from, y1), at(st, R_IN, from, y1), at(st, R_IN, from, y0), [0, y0], [0, y1], [WALL, y1], [WALL, y0]);
    outer.flat(at(st, R_IN, to, y0), at(st, R_IN, to, y1), at(st, R_OUT, to, y1), at(st, R_OUT, to, y0), [0, y0], [0, y1], [WALL, y1], [WALL, y0]);
    // lintel soffit (facing down) and sill (facing up), in a few segments round the curve
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a0 = from + ((to - from) * k) / n;
      const a1 = from + ((to - from) * (k + 1)) / n;
      outer.flat(at(st, R_IN, a0, y1), at(st, R_OUT, a0, y1), at(st, R_OUT, a1, y1), at(st, R_IN, a1, y1), [a0 / 40, 0], [a0 / 40, WALL], [a1 / 40, WALL], [a1 / 40, 0]);
      if (y0 > 0) outer.flat(at(st, R_IN, a0, y0), at(st, R_IN, a1, y0), at(st, R_OUT, a1, y0), at(st, R_OUT, a0, y0), [a0 / 40, 0], [a1 / 40, 0], [a1 / 40, WALL], [a0 / 40, WALL]);
    }
  }
}

// A stone block over an angular sector, radii r0..r1, between heights y0 and y1.
function sector(soup, st, r0, r1, a0, a1, y0, y1, n = 3) {
  for (let k = 0; k < n; k++) {
    const b0 = a0 + ((a1 - a0) * k) / n;
    const b1 = a0 + ((a1 - a0) * (k + 1)) / n;
    const uv = (r, a) => {
      const p = at(st, r, a, 0);
      return [p[0], p[2]];
    };
    // top and underside
    soup.flat(at(st, r0, b0, y1), at(st, r0, b1, y1), at(st, r1, b1, y1), at(st, r1, b0, y1), uv(r0, b0), uv(r0, b1), uv(r1, b1), uv(r1, b0));
    soup.flat(at(st, r0, b0, y0), at(st, r1, b0, y0), at(st, r1, b1, y0), at(st, r0, b1, y0), uv(r0, b0), uv(r1, b0), uv(r1, b1), uv(r0, b1));
  }
  // riser at the start, back at the end
  const s = (r) => r;
  soup.flat(at(st, r0, a0, y0), at(st, r0, a0, y1), at(st, r1, a0, y1), at(st, r1, a0, y0), [s(r0), y0], [s(r0), y1], [s(r1), y1], [s(r1), y0]);
  soup.flat(at(st, r1, a1, y0), at(st, r1, a1, y1), at(st, r0, a1, y1), at(st, r0, a1, y0), [s(r1), y0], [s(r1), y1], [s(r0), y1], [s(r0), y0]);
}

function stairInside(st, steps, rails, lamps) {
  // the steps, overlapping the newel and the wall a little
  for (let n = 1; n <= STEPS; n++) {
    const a0 = st.phi0 + LANDING + (n - 1) * WEDGE;
    const h = n * RISE;
    sector(steps, st, NEWEL - 0.02, R_IN + 0.02, a0, a0 + WEDGE + 0.4, h - TREAD, h);
  }
  // the top landing
  sector(steps, st, NEWEL - 0.02, R_IN + 0.02, st.phi0 + TURNS * 360, st.phi0 + TURNS * 360 + LANDING, GALLERY_FLOOR - 0.3, GALLERY_FLOOR, 8);
  // the ceiling over it, facing down
  for (let k = 0; k < 40; k++) {
    const a0 = k * 9;
    const a1 = a0 + 9;
    steps.flat(at(st, 0, a0, CEILING), at(st, R_IN + 0.02, a0, CEILING), at(st, R_IN + 0.02, a1, CEILING), at(st, 0, a1, CEILING), [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  // the newel
  const newel = new THREE.CylinderGeometry(NEWEL, NEWEL, CEILING, 16, 1, true);
  const uv = newel.getAttribute('uv'); // in metres, like the rest of the stone
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * NEWEL, uv.getY(i) * CEILING);
  newel.translate(st.x, CEILING / 2, st.z);
  // an iron handrail on the wall, 0.9 m above the nosings
  const pts = [];
  for (let u = LANDING; u <= TURNS * 360; u += 6) {
    const y = ((u - LANDING) / (TURNS * 360 - LANDING)) * GALLERY_FLOOR + 0.9;
    pts.push(new THREE.Vector3(...at(st, R_IN - 0.07, st.phi0 + u, y)));
  }
  rails.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.022, 6, false));
  // small wall lamps every half turn, 2 m above the step below them
  for (let u = LANDING + 90; u < TURNS * 360; u += 180) {
    const lamp = new THREE.SphereGeometry(0.06, 10, 8);
    const p = at(st, R_IN - 0.08, st.phi0 + u, treadHeight(u) + 2.0);
    lamp.translate(...p);
    lamps.push(lamp);
  }
  return newel;
}

// Slit windows climbing the outside of the drum, with the stair (and on up to the vault).
function slits(st, list) {
  for (let u = LANDING + WEDGE; ; u += WEDGE * 2) {
    const y = (u - LANDING) / WEDGE * RISE + 1.1;
    if (y > DRUM_TOP - 1.5) break;
    const rel = mod(u, 360);
    const nearOpening = rel > DOOR.from - 8 && rel < DOOR.to + 8 && (y < DOOR.height + 0.5 || Math.abs(y - GALLERY_FLOOR - 1.2) < 1.8);
    if (nearOpening) continue;
    const a = st.phi0 + u;
    const slit = new THREE.BoxGeometry(0.12, 0.62, 0.06);
    slit.rotateY(-rad(a) + Math.PI / 2);
    slit.translate(...at(st, R_OUT + 0.005, a, y));
    list.push(slit.toNonIndexed());
  }
}

// A plain iron railing (posts and three rails) from a to b at the gallery floor.
function railing(list, a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  for (const h of [0.45, 0.78, 1.1]) {
    const c = new THREE.CylinderGeometry(h === 1.1 ? 0.025 : 0.014, h === 1.1 ? 0.025 : 0.014, len, 6);
    c.rotateX(Math.PI / 2);
    c.rotateY(yaw);
    c.translate((a[0] + b[0]) / 2, GALLERY_FLOOR + h, (a[1] + b[1]) / 2);
    list.push(c);
  }
  const n = Math.max(1, Math.round(len / 0.9));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const post = new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6);
    post.translate(a[0] + (b[0] - a[0]) * t, GALLERY_FLOOR + 0.55, a[1] + (b[1] - a[1]) * t);
    list.push(post);
  }
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();

// Tiers and benches on the side galleries (the walking shape is tierAt).
function choirTiers(tiers, benches) {
  for (const s of [-1, 1]) {
    const zs = [TIERS.z0, ...AISLES.flatMap((a) => [a.z0, a.z1]), TIERS.z1];
    for (let k = 1; k <= TIERS.count; k++) {
      const front = 22.5 - (TIERS.count - k + 1) * TIERS.depth; // |x| of the tier's front edge
      const top = GALLERY_FLOOR + k * TIERS.rise;
      // one block from the front edge to the wall (the tiers above stand on it)
      const w = 22.5 - front;
      // seating sections between the aisles
      for (let i = 0; i < zs.length; i += 2) {
        const [z0, z1] = [zs[i], zs[i + 1]];
        tiers.push(box(w, TIERS.rise, z1 - z0, s * (front + w / 2), top - TIERS.rise / 2, (z0 + z1) / 2));
        // the bench at the back of this tier
        // seat, and the panel under its front edge
        const bx = front + TIERS.depth - BENCH.depth / 2;
        benches.push(box(BENCH.depth - 0.04, 0.06, z1 - z0 - 0.1, s * bx, top + BENCH.height - 0.03, (z0 + z1) / 2));
        benches.push(box(0.04, BENCH.height - 0.06, z1 - z0 - 0.1, s * (front + TIERS.depth - BENCH.depth + 0.04), top + (BENCH.height - 0.06) / 2, (z0 + z1) / 2));
      }
      // the aisles: half steps
      for (const a of AISLES) {
        for (let half = 0; half < 2; half++) {
          const f = front + half * (TIERS.depth / 2);
          const hw = 22.5 - f;
          const ht = GALLERY_FLOOR + (k - 1) * TIERS.rise + (half + 1) * (TIERS.rise / 2);
          tiers.push(box(hw, TIERS.rise / 2, a.z1 - a.z0, s * (f + hw / 2), ht - TIERS.rise / 4, (a.z0 + a.z1) / 2));
        }
      }
    }
  }
}

export function buildStairs(materials) {
  const outer = new Soup();
  const inner = new Soup();
  const steps = new Soup();
  const rails = [];
  const lampList = [];
  const newels = [];
  const slitList = [];
  const course = [];
  for (const st of STAIRS) {
    drum(st, outer, inner);
    newels.push(stairInside(st, steps, rails, lampList));
    slits(st, slitList);
    // a string course round the drum at the gallery floor
    const ring = new THREE.CylinderGeometry(R_OUT + 0.1, R_OUT + 0.1, 0.18, 48, 1, true);
    ring.translate(st.x, GALLERY_FLOOR - 0.09 + 0.02, st.z);
    course.push(ring.toNonIndexed());
  }
  // railings where the galleries stop in mid-air
  const railList = [];
  for (const s of [-1, 1]) {
    railing(railList, [s * 15.0, 2 * 3 * M], [s * 22.5, 2 * 3 * M]); // end of the side galleries (z = 45)
    railing(railList, [s * 8.35, 9 * M], [s * 14.8, 9 * M]); // end of the apse gallery's arms
    railing(railList, [s * 14.8, 9 * M], [s * 14.8, 10 * M]); // their outer side
  }
  const tierList = [];
  const benchList = [];
  choirTiers(tierList, benchList);

  const shell = new THREE.Mesh(mergeGeometries([outer.geometry(), ...course]), materials.reveal);
  shell.name = 'stair-drums';
  // The probe light inside is the open church's; a closed stair tower is much dimmer, so its
  // stone is darkened to match (the lamps every half turn carry the eye up).
  const dimStone = materials.reveal.clone();
  dimStone.color.multiplyScalar(0.45);
  dimStone.onBeforeCompile = materials.reveal.onBeforeCompile;
  const innerMesh = new THREE.Mesh(mergeGeometries([inner.geometry(), steps.geometry(), ...newels.map((g) => g.toNonIndexed())]), dimStone);
  innerMesh.name = 'stair-inside';
  const ironMesh = new THREE.Mesh(mergeGeometries([...rails.map((g) => g.toNonIndexed()), ...slitList]), materials.iron);
  ironMesh.name = 'stair-iron';
  const endRails = new THREE.Mesh(mergeGeometries(railList.map((g) => g.toNonIndexed())), materials.iron);
  endRails.name = 'gallery-end-railings'; // hidden with the gallery railings (Settings)
  const tierMesh = new THREE.Mesh(mergeGeometries(tierList), materials.gallery);
  tierMesh.name = 'choir-tiers';
  const benchMesh = new THREE.Mesh(mergeGeometries(benchList), materials.wood);
  benchMesh.name = 'choir-benches';
  const lampMesh = new THREE.Mesh(mergeGeometries(lampList), materials.warmLamp);
  lampMesh.name = 'stair-lamps';
  // The inside of the stairs is left out of the light bake: closed in, it would bake nearly
  // black (the slits are only on the outside); the probe light and its lamps light it instead.
  innerMesh.userData.noBake = true;
  // Sealed inside the drums it needs no sun shadow, and it is drawn only near a drum (main.js).
  innerMesh.userData.noSunBlock = true;
  return { meshes: [shell, innerMesh, ironMesh, endRails, tierMesh, benchMesh, lampMesh], colliders: galleryColliders(), emissive: [lampMesh] };
}
