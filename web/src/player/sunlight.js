// Where is the sun shining right now, and through which glass?
//
// A CPU twin of the GPU sun maps, used to decide where to float an album cover
// so it sits in warm (Passion), cool (Nativity) or clear light. A ray from the
// point towards the sun leaves the building through exactly one wall panel; if
// the exit point falls inside one of that panel's windows, the point is lit by
// that window's glass — unless a column or gallery stands in the way.

import { PANELS } from '../building/walls.js';
import { columns, COLUMN_TYPES, GALLERIES, APSE_GALLERY, TRIFORIUM } from '../building/plan.js';

function insidePolygon(u, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, yi] = poly[i];
    const [uj, yj] = poly[j];
    if (yi > y !== yj > y && u < ((uj - ui) * (y - yi)) / (yj - yi) + ui) inside = !inside;
  }
  return inside;
}

function blockedByColumn(p, d, tMax) {
  for (const c of columns) {
    const T = COLUMN_TYPES[c.type];
    const r = T.diameter / 2;
    // closest approach of the ray to the column's vertical axis (in plan)
    const ox = p.x - c.x;
    const oz = p.z - c.z;
    const a = d.x * d.x + d.z * d.z;
    if (a < 1e-9) continue;
    const b = ox * d.x + oz * d.z;
    const cc = ox * ox + oz * oz - r * r;
    const disc = b * b - a * cc;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t > 0 && t < tMax && p.y + d.y * t < T.knot) return true;
  }
  return false;
}

function blockedByGallery(p, d, tMax) {
  for (const g of GALLERIES) {
    // slab from y 14.2 to 15.2: slab test
    let t0 = 0;
    let t1 = tMax;
    for (const [o, dir, lo, hi] of [
      [p.x, d.x, g.x0, g.x1],
      [p.y, d.y, 14.2, 16.2],
      [p.z, d.z, g.z0, g.z1],
    ]) {
      if (Math.abs(dir) < 1e-9) {
        if (o < lo || o > hi) t1 = -1;
        continue;
      }
      let a = (lo - o) / dir;
      let b = (hi - o) / dir;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
    if (t1 > t0) return true;
  }
  // apse half rings: where the ray crosses the slab's mid-height, is it over the ring?
  for (const ring of [APSE_GALLERY, TRIFORIUM]) {
    if (Math.abs(d.y) < 1e-9) continue;
    const t = (ring.y - 0.3 - p.y) / d.y;
    if (t <= 0 || t >= tMax) continue;
    const x = p.x + d.x * t - ring.cx;
    const z = p.z + d.z * t - ring.cz;
    const r = Math.hypot(x, z);
    if (z >= 0 && r >= ring.r0 && r <= ring.r1) return true;
  }
  return false;
}

// → null (shadow) or { facade, band, distance } for the glass the sun comes through.
export function sunlightAt(p, sunDir) {
  if (sunDir.y <= 0.02) return null;
  let best = null;
  let bestT = Infinity;
  for (const panel of PANELS) {
    const n = panel.inward;
    const denom = sunDir.x * n.x + sunDir.y * n.y + sunDir.z * n.z;
    if (denom >= -1e-6) continue; // must be heading out through this wall
    const t = ((panel.origin.x - p.x) * n.x + (panel.origin.z - p.z) * n.z) / denom;
    if (t <= 0 || t >= bestT) continue;
    const hx = p.x + sunDir.x * t;
    const hy = p.y + sunDir.y * t;
    const hz = p.z + sunDir.z * t;
    const u = (hx - panel.origin.x) * panel.along.x + (hz - panel.origin.z) * panel.along.z;
    if (u < -0.05 || u > panel.width + 0.05 || hy < panel.y0 - 0.5 || hy > panel.y1) continue;
    bestT = t;
    best = { panel, u, y: hy };
  }
  if (!best) return null; // leaves through the vault
  const win = best.panel.windows?.find((w) => insidePolygon(best.u, best.y, w.outline));
  if (!win) return null;
  if (blockedByColumn(p, sunDir, bestT) || blockedByGallery(p, sunDir, bestT)) return null;
  return { facade: win.facade, band: win.band, distance: bestT };
}

const WANT = {
  warm: (f) => f === 'passion' || f === 'apse',
  cool: (f) => f === 'nativity' || f === 'glory',
  clear: (f) => f === 'clear',
};

// Search the walkable floor for the spot nearest `from` where the requested
// light falls at cover height. Returns { x, z, facade } or null.
export function findLight(kind, sunDir, from, isFree) {
  const want = WANT[kind];
  let best = null;
  let bestScore = Infinity;
  for (let x = -21; x <= 21; x += 0.75) {
    for (let z = 1.5; z <= 72; z += 0.75) {
      if (!isFree(x, z)) continue;
      const hit = sunlightAt({ x, y: 1.6, z }, sunDir);
      if (!hit || !want(hit.facade)) continue;
      // prefer spots near the listener and fully inside the patch
      const score = Math.hypot(x - from.x, z - from.z);
      if (score < bestScore) {
        const ok = [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]].every(([dx, dz]) => {
          const h = sunlightAt({ x: x + dx, y: 1.6, z: z + dz }, sunDir);
          return h && want(h.facade);
        });
        if (!ok) continue;
        bestScore = score;
        best = { x, z, facade: hit.facade };
      }
    }
  }
  return best;
}
