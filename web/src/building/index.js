// Assembles the interior: vaults, columns, walls, glass, floor and fittings.
// Returns meshes grouped by role so the renderer can treat them differently
// (glass casts coloured light, the shell blocks the sun, etc).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildVaults } from './vaults.js';
import { buildColumns } from './columns.js';
import { buildWalls } from './walls.js';
import { buildGlassAtlases } from './glass.js';
import { buildFurnishings } from './furnishings.js';
import { zoneAt } from './plan.js';

// Drop zero-area triangles (they arise where window outlines touch). Their
// normals come out zero, and normalising a zero vector on the GPU gives NaN:
// a single NaN pixel in the floor reflection spread into a black square.
function withoutDegenerates(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position');
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-12) keep.push(i);
  }
  if (keep.length * 3 === pos.count) return g;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const data = new Float32Array(keep.length * 3 * size);
    keep.forEach((i, t) => data.set(attr.array.subarray(i * size, (i + 3) * size), t * 3 * size));
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  return out;
}

// Keep only wall faces that look into the building. Outer faces are never
// seen, and the sun's depth pass renders both sides of what remains.
function interiorFaces(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.getAttribute('position');
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const cx = (a.x + b.x + c.x) / 3 + n.x * 0.4;
    const cy = (a.y + b.y + c.y) / 3 + n.y * 0.4;
    const cz = (a.z + b.z + c.z) / 3 + n.z * 0.4;
    const zone = zoneAt(cx, cz);
    if (zone > 0 && cy < zone + 1) keep.push(i);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const data = new Float32Array(keep.length * 3 * size);
    keep.forEach((i, t) => data.set(attr.array.subarray(i * size, (i + 3) * size), t * 3 * size));
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  return out;
}

// Split triangles until no edge is longer than `maxEdge` (longest-edge
// bisection, attributes interpolated). Baked light is stored per vertex, so big
// flat triangles (a wall face spans up to 47 m) need vertices to carry it.
// Deterministic: the bake and the runtime see identical vertices.
function refine(geometry, maxEdge) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const names = Object.keys(g.attributes);
  const src = names.map((n) => g.attributes[n]);
  const out = names.map(() => []);
  const pos = g.attributes.position.array;
  const tri = (verts) => {
    // verts: three arrays of per-attribute values
    const p = verts.map((v) => v[0]);
    const d = [0, 1, 2].map((k) => {
      const a = p[k];
      const b = p[(k + 1) % 3];
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    });
    const k = d.indexOf(Math.max(...d));
    if (d[k] <= maxEdge) {
      for (const v of verts) v.forEach((vals, ai) => out[ai].push(...vals));
      return;
    }
    const a = verts[k];
    const b = verts[(k + 1) % 3];
    const c = verts[(k + 2) % 3];
    const m = a.map((vals, ai) => {
      const mid = vals.map((x, j) => (x + b[ai][j]) / 2);
      if (names[ai] === 'normal') {
        const l = Math.hypot(...mid) || 1;
        return mid.map((x) => x / l);
      }
      return mid;
    });
    tri([a, m, c]);
    tri([m, b, c]);
  };
  for (let i = 0; i < pos.length / 3; i += 3) {
    tri([0, 1, 2].map((k) => src.map((attr) => Array.from(attr.array.subarray((i + k) * attr.itemSize, (i + k + 1) * attr.itemSize)))));
  }
  const r = new THREE.BufferGeometry();
  names.forEach((n, ai) => r.setAttribute(n, new THREE.Float32BufferAttribute(out[ai], src[ai].itemSize)));
  return r;
}

function longestEdge(geometry) {
  const p = geometry.getAttribute('position');
  const idx = geometry.index;
  const n = idx ? idx.count : p.count;
  let max = 0;
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const u = idx ? idx.getX(i + k) : i + k;
      const v = idx ? idx.getX(i + ((k + 1) % 3)) : i + ((k + 1) % 3);
      max = Math.max(max, Math.hypot(p.getX(u) - p.getX(v), p.getY(u) - p.getY(v), p.getZ(u) - p.getZ(v)));
    }
  }
  return max;
}

export const BAKE_MAX_EDGE = 1.5;

export function buildBasilica(materials) {
  const group = new THREE.Group();
  const glassMeshes = [];
  const emissive = [];
  const colliders = [];

  // vaults and skylight necks
  for (const { vault, geometry, necks } of buildVaults()) {
    const mesh = new THREE.Mesh(geometry, vault.finish === 0 ? materials.vaultConcrete : materials.vaultMosaic);
    mesh.name = `vault-${vault.name}`;
    group.add(mesh);
    const tubes = new THREE.Mesh(mergeGeometries(necks.tubes), materials.neck);
    group.add(tubes);
    const caps = new THREE.Mesh(mergeGeometries(necks.caps), materials.skylight);
    caps.userData.skylight = true;
    group.add(caps);
    emissive.push(caps);
    if (necks.lamps.length) {
      const lamps = new THREE.Mesh(mergeGeometries(necks.lamps), materials.vaultLamp);
      group.add(lamps);
      emissive.push(lamps);
      group.add(new THREE.Mesh(mergeGeometries(necks.rings), materials.gilt));
    }
  }

  // columns: instanced shafts and knots per stone
  const cols = buildColumns();
  // Columns are merged rather than instanced so each one can carry its own
  // baked light (a column by the window and one in the shade differ).
  const placed = (geometry, placements) => mergeGeometries(placements.map((p) => geometry.clone().translate(p.x, p.y, p.z)));
  for (const [type, { geometry, placements }] of Object.entries(cols.shafts)) {
    const mesh = new THREE.Mesh(placed(geometry, placements), materials.shaft[type]);
    mesh.name = `shaft-${type}`;
    group.add(mesh);
  }
  for (const [type, { geometry, placements }] of Object.entries(cols.knots)) {
    const mesh = new THREE.Mesh(placed(geometry, placements), materials.knot[type]);
    mesh.name = `knot-${type}`;
    group.add(mesh);
  }
  const branches = new THREE.Mesh(mergeGeometries(cols.branchParts), materials.branch);
  branches.name = 'branches';
  group.add(branches);
  if (cols.lampParts.length) {
    const lamps = new THREE.Mesh(mergeGeometries(cols.lampParts), materials.knotLamp);
    group.add(lamps);
    emissive.push(lamps);
  }
  colliders.push(...cols.colliders.map((c) => ({ type: 'circle', ...c })));

  // walls, reveals and glass
  const walls = buildWalls();
  const wallMesh = new THREE.Mesh(refine(interiorFaces(mergeGeometries(walls.wallGeoms.map(withoutDegenerates))), 2.0), materials.wall);
  wallMesh.name = 'walls';
  group.add(wallMesh);
  const reveal = new THREE.Mesh(withoutDegenerates(walls.reveal), materials.reveal);
  if (walls.tracery.length) group.add(new THREE.Mesh(mergeGeometries(walls.tracery), materials.reveal));
  group.add(reveal);
  const atlases = buildGlassAtlases();
  for (const kind of ['lancet', 'round']) {
    const mesh = new THREE.Mesh(mergeGeometries(walls.glass[kind]), materials.glass(atlases[kind]));
    mesh.name = `glass-${kind}`;
    mesh.userData.glass = true;
    glassMeshes.push(mesh);
    group.add(mesh);
  }

  // floor, galleries, pews, presbytery
  const furnishings = buildFurnishings(materials);
  group.add(furnishings.group);
  colliders.push(...furnishings.colliders);
  emissive.push(...furnishings.emissive);

  // Static lit surfaces receive baked light: refine coarse ones, and number
  // them in a fixed order so bake files map back by index.
  const bakeTargets = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.material?.isMeshStandardMaterial) return;
    if (o.userData.noBake) return; // added since the last bake: lit by the probes until the next one
    // the floor carries the pews' contact shadows: finer
    if (o.name === 'floor') o.geometry = refine(o.geometry, 0.6);
    else if (o !== wallMesh && longestEdge(o.geometry) > BAKE_MAX_EDGE + 0.5) o.geometry = refine(o.geometry, BAKE_MAX_EDGE);
    o.userData.bakeId = bakeTargets.length;
    bakeTargets.push(o);
  });

  return { group, glassMeshes, emissive, colliders, seats: furnishings.seats, baldachin: furnishings.baldachin, windows: walls.windows, atlases, bakeTargets };
}
