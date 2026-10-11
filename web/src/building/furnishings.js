// Floor, choir galleries, pews, presbytery, baldachin and organ.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GALLERIES, APSE, M, APSE_GALLERY, TRIFORIUM } from './plan.js';
import { GLORY_DOORS } from './walls.js';
import { buildStairs, STAIRS, STAIR_RADIUS } from './stairs.js';

// Presbytery: raised platform inside the column ring, reached by steps from
// the crossing. (The real one is 2 m up; the steps here are 0.2 m risers.)
const PLATFORM = 2.0;
const STEPS = { z0: 64.5, z1: 70.0, halfWidth: 6.5 };

export function floorAt(x, z) {
  const inRing = Math.hypot(x - APSE.cx, z - APSE.cz) < APSE.inner - 0.4 && z >= APSE.cz;
  const inBay = Math.abs(x) < M - 0.4 && z >= STEPS.z1 && z < APSE.cz;
  if (inRing || inBay) return PLATFORM;
  if (Math.abs(x) < STEPS.halfWidth && z >= STEPS.z0 && z < STEPS.z1) {
    const n = Math.floor(((z - STEPS.z0) / (STEPS.z1 - STEPS.z0)) * 10) + 1;
    return Math.min(PLATFORM, n * 0.2);
  }
  return 0;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// Railing heights: a four-line Gregorian staff under a handrail.
const STAFF = [16.3, 16.5, 16.7, 16.9];
const HANDRAIL = 17.15;

// Soffit ribs: the gallery undersides are ribbed, not flat — shallow ribs
// across the gallery every 0.9 m, deepest mid-span, and an edge beam.
// `place(s, back, h, piece)` makes one box: s along the gallery, `back` the
// distance from the front edge to the piece's centre, h its depth below the slab.
function soffitRibs(len, depth, place) {
  const ribs = [];
  for (let s = 0.55; s < len; s += 1.1) {
    for (let k = 0; k < 6; k++) {
      // each rib in six pieces that sag towards the middle of the span
      const mid = (k + 0.5) / 6;
      const h = 0.18 + 0.42 * Math.sin(Math.PI * mid);
      ribs.push(place(s, depth * mid, h, depth / 6 + 0.01, 0.2));
    }
  }
  // edge beam along the front
  ribs.push(place(len / 2, 0.12, 0.3, 0.24, len));
  return ribs;
}

// The spiral stair drums rise through the gallery slabs: keep slabs, ribs and lamps out of them.
const inStair = (x, z, margin = 0) => STAIRS.some((st) => Math.hypot(x - st.x, z - st.z) < STAIR_RADIUS + margin);
const clearOfStairs = (g) => {
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const r = Math.hypot(g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.z - g.boundingBox.min.z) / 2;
  return !inStair(c.x, c.z, Math.min(r, 0.6) + 0.05);
};

// A gallery slab from y 14.2 to 15.2 with round holes where stair drums pass through it (the
// holes' edges hide inside the drum walls).
function slabWithHoles(gal) {
  const holes = STAIRS.filter((st) => st.x > gal.x0 - STAIR_RADIUS && st.x < gal.x1 + STAIR_RADIUS && st.z > gal.z0 - STAIR_RADIUS && st.z < gal.z1 + STAIR_RADIUS);
  if (!holes.length) return box(gal.x1 - gal.x0, 1.0, gal.z1 - gal.z0, (gal.x0 + gal.x1) / 2, 14.7, (gal.z0 + gal.z1) / 2);
  // shape in (x, z); extruded 1 m, then turned so the shape's y is the world's z
  const shape = new THREE.Shape();
  shape.moveTo(gal.x0, gal.z0).lineTo(gal.x1, gal.z0).lineTo(gal.x1, gal.z1).lineTo(gal.x0, gal.z1).closePath();
  for (const st of holes) shape.holes.push(new THREE.Path().absarc(st.x, st.z, STAIR_RADIUS - 0.05, 0, Math.PI * 2, true));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false, curveSegments: 48 });
  g.rotateX(Math.PI / 2); // shape y -> world z, extrusion -> world -y
  g.translate(0, 15.2, 0);
  return g;
}

function galleryGeometry(gal) {
  const parts = [];
  // Galleries run along z (over the side naves) or along x (over the Glory
  // doors). `inner` is the edge facing the nave, `dir` points from it into the nave.
  const alongX = gal.axis === 'x';
  const inner = alongX ? gal.z1 : gal.x0 < 0 ? gal.x1 : gal.x0;
  const dir = alongX ? 1 : gal.x0 < 0 ? 1 : -1;
  const [s0, s1] = alongX ? [gal.x0, gal.x1] : [gal.z0, gal.z1];
  const toXZ = (s, off) => (alongX ? [s, inner + dir * off] : [inner + dir * off, s]);
  // slab
  parts.push(slabWithHoles(gal));
  const depth = alongX ? gal.z1 - gal.z0 : gal.x1 - gal.x0;
  const place = (s, back, h, piece, span = 0.12) => {
    const y = 14.2 - h / 2;
    return alongX ? box(span, h, piece, s0 + s, y, inner - dir * back) : box(piece, h, span, inner - dir * back, y, s0 + s);
  };
  parts.push(...soffitRibs(s1 - s0, depth, place).filter(clearOfStairs));
  // undulating parapet: a draped front that bellies out between the columns
  const pos = [];
  const N = 360;
  const from = gal.frontFrom ?? s0;
  const to = gal.frontTo ?? s1;
  for (let k = 0; k <= N; k++) {
    const s = from + ((to - from) * k) / N;
    const phase = (s / M) * Math.PI * 2;
    const [x, z] = toXZ(s, 0.3 + 0.22 * Math.sin(phase));
    // the lower edge hangs in narrow folds, like cloth over the columns
    const fold = Math.abs(Math.sin(phase * 6));
    const bottom = 13.35 - 0.35 * Math.pow(fold, 3) - 0.25 * Math.max(0, Math.sin(phase));
    const top = 15.95;
    pos.push([x, bottom, z], [x, top, z]);
  }
  const verts = [];
  for (let k = 0; k < N; k++) {
    const [a, b] = [pos[k * 2], pos[k * 2 + 1]];
    const [c, d] = [pos[k * 2 + 2], pos[k * 2 + 3]];
    verts.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const uv = [];
  for (let i = 0; i < verts.length; i += 3) uv.push(verts[i + (alongX ? 0 : 2)], verts[i + 1]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return { slab: mergeGeometries(parts.map((p) => p.toNonIndexed())), parapet: g, railing: staffRailing(pos, N) };
}

// Steel railing along the top of a parapet (pos: [bottom, top] pairs): the
// four lines of a Gregorian staff with square 'neumes' on them here and there,
// a handrail, and posts.
function staffRailing(pos, N) {
  const rails = [];
  const bar = (a, b, h, r) => {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const c = new THREE.CylinderGeometry(r, r, len, 5);
    c.rotateX(Math.PI / 2);
    c.rotateY(Math.atan2(b[0] - a[0], b[2] - a[2]));
    c.translate((a[0] + b[0]) / 2, h, (a[2] + b[2]) / 2);
    return c;
  };
  for (let k = 0; k < N; k += 2) {
    const a = pos[k * 2 + 1];
    const b = pos[Math.min(N, k + 2) * 2 + 1];
    for (const h of STAFF) rails.push(bar(a, b, h, 0.012));
    rails.push(bar(a, b, HANDRAIL, 0.025));
    // a note: a small square on a line or in a space, in a loose melody
    if (k % 6 === 0) {
      const step = Math.floor(Math.abs(Math.sin(k * 0.73)) * 7); // 0..6: lines and spaces
      const note = new THREE.BoxGeometry(0.07, 0.07, 0.07);
      note.rotateY(Math.atan2(b[0] - a[0], b[2] - a[2]));
      note.translate(a[0], STAFF[0] + step * 0.1, a[2]);
      rails.push(note);
    }
  }
  for (let k = 0; k <= N; k += 12) {
    const a = pos[k * 2 + 1];
    const h = HANDRAIL - 15.95;
    const post = new THREE.CylinderGeometry(0.02, 0.02, h, 5);
    post.translate(a[0], 15.95 + h / 2, a[2]);
    rails.push(post);
  }
  return mergeGeometries(rails);
}

// A half ring (angles 0..π around the apse centre) of the given radii and
// height, as a closed lathe section with capped ends.
function halfRing(ring, yBottom, yTop, segments = 96) {
  const { r0, r1, cx, cz } = ring;
  const profile = [
    // counter-clockwise in (r, y), so every face points out of the solid
    new THREE.Vector2(r0, yBottom),
    new THREE.Vector2(r1, yBottom),
    new THREE.Vector2(r1, yTop),
    new THREE.Vector2(r0, yTop),
    new THREE.Vector2(r0, yBottom),
  ];
  // Lathe: x = r sin φ, z = r cos φ; φ ∈ [-π/2, π/2] is the half with z ≥ 0
  const g = new THREE.LatheGeometry(profile, segments, -Math.PI / 2, Math.PI).toNonIndexed();
  g.translate(cx, 0, cz);
  const h = yTop - yBottom;
  const caps = [-1, 1].map((s) => box(r1 - r0, h, 0.12, cx + s * (r0 + r1) / 2, (yTop + yBottom) / 2, cz + 0.06).toNonIndexed());
  return mergeGeometries([g, ...caps]);
}

// Polar version of the draped parapet and staff railing: the front bellies
// out between the presbytery columns (one fold per 30°).
function ringParapet(ring, { bottom0, top, railHeights, bays = 6, setback = 0.3, belly = 0.22 }) {
  const pos = [];
  const N = 240;
  for (let k = 0; k <= N; k++) {
    const a = (Math.PI * k) / N;
    const phase = (a / Math.PI) * bays * Math.PI * 2;
    // like the nave galleries, the front stands proud of the slab edge
    const r = ring.r0 - setback - belly * Math.sin(phase);
    const fold = Math.abs(Math.sin(phase * 6));
    const bottom = bottom0 - 0.35 * Math.pow(fold, 3) - 0.25 * Math.max(0, Math.sin(phase));
    const x = ring.cx + Math.cos(a) * r;
    const z = ring.cz + Math.sin(a) * r;
    pos.push([x, bottom, z], [x, top, z]);
  }
  const verts = [];
  for (let k = 0; k < N; k++) {
    const [a, b] = [pos[k * 2], pos[k * 2 + 1]];
    const [c, d] = [pos[k * 2 + 2], pos[k * 2 + 3]];
    // faces point towards the apse centre
    verts.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const uv = [];
  for (let i = 0; i < verts.length; i += 3) uv.push(Math.atan2(verts[i + 2] - ring.cz, verts[i] - ring.cx) * ring.r0, verts[i + 1]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  if (railHeights === 'staff') return { parapet: g, railing: staffRailing(pos, N) };
  const rails = [];
  for (const h of railHeights) {
    for (let k = 0; k < N; k += 2) {
      const a = pos[k * 2 + 1];
      const b = pos[Math.min(N, k + 2) * 2 + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const c = new THREE.CylinderGeometry(0.018, 0.018, len, 5);
      c.rotateX(Math.PI / 2);
      c.rotateY(Math.atan2(b[0] - a[0], b[2] - a[2]));
      c.translate((a[0] + b[0]) / 2, h, (a[2] + b[2]) / 2);
      rails.push(c);
    }
  }
  const postH = railHeights[railHeights.length - 1] - top + 0.1;
  for (let k = 0; k <= N; k += 8) {
    const a = pos[k * 2 + 1];
    const post = new THREE.CylinderGeometry(0.02, 0.02, postH, 5);
    post.translate(a[0], top + postH / 2, a[2]);
    rails.push(post);
  }
  return { parapet: g, railing: mergeGeometries(rails) };
}

function apseGalleries() {
  const gal = APSE_GALLERY;
  const tri = TRIFORIUM;
  const slabs = [halfRing(gal, gal.y - 0.8, gal.y + 0.2), halfRing(tri, tri.y - 0.55, tri.y)];
  // radial soffit ribs under the apse gallery, as under the straight ones
  const rMid = (gal.r0 + gal.r1) / 2;
  const count = Math.round((Math.PI * rMid) / 1.1);
  const depth = gal.r1 - gal.r0;
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * (i + 0.5)) / count;
    for (let k = 0; k < 6; k++) {
      const mid = (k + 0.5) / 6;
      const h = 0.18 + 0.42 * Math.sin(Math.PI * mid);
      const r = gal.r0 + depth * mid;
      const rib = new THREE.BoxGeometry(depth / 6 + 0.01, h, 0.2);
      rib.rotateY(-a);
      rib.translate(gal.cx + Math.cos(a) * r, gal.y - 0.8 - h / 2, gal.cz + Math.sin(a) * r);
      slabs.push(rib.toNonIndexed());
    }
  }
  const g1 = ringParapet(gal, { bottom0: gal.y - 1.65, top: gal.y + 0.95, railHeights: 'staff' });
  // the triforium is a slim walkway: a shallow fascia and a light rail
  const g2 = ringParapet(tri, { bottom0: tri.y - 0.75, top: tri.y + 0.1, railHeights: [tri.y + 0.55, tri.y + 1.05], bays: 7, setback: 0.05, belly: 0.08 });
  const spots = [];
  for (let k = 0; k < 14; k++) {
    const a = (Math.PI * (k + 0.5)) / 14;
    const r = (gal.r0 + gal.r1) / 2;
    const d = new THREE.CircleGeometry(0.12, 16).rotateX(Math.PI / 2);
    d.translate(gal.cx + Math.cos(a) * r, gal.y - 1.04, gal.cz + Math.sin(a) * r);
    spots.push(d);
  }
  return { slabs, parapets: [g1.parapet, g2.parapet], railings: [g1.railing, g2.railing], spots };
}

// The Glory doors on the inner face of the entrance wall (z = 0): bronze
// leaves covered in raised lines of lettering (the Lord's Prayer), set in
// stepped stone frames.
function gloryDoors(materials) {
  const stone = [];
  const bronze = [];
  const letters = [];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const d of GLORY_DOORS) {
    // two stepped jambs and a lintel
    for (const [grow, depth] of [
      [0.55, 0.12],
      [0.28, 0.24],
    ]) {
      const w = d.w + 2 * grow;
      stone.push(box(grow, d.h + grow, depth, d.u - d.w / 2 - grow / 2, (d.h + grow) / 2, depth / 2));
      stone.push(box(grow, d.h + grow, depth, d.u + d.w / 2 + grow / 2, (d.h + grow) / 2, depth / 2));
      stone.push(box(w, grow, depth, d.u, d.h + grow / 2, depth / 2));
    }
    // two leaves, a seam between them
    for (const s of [-1, 1]) {
      const lw = d.w / 2 - 0.01;
      const cx = d.u + (s * d.w) / 4;
      bronze.push(box(lw, d.h, 0.06, cx, d.h / 2, 0.03));
      // raised lines of text, ragged at the right like a set page
      for (let y = 0.6; y < d.h - 0.35; y += 0.12) {
        let x = cx - lw / 2 + 0.12;
        const end = cx + lw / 2 - 0.12 - rand() * 0.3;
        while (x < end) {
          const word = Math.min(end - x, 0.04 + rand() * 0.14);
          letters.push(box(word, 0.045, 0.016, x + word / 2, y, 0.068));
          x += word + 0.04;
        }
      }
      // a heavier frame round each leaf
      bronze.push(box(lw, 0.08, 0.04, cx, d.h - 0.04, 0.08), box(lw, 0.08, 0.04, cx, 0.04, 0.08));
    }
  }
  // the letters stand proud and are polished bright by hands; the ground is dark
  const merged = (list) => mergeGeometries(list.map((g) => g.toNonIndexed()));
  return [
    new THREE.Mesh(merged(stone), materials.reveal),
    new THREE.Mesh(merged(bronze), materials.bronze),
    new THREE.Mesh(merged(letters), materials.gilt),
  ];
}

// The spiral staircases up to the galleries, the galleries' walking shape, the choir tiers and
// the railings at the galleries' open ends are in stairs.js.

function pews(materials) {
  // two blocks either side of the central aisle, iron-legged wooden benches
  const rows = [];
  for (let z = 5.5; z < 43; z += 1.15) rows.push(z);
  const blocks = [
    [-6.1, -1.5],
    [1.5, 6.1],
  ];
  const count = rows.length * blocks.length;
  const len = 4.6;
  // facing the altar (+z): seat, backrest behind it with a top rail
  const seat = mergeGeometries([box(len, 0.06, 0.4, 0, 0.46, 0), box(len, 0.34, 0.035, 0, 0.72, -0.2), box(len, 0.04, 0.12, 0, 0.91, -0.19)]);
  const iron = mergeGeometries([
    ...[-len / 2 + 0.15, 0, len / 2 - 0.15].flatMap((x) => [box(0.04, 0.9, 0.04, x, 0.45, -0.18), box(0.04, 0.46, 0.04, x, 0.23, 0.16), box(0.035, 0.035, 0.46, x, 0.1, 0)]),
  ]);
  const wood = new THREE.InstancedMesh(seat, materials.wood, count);
  const metal = new THREE.InstancedMesh(iron, materials.iron, count);
  const colliders = [];
  // places to sit: six per bench, each with the aisle ends to leave by
  const seats = [];
  let i = 0;
  for (const z of rows) {
    for (const [x0, x1] of blocks) {
      for (let k = 0; k < 6; k++) seats.push({ x: x0 + 0.38 + k * 0.77, z, seatY: 0.49, exits: [{ x: x0 - 0.45, z }, { x: x1 + 0.45, z }] });
      const m = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, 0, z);
      wood.setMatrixAt(i, m);
      metal.setMatrixAt(i, m);
      i++;
      colliders.push({ type: 'box', minX: x0, maxX: x1, minZ: z - 0.28, maxZ: z + 0.28, height: 0.95 });
    }
  }
  return { meshes: [wood, metal], colliders, seats };
}

function presbytery(materials) {
  const parts = [];
  // platform: half disc plus the bay in front, then ten steps
  const disc = new THREE.CylinderGeometry(APSE.inner - 0.4, APSE.inner - 0.4, PLATFORM, 64, 1, false, 0, Math.PI);
  disc.rotateY(Math.PI / 2);
  disc.translate(APSE.cx, PLATFORM / 2, APSE.cz);
  parts.push(disc);
  parts.push(box(2 * (M - 0.4), PLATFORM, APSE.cz - STEPS.z1, 0, PLATFORM / 2, (APSE.cz + STEPS.z1) / 2));
  for (let n = 1; n <= 10; n++) {
    const z0 = STEPS.z0 + ((STEPS.z1 - STEPS.z0) * (n - 1)) / 10;
    const h = n * 0.2;
    parts.push(box(STEPS.halfWidth * 2, h, STEPS.z1 - z0, 0, h / 2, (z0 + STEPS.z1) / 2));
  }
  const stone = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), materials.presbytery);

  // altar: a porphyry block 2.72 m long
  const altar = new THREE.Mesh(new THREE.BoxGeometry(2.72, 1.0, 1.1), materials.shaft.porphyry);
  altar.position.set(0, PLATFORM + 0.5, 76.2);
  altar.name = 'altar'; // Terminal Dogma takes it away, to clear the view of the cross
  return { meshes: [stone, altar], colliders: [{ type: 'box', name: 'altar', minX: -1.4, maxX: 1.4, minZ: 75.6, maxZ: 76.8, height: 3.1 }] };
}

// Heptagonal baldachin, 5 m across, hung over the altar; seven lamps on each
// side and one in the centre, glass grapes and a copper vine.
function baldachin(materials) {
  const group = new THREE.Group();
  const y = 11.5;
  const R = 2.5;
  const ring = [];
  const lamps = [];
  for (let k = 0; k < 7; k++) {
    const a0 = (k / 7) * Math.PI * 2;
    const a1 = ((k + 1) / 7) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * R, 0, Math.sin(a0) * R);
    const p1 = new THREE.Vector3(Math.cos(a1) * R, 0, Math.sin(a1) * R);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1);
    // parchment panel on each side
    const panel = new THREE.PlaneGeometry(len, 0.75);
    panel.rotateY(-Math.atan2(mid.z, mid.x) + Math.PI / 2);
    panel.translate(mid.x, 0.2, mid.z);
    ring.push(panel);
    for (let l = 0; l < 7; l++) {
      const p = p0.clone().lerp(p1, (l + 0.5) / 7);
      const s = new THREE.SphereGeometry(0.07, 10, 8);
      s.translate(p.x * 1.02, -0.35, p.z * 1.02);
      lamps.push(s);
    }
  }
  const centre = new THREE.SphereGeometry(0.12, 12, 10);
  centre.translate(0, -0.2, 0);
  lamps.push(centre);
  const panels = new THREE.Mesh(mergeGeometries(ring), materials.parchment);
  const lampMesh = new THREE.Mesh(mergeGeometries(lamps), materials.warmLamp);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(R, 0.05, 6, 7), materials.gilt);
  frame.rotation.x = Math.PI / 2;
  frame.position.y = 0.58;
  const frame2 = frame.clone();
  frame2.position.y = -0.18;
  // suspension cables
  const cables = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const c = new THREE.CylinderGeometry(0.008, 0.008, 30, 4);
    c.translate(Math.cos(a) * R * 0.98, 15.6, Math.sin(a) * R * 0.98);
    cables.push(c);
  }
  const cableMesh = new THREE.Mesh(mergeGeometries(cables), materials.iron);
  // the crucifix below the canopy
  const cross = new THREE.Mesh(mergeGeometries([box(0.12, 2.6, 0.1, 0, -2.0, 0), box(1.5, 0.12, 0.1, 0, -1.2, 0)]), materials.wood);
  group.add(panels, lampMesh, frame, frame2, cableMesh, cross);
  group.name = 'baldachin';
  group.position.set(0, y, 76.2);
  return { group, emissive: [lampMesh] };
}

// Organ: two banks of burnished pipes either side of the altar, in rows that
// rise towards the centre of each bank, standing on low oak cases.
function organ(materials) {
  const pipes = [];
  const cases = [];
  for (const side of [-1, 1]) {
    const cx = side * 3.6;
    for (let row = 0; row < 3; row++) {
      const count = 13 - row * 2;
      const z = 80.2 + row * 0.32;
      for (let k = 0; k < count; k++) {
        const t = count === 1 ? 0.5 : k / (count - 1);
        const x = cx + (t - 0.5) * (2.9 - row * 0.45);
        const h = (1.4 + 3.9 * Math.sin(Math.PI * t) ** 1.3) * (1 - row * 0.12) + row * 0.5;
        const r = 0.045 + 0.05 * Math.sin(Math.PI * t) * (1 - row * 0.2);
        const base = PLATFORM + 0.95;
        const body = new THREE.CylinderGeometry(r, r, h, 16, 1);
        body.translate(x, base + 0.25 + h / 2, z);
        pipes.push(body);
        const foot = new THREE.CylinderGeometry(r, r * 0.25, 0.25, 16, 1);
        foot.translate(x, base + 0.125, z);
        pipes.push(foot);
      }
    }
    cases.push(box(3.4, 0.95, 1.3, cx, PLATFORM + 0.475, 80.5));
  }
  const pipeMesh = new THREE.Mesh(mergeGeometries(pipes), materials.pipe);
  const caseMesh = new THREE.Mesh(mergeGeometries(cases), materials.wood);
  return [pipeMesh, caseMesh];
}

export function buildFurnishings(materials) {
  const group = new THREE.Group();
  const colliders = [];
  const emissive = [];

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 94).rotateX(-Math.PI / 2).translate(0, 0, 45), materials.floor);
  floor.name = 'floor';
  group.add(floor);

  const slabs = [];
  const parapets = [];
  const railings = [];
  for (const gal of GALLERIES) {
    const { slab, parapet, railing } = galleryGeometry(gal);
    slabs.push(slab);
    parapets.push(parapet);
    railings.push(railing);
  }
  const apse = apseGalleries();
  slabs.push(...apse.slabs);
  parapets.push(...apse.parapets);
  railings.push(...apse.railings);
  const railingMesh = new THREE.Mesh(mergeGeometries(railings), materials.iron);
  railingMesh.name = 'gallery-railings'; // can be hidden (Settings), for the view over the parapets
  group.add(railingMesh);
  group.add(new THREE.Mesh(mergeGeometries(slabs), materials.gallery));
  const parapetMesh = new THREE.Mesh(mergeGeometries(parapets), materials.parapet);
  group.add(parapetMesh);

  // downlights under the galleries
  const spots = [];
  for (const gal of GALLERIES) {
    const alongX = gal.axis === 'x';
    const [s0, s1] = alongX ? [gal.x0, gal.x1] : [gal.z0, gal.z1];
    for (let s = s0 + 1.9; s < s1; s += 3.75) {
      const d = new THREE.CircleGeometry(0.12, 16).rotateX(Math.PI / 2);
      // between two soffit ribs, below the rib line
      const y = 13.96;
      if (alongX) d.translate(s, y, (gal.z0 + gal.z1) / 2);
      else d.translate((gal.x0 + gal.x1) / 2, y, s);
      if (clearOfStairs(d)) spots.push(d);
    }
  }
  spots.push(...apse.spots);
  const spotMesh = new THREE.Mesh(mergeGeometries(spots), materials.downlight);
  group.add(spotMesh);
  emissive.push(spotMesh);

  group.add(...gloryDoors(materials));
  const stairs = buildStairs(materials);
  group.add(...stairs.meshes);
  colliders.push(...stairs.colliders);
  emissive.push(...stairs.emissive);

  const p = pews(materials);
  group.add(...p.meshes);
  colliders.push(...p.colliders);

  const pres = presbytery(materials);
  group.add(...pres.meshes);
  colliders.push(...pres.colliders);

  const b = baldachin(materials);
  group.add(b.group);
  emissive.push(...b.emissive);

  group.add(...organ(materials));
  colliders.push({ type: 'box', minX: -5.4, maxX: -1.8, minZ: 79.7, maxZ: 81.3, height: 8 });
  colliders.push({ type: 'box', minX: 1.8, maxX: 5.4, minZ: 79.7, maxZ: 81.3, height: 8 });

  return { group, colliders, emissive, seats: p.seats, baldachin: b.group };
}
