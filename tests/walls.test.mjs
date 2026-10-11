// Openings cut into a wall must not overlap or touch: overlapping holes break
// the wall's triangulation (slivers across windows, degenerate triangles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANELS, openingOutlines } from '../web/src/building/walls.js';

function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function overlap(p, q) {
  if (p.some((v) => inside(v, q)) || q.some((v) => inside(v, p))) return true;
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) if (segmentsCross(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length])) return true;
  return false;
}

test('no two openings on a wall overlap', () => {
  for (const panel of PANELS) {
    const holes = openingOutlines(panel);
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        assert.ok(!overlap(holes[i], holes[j]), `openings ${i} and ${j} overlap on ${panel.endWall || 'panel'} at ${panel.origin.x.toFixed(1)},${panel.origin.z.toFixed(1)}`);
      }
    }
  }
});

test('no two wall panels overlap in the same plane', () => {
  for (let i = 0; i < PANELS.length; i++) {
    for (let j = i + 1; j < PANELS.length; j++) {
      const a = PANELS[i];
      const b = PANELS[j];
      if (a.apse || b.apse || a.inward.dot(b.inward) < 0.99) continue;
      const planeA = a.origin.dot(a.inward);
      if (Math.abs(b.origin.dot(a.inward) - planeA) > 0.01) continue;
      const span = (p) => [p.origin.dot(a.along), p.origin.dot(a.along) + p.width * p.along.dot(a.along)].sort((x, y) => x - y);
      const [a0, a1] = span(a);
      const [b0, b1] = span(b);
      const heights = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      assert.ok(Math.min(a1, b1) - Math.max(a0, b0) < 0.01 || heights <= 0, `panels ${i} and ${j} overlap`);
    }
  }
});
