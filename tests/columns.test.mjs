// Column surfaces must face outward: the baker (Cycles) shades a vertex on the
// side its normal points to, so an inside-out limb bakes black.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColumns } from '../web/src/building/columns.js';

// share of vertices whose normal points away from the part's centroid
function outwardShare(g) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const c = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    c[0] += p.getX(i);
    c[1] += p.getY(i);
    c[2] += p.getZ(i);
  }
  c.forEach((v, k) => (c[k] = v / p.count));
  let out = 0;
  for (let i = 0; i < p.count; i++) {
    if (n.getX(i) * (p.getX(i) - c[0]) + n.getY(i) * (p.getY(i) - c[1]) + n.getZ(i) * (p.getZ(i) - c[2]) > 0) out++;
  }
  return out / p.count;
}

test('shafts, knots and branches face outward', () => {
  const { shafts, knots, branchParts } = buildColumns();
  const parts = [...Object.values(shafts).map((s) => s.geometry), ...Object.values(knots).map((k) => k.geometry), ...branchParts];
  assert.ok(parts.length > 10);
  for (const g of parts) assert.ok(outwardShare(g) > 0.9, `inside-out part (${outwardShare(g).toFixed(2)})`);
});
