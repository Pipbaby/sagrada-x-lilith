// Walls and windows.
//
// Because the tree columns carry the roof, Gaudí's walls carry no load and are
// opened up with many windows (booklet p.8). Wall panels here are generated
// wherever the vault height changes across the plan: outer walls (0 → 30 m),
// the clerestories between the side naves and the central nave (30 → 45 m),
// around the crossing (45 → 60 m) and the apse (to 75 m).
//
// Each window is a group: two tall lancets with parabolic heads, an oculus
// above them and two small round lights — set in deep, flared reveals so the
// sun has to thread through the thickness of the wall.

import * as THREE from 'three';
import { zoneAt, M, APSE, HEIGHTS } from './plan.js';
import { tileIndex, tileRect, averageGlassColor, VARIANTS } from './glass.js';

const OUTER_T = 1.4;
const INNER_T = 0.9;
const GLASS_DEPTH = 0.62; // fraction of the wall thickness

// ------------------------------------------------------------------ panels

function gridPanels() {
  const panels = [];
  // walls running along z (constant x)
  for (let i = 0; i <= 8; i++) {
    const x = -30 + i * M;
    for (let j = 0; j < 10; j++) {
      const zc = (j + 0.5) * M;
      const a = zoneAt(x - 0.05, zc);
      const b = zoneAt(x + 0.05, zc);
      if (a === b) continue;
      const inward = b > a ? 1 : -1; // towards the taller side
      panels.push({
        origin: new THREE.Vector3(x, 0, inward > 0 ? j * M + M : j * M),
        along: new THREE.Vector3(0, 0, inward > 0 ? -1 : 1),
        inward: new THREE.Vector3(inward, 0, 0),
        width: M,
        y0: Math.min(a, b),
        y1: Math.max(a, b),
      });
    }
  }
  // walls running along x (constant z)
  for (let j = 0; j <= 10; j++) {
    const z = j * M;
    for (let i = 0; i < 8; i++) {
      const xc = -30 + (i + 0.5) * M;
      const a = zoneAt(xc, z - 0.05);
      const b = zoneAt(xc, z + 0.05);
      if (a === b) continue;
      const inward = b > a ? 1 : -1;
      panels.push({
        origin: new THREE.Vector3(inward > 0 ? xc - M / 2 : xc + M / 2, 0, z),
        along: new THREE.Vector3(inward > 0 ? 1 : -1, 0, 0),
        inward: new THREE.Vector3(0, 0, inward),
        width: M,
        y0: Math.min(a, b),
        y1: Math.max(a, b),
      });
    }
  }
  return panels;
}

// The apse: seven facets around the ambulatory (one per chapel) and seven
// around the presbytery rising to the great apse vault.
function apsePanels() {
  const panels = [];
  for (const [radius, y0, y1] of [
    [APSE.outer, 0, HEIGHTS.side],
    [APSE.inner, HEIGHTS.side, HEIGHTS.apse],
  ]) {
    for (let k = 0; k < 7; k++) {
      const a0 = (Math.PI * k) / 7;
      const a1 = (Math.PI * (k + 1)) / 7;
      const p0 = new THREE.Vector3(APSE.cx + Math.cos(a0) * radius, 0, APSE.cz + Math.sin(a0) * radius);
      const p1 = new THREE.Vector3(APSE.cx + Math.cos(a1) * radius, 0, APSE.cz + Math.sin(a1) * radius);
      const along = p1.clone().sub(p0);
      const width = along.length();
      along.normalize();
      const mid = (a0 + a1) / 2;
      panels.push({
        origin: p0,
        along,
        inward: new THREE.Vector3(-Math.cos(mid), 0, -Math.sin(mid)),
        width,
        y0,
        y1,
        apse: true,
      });
    }
  }
  return panels;
}

// The two transept ends and the Glory (entrance) wall of the central nave are
// each one 15 m wall with their own composition, not two 7.5 m bays.
function mergeEndWalls(panels) {
  const endOf = (p) => {
    if (p.y0 !== 0 || p.y1 !== HEIGHTS.nave) return null;
    if (Math.abs(Math.abs(p.origin.x) - 4 * M) < 0.01 && Math.abs(p.inward.x) > 0.5) return p.origin.x < 0 ? 'nativity' : 'passion';
    if (Math.abs(p.origin.z) < 0.01 && p.inward.z > 0.5) return 'glory';
    return null;
  };
  const out = panels.filter((p) => !endOf(p));
  for (const kind of ['nativity', 'passion', 'glory']) {
    const parts = panels.filter((p) => endOf(p) === kind);
    if (!parts.length) continue;
    // order the pieces along the wall and join them into one panel
    const along = parts[0].along;
    parts.sort((a, b) => a.origin.dot(along) - b.origin.dot(along));
    out.push({ ...parts[0], width: parts.reduce((w, p) => w + p.width, 0), endWall: kind });
  }
  return out;
}

export const PANELS = [...mergeEndWalls(gridPanels()), ...apsePanels()];

// ------------------------------------------------------------------ window layout

function paletteFor(panel, slotTop) {
  const n = panel.inward;
  const midX = panel.origin.x + (panel.along.x * panel.width) / 2;
  if (panel.apse || (panel.y0 >= HEIGHTS.crossing && panel.y1 >= HEIGHTS.apse)) return 'apse';
  if (panel.y0 === HEIGHTS.side && panel.y1 === HEIGHTS.nave && Math.abs(midX) < M + 0.1) return 'clear';
  if (panel.y0 >= HEIGHTS.nave) return 'clear';
  if (n.z > 0.5 && panel.origin.z < 1) return slotTop > HEIGHTS.side ? 'clear' : 'glory';
  return midX < 0 ? 'nativity' : 'passion';
}

// Vertical slots for window groups on a panel of the given height range.
function slotsFor(panel) {
  const slots = [];
  const { y0, y1 } = panel;
  if (y0 === 0) {
    slots.push({ bottom: 3.2, top: 13.2, band: 0 });
    slots.push({ bottom: 16.8, top: 28.4, band: 1 });
    if (y1 > 40) slots.push({ bottom: 31.8, top: y1 - 1.8, band: 2 });
  } else {
    for (let b = y0 + 1.6; b + 9 < y1; b += 15) slots.push({ bottom: b, top: Math.min(y1 - 1.6, b + 12), band: 2 });
  }
  return slots;
}

let variantCounter = 0;
function windowGroup(panel, slot) {
  const facade = paletteFor(panel, slot.top);
  const band = facade === 'clear' ? 2 : slot.band;
  const W = panel.width;
  const cx = W / 2;
  const height = slot.top - slot.bottom;
  const lw = Math.min(1.3, W * 0.17);
  const oculus = Math.min(1.9, W * 0.26);
  const lancetTop = slot.top - oculus - 0.9; // clear of the oculus surround
  const v = variantCounter++;
  const lancet = (u) => ({
    kind: 'lancet',
    u,
    bottom: slot.bottom,
    top: lancetTop,
    w: lw,
    tile: tileIndex(facade, band, v),
    facade,
    band,
  });
  const group = [
    // half-spacing: the surround is 1.22× the glass plus a fixed 0.2 m rim,
    // so narrow walls need proportionally wider spacing
    lancet(cx - Math.max(lw * 0.9, lw * 0.61 + 0.27)),
    lancet(cx + Math.max(lw * 0.9, lw * 0.61 + 0.27)),
    { kind: 'round', u: cx, y: slot.top - oculus / 2 - 0.1, w: oculus, h: oculus, tile: tileIndex(facade, band, v + 1), facade, band },
  ];
  if (W > 5) {
    for (const s of [-1, 1]) {
      group.push({ kind: 'round', u: cx + s * lw * 2.2, y: slot.bottom + height * 0.72, w: 0.62, h: 0.9, tile: tileIndex(facade, band, v + 2), facade, band });
    }
  }
  return group;
}

// End walls, after the transept façades seen from inside: three tiers of two
// window groups (three pointed lancets with a roundel above each), under a
// great rose. Colours rise from red-orange through green to blue on the
// Nativity end, as in the installed glass; warm to gold on the Passion end.
const END_PALETTES = {
  nativity: { tiers: ['passion', 'glory', 'nativity'], rose: 'nativity' },
  passion: { tiers: ['passion', 'passion', 'apse'], rose: 'apse' },
  glory: { tiers: ['glory', 'glory', 'glory'], rose: 'glory' },
};
const TIERS = [
  [3.0, 11.8],
  [13.6, 22.4],
  [24.2, 33.3],
];
export const ROSE = { y: 39.3, r: 3.4, spokes: 16 };

// Glory (entrance) wall seen from inside: three bronze doors at the floor
// (furnishings.js), a roundel over each, the choir gallery across the wall at
// 15 m, and above it one large group of five pointed lancets rising to the
// centre, under the rose.
export const GLORY_DOORS = [
  { u: -4.6, w: 2.6, h: 5.6 },
  { u: 0, w: 3.4, h: 6.8 },
  { u: 4.6, w: 2.6, h: 5.6 },
];
function gloryComposition(panel) {
  const W = panel.width;
  const out = [];
  for (const d of GLORY_DOORS) {
    const v = variantCounter++;
    out.push({ kind: 'round', u: W / 2 + d.u, y: d.h + 2.6, w: 1.2, h: 1.2, tile: tileIndex('glory', 0, v), facade: 'glory', band: 0 });
  }
  for (let k = -2; k <= 2; k++) {
    const v = variantCounter++;
    const top = 33.2 - Math.abs(k) * 1.7;
    const w = k === 0 ? 1.7 : 1.45;
    out.push({ kind: 'lancet', pointed: true, u: W / 2 + k * 2.45, bottom: 17.9, top: top - 1.7, w, tile: tileIndex('glory', 1, v), facade: 'glory', band: 1 });
    out.push({ kind: 'round', u: W / 2 + k * 2.45, y: top - 0.4, w: 0.8, h: 0.8, tile: tileIndex('glory', 2, v + 1), facade: 'glory', band: 2 });
  }
  out.push({ kind: 'round', rose: true, u: W / 2, y: ROSE.y, w: ROSE.r * 2, h: ROSE.r * 2, tile: tileIndex('glory', 2, variantCounter++), facade: 'glory', band: 2 });
  return out;
}

function endComposition(panel) {
  if (panel.endWall === 'glory') return gloryComposition(panel);
  const pal = END_PALETTES[panel.endWall];
  const W = panel.width;
  const out = [];
  TIERS.forEach(([bottom, top], band) => {
    const facade = pal.tiers[band];
    for (const g of [-1, 1]) {
      const gc = W / 2 + g * 3.9;
      for (const k of [-1, 0, 1]) {
        const v = variantCounter++;
        // the enlarged surround of a pointed head rises ~0.45 m above the
        // glass apex; keep the roundel clear of it
        out.push({ kind: 'lancet', pointed: true, u: gc + k * 2.1, bottom, top: top - 1.7, w: 1.2, tile: tileIndex(facade, band, v), facade, band });
        out.push({ kind: 'round', u: gc + k * 2.1, y: top - 0.4, w: 0.7, h: 0.7, tile: tileIndex(facade, band, v + 1), facade, band });
      }
    }
  });
  out.push({ kind: 'round', rose: true, u: W / 2, y: ROSE.y, w: ROSE.r * 2, h: ROSE.r * 2, tile: tileIndex(pal.rose, 2, variantCounter++), facade: pal.rose, band: 2 });
  return out;
}

// Outline of an opening in panel coordinates (u along the wall, y up).
function outline(win, scale = 1, grow = 0) {
  const pts = [];
  if (win.kind === 'lancet' && win.pointed) {
    // equilateral pointed arch: two arcs struck from the opposite springers
    const hw = (win.w / 2) * scale + grow;
    const head = Math.sqrt(3) * hw;
    const bottom = win.bottom - grow;
    const spring = win.top - Math.sqrt(3) * (win.w / 2) - grow;
    const N = 12;
    pts.push(new THREE.Vector2(win.u - hw, bottom), new THREE.Vector2(win.u + hw, bottom));
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * (Math.PI / 3); // right springer up to the apex
      pts.push(new THREE.Vector2(win.u - hw + 2 * hw * Math.cos(a), spring + 2 * hw * Math.sin(a)));
    }
    for (let k = 1; k <= N; k++) {
      const a = (2 * Math.PI) / 3 + (k / N) * (Math.PI / 3); // apex down to the left springer
      pts.push(new THREE.Vector2(win.u + hw + 2 * hw * Math.cos(a), spring + 2 * hw * Math.sin(a)));
    }
    void head;
  } else if (win.kind === 'lancet') {
    const hw = (win.w / 2) * scale + grow;
    // Gaudí's openings here are round-headed, not pointed: a tall
    // semi-ellipse springing from vertical jambs.
    const head = win.w * 0.75 * scale + grow;
    const bottom = win.bottom - grow;
    const spring = win.top - head;
    const N = 24;
    pts.push(new THREE.Vector2(win.u - hw, bottom), new THREE.Vector2(win.u + hw, bottom));
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI; // right spring → apex → left spring
      pts.push(new THREE.Vector2(win.u + Math.cos(a) * hw, spring + Math.sin(a) * head));
    }
  } else {
    const N = 40;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      pts.push(new THREE.Vector2(win.u + Math.cos(a) * ((win.w / 2) * scale + grow), win.y + Math.sin(a) * ((win.h / 2) * scale + grow)));
    }
  }
  return pts;
}

// Resample a closed polyline to n points evenly spaced along its length.
function resample(points, n) {
  const closed = [...points, points[0]];
  const lengths = [0];
  for (let i = 1; i < closed.length; i++) lengths.push(lengths[i - 1] + closed[i].distanceTo(closed[i - 1]));
  const total = lengths[lengths.length - 1];
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / n) * total;
    while (lengths[seg + 1] < d) seg++;
    const t = (d - lengths[seg]) / (lengths[seg + 1] - lengths[seg]);
    out.push(closed[seg].clone().lerp(closed[seg + 1], t));
  }
  return out;
}

function serrate(points, depth) {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x / n;
    cy += p.y / n;
  }
  return points.map((p, i) => {
    if (i % 2 === 0) return p;
    const prev = points[(i + n - 1) % n];
    const next = points[(i + 1) % n];
    // outward normal of the local edge (pointing away from the centre)
    let nx = next.y - prev.y;
    let ny = -(next.x - prev.x);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (nx * (p.x - cx) + ny * (p.y - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return new THREE.Vector2(p.x + nx * depth, p.y + ny * depth);
  });
}

// ------------------------------------------------------------------ meshes

function toWorld(panel, u, y, depth, thickness, target = new THREE.Vector3()) {
  // depth 0 = inner face, 1 = outer face
  return target
    .copy(panel.origin)
    .addScaledVector(panel.along, u)
    .setY(y)
    .addScaledVector(panel.inward, -depth * thickness);
}

// A box laid in the wall plane: centre (u, y), size w × h, rotated by `angle`
// in the plane, spanning depth fractions d0…d1 of the wall thickness.
function panelBox(panel, thick, u, y, w, h, angle, d0, d1) {
  const g = new THREE.BoxGeometry(w, h, 1).toNonIndexed();
  const pos = g.getAttribute('position');
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const lz = pos.getZ(i) + 0.5; // 0…1
    toWorld(panel, u + lx * c - ly * s, y + lx * s + ly * c, d0 + (d1 - d0) * lz, thick, p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

// Rose window tracery: radiating stone spokes and an inner ring, standing
// just inside the glass.
function roseTracery(panel, thick, win) {
  const parts = [];
  const R = win.w / 2;
  const d0 = GLASS_DEPTH - 0.2;
  const d1 = GLASS_DEPTH - 0.01;
  const inner = R * 0.32;
  for (let k = 0; k < ROSE.spokes; k++) {
    const a = (k / ROSE.spokes) * Math.PI * 2;
    const r = (inner + R) / 2;
    parts.push(panelBox(panel, thick, win.u + Math.cos(a) * r, win.y + Math.sin(a) * r, R - inner, 0.13, a, d0, d1));
  }
  for (const [rr, n, t] of [[inner, 24, 0.16], [R * 0.66, 40, 0.1]]) {
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * Math.PI * 2;
      const len = (2 * Math.PI * rr) / n + 0.02;
      parts.push(panelBox(panel, thick, win.u + Math.cos(a) * rr, win.y + Math.sin(a) * rr, t, len, a, d0, d1));
    }
  }
  return parts;
}

export function buildWalls() {
  const wallGeoms = [];
  const revealPos = [];
  const glass = { lancet: [], round: [] };
  const tracery = [];
  const windows = []; // for the lighting system
  variantCounter = 0;

  PANELS.forEach((panel, panelIndex) => {
    panel.windows = [];
    const thick = panel.y0 === 0 ? OUTER_T : INNER_T;
    const yBottom = panel.y0 === 0 ? -0.2 : panel.y0 - 1.0;
    const yTop = panel.y1 + 0.8;
    // extend a little past the panel ends so corners close
    const u0 = -thick;
    const u1 = panel.width + thick;
    const shape = new THREE.Shape([
      new THREE.Vector2(u0, yBottom),
      new THREE.Vector2(u1, yBottom),
      new THREE.Vector2(u1, yTop),
      new THREE.Vector2(u0, yTop),
    ]);
    const openings = panel.endWall ? endComposition(panel) : slotsFor(panel).flatMap((slot) => windowGroup(panel, slot));
    for (const win of openings) {
      // The inner rim of each reveal is serrated, like the rims of the vault
      // hyperboloids: alternate points step outward to make a ring of teeth.
      const inner = serrate(resample(outline(win, 1.22, 0.1), 64), win.kind === 'lancet' ? 0.1 : 0.11); // lancet pairs are only 0.28 m apart
      shape.holes.push(new THREE.Path([...inner].reverse()));

      // flared reveal from the inner face to the glass
      const glassLine = resample(outline(win), 64);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const d = new THREE.Vector3();
      for (let k = 0; k < 64; k++) {
        const k2 = (k + 1) % 64;
        toWorld(panel, inner[k].x, inner[k].y, 0, thick, a);
        toWorld(panel, inner[k2].x, inner[k2].y, 0, thick, b);
        toWorld(panel, glassLine[k2].x, glassLine[k2].y, GLASS_DEPTH, thick, c);
        toWorld(panel, glassLine[k].x, glassLine[k].y, GLASS_DEPTH, thick, d);
        revealPos.push(a.x, a.y, a.z, d.x, d.y, d.z, b.x, b.y, b.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
      }

      // the glass itself
      const pts = outline(win);
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
      const minU = Math.min(...pts.map((p) => p.x));
      const maxU = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      const maxY = Math.max(...pts.map((p) => p.y));
      const rect = tileRect(win.kind, win.tile);
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      const world = new THREE.Vector3();
      const winData = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i);
        const y = pos.getY(i);
        uv.setXY(i, rect.u0 + ((u - minU) / (maxU - minU)) * (rect.u1 - rect.u0), rect.v0 + ((y - minY) / (maxY - minY)) * (rect.v1 - rect.v0));
        toWorld(panel, u, y, GLASS_DEPTH, thick, world);
        pos.setXYZ(i, world.x, world.y, world.z);
        winData[i * 2] = (y - minY) / (maxY - minY);
        winData[i * 2 + 1] = win.band;
      }
      g.setAttribute('glassInfo', new THREE.Float32BufferAttribute(winData, 2));
      g.deleteAttribute('normal');
      const n = panel.inward;
      const normals = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) normals.set([n.x, n.y, n.z], i * 3);
      g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      // winding: make the front face look into the building
      const idx = g.getIndex();
      const tri = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(k)));
      const faceN = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0]));
      if (faceN.dot(n) < 0) {
        const arr = idx.array;
        for (let i = 0; i < arr.length; i += 3) [arr[i + 1], arr[i + 2]] = [arr[i + 2], arr[i + 1]];
      }
      glass[win.kind].push(g);
      if (win.rose) tracery.push(...roseTracery(panel, thick, win));

      const area = win.kind === 'lancet' ? win.w * (win.top - win.bottom) * 0.92 : Math.PI * (win.w / 2) * (win.h / 2);
      // outline in panel coordinates, for sun-ray queries on the CPU
      panel.windows.push({ outline: pts.map((p) => [p.x, p.y]), facade: win.facade, band: win.band });
      windows.push({
        panel: panelIndex,
        position: toWorld(panel, (minU + maxU) / 2, (minY + maxY) / 2, 0, thick, new THREE.Vector3()),
        normal: panel.inward.clone(),
        area,
        color: averageGlassColor(win.facade, win.band),
        facade: win.facade,
      });
    }

    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
    // local (u, y, z) → world; local z runs outward
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const w = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      toWorld(panel, u, y, z / thick, thick, w);
      pos.setXYZ(i, w.x, w.y, w.z);
      uv.setXY(i, u + z, y); // metres, for world-scale masonry
    }
    // The (along, up, outward) basis is a reflection for some wall directions;
    // flip the triangles then so faces stay front-facing.
    const outward = panel.inward.clone().negate();
    const det = new THREE.Vector3().crossVectors(panel.along, new THREE.Vector3(0, 1, 0)).dot(outward);
    if (det < 0) {
      const idx = g.getIndex();
      if (idx) {
        const arr = idx.array;
        for (let i = 0; i < arr.length; i += 3) [arr[i + 1], arr[i + 2]] = [arr[i + 2], arr[i + 1]];
      } else {
        const p = pos.array;
        const t = uv.array;
        for (let i = 0; i < pos.count; i += 3) {
          for (let c = 0; c < 3; c++) [p[(i + 1) * 3 + c], p[(i + 2) * 3 + c]] = [p[(i + 2) * 3 + c], p[(i + 1) * 3 + c]];
          for (let c = 0; c < 2; c++) [t[(i + 1) * 2 + c], t[(i + 2) * 2 + c]] = [t[(i + 2) * 2 + c], t[(i + 1) * 2 + c]];
        }
      }
    }
    g.computeVertexNormals();
    wallGeoms.push(g);
  });

  const reveal = new THREE.BufferGeometry();
  reveal.setAttribute('position', new THREE.Float32BufferAttribute(revealPos, 3));
  const count = revealPos.length / 3;
  const ruv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    ruv[i * 2] = revealPos[i * 3] + revealPos[i * 3 + 2];
    ruv[i * 2 + 1] = revealPos[i * 3 + 1];
  }
  reveal.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
  reveal.computeVertexNormals();

  return { wallGeoms, reveal, glass, windows, tracery };
}

// Surround outlines (the holes cut in the wall) per panel, for tests.
export function openingOutlines(panel) {
  const openings = panel.endWall ? endComposition(panel) : slotsFor(panel).flatMap((slot) => windowGroup(panel, slot));
  return openings.map((win) => serrate(resample(outline(win, 1.22, 0.1), 64), win.kind === 'lancet' ? 0.1 : 0.11).map((p) => [p.x, p.y]));
}

export { VARIANTS };
