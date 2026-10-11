// Spiral stairs and the walkable galleries: a simulated walker climbs, walks the galleries and
// tries to leave them where it shouldn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.addEventListener ??= () => {};
globalThis.document ??= { addEventListener() {}, pointerLockElement: null, hidden: false };
const THREE = await import('three');
const { Walker } = await import('../web/src/player/controls.js');
const { basilicaEnv } = await import('../web/src/player/basilica-env.js');
const { galleryColliders, STAIRS, GALLERY_FLOOR } = await import('../web/src/building/stairs.js');
const { columns, COLUMN_TYPES } = await import('../web/src/building/plan.js');

const colliders = [...galleryColliders(), ...columns.map((c) => ({ type: 'circle', x: c.x, z: c.z, r: COLUMN_TYPES[c.type].diameter / 2 }))];
const DT = 1 / 60;

function walker() {
  return new Walker(new THREE.PerspectiveCamera(), { addEventListener() {} }, colliders, [], basilicaEnv);
}

// Walk towards (x, z) for at most maxT seconds; returns the time taken.
function walkTo(w, x, z, maxT = 30) {
  w.keys = new Set(['KeyW']);
  let t = 0;
  for (; t < maxT && Math.hypot(x - w.position.x, z - w.position.z) > 0.15; t += DT) {
    w.yaw = Math.atan2(x - w.position.x, z - w.position.z);
    w.update(DT);
  }
  w.keys = new Set();
  return t;
}

// Follow the stair's walking line round the newel, up (dir 1) or down (-1), to height y.
function climb(w, st, dir, y, maxT = 120) {
  w.keys = new Set(['KeyW']);
  let t = 0;
  for (; t < maxT; t += DT) {
    const p = w.position;
    if ((dir > 0 && p.y >= y - 1e-6) || (dir < 0 && p.y <= y + 1e-6)) break;
    const a = Math.atan2(p.z - st.z, p.x - st.x) + dir * 0.35;
    w.yaw = Math.atan2(st.x + 0.74 * Math.cos(a) - p.x, st.z + 0.74 * Math.sin(a) - p.z);
    w.update(DT);
  }
  w.keys = new Set();
  return t;
}

const outside = (st, r) => {
  const f = (st.face * Math.PI) / 180;
  return [st.x + r * Math.cos(f), st.z + r * Math.sin(f)];
};

for (const st of STAIRS) {
  test(`stair at (${st.x}, ${st.z}): in at the door, up at a stair's pace, out onto the gallery, back down`, () => {
    const w = walker();
    w.teleport(...outside(st, 3), 0, 0);
    walkTo(w, ...outside(st, 0.75), 10);
    assert.equal(w.position.y, 0);
    const up = climb(w, st, 1, GALLERY_FLOOR);
    assert.ok(Math.abs(w.position.y - GALLERY_FLOOR) < 1e-6, `reached ${w.position.y}`);
    assert.ok(up > 15 && up < 40, `climb took ${up.toFixed(1)} s`);
    walkTo(w, ...outside(st, 0.74), 10);
    // out through the opening (2.8 m: by the apse the arm's end railing is 2.9 m from the drum)
    walkTo(w, ...outside(st, 2.8), 10);
    assert.ok(Math.hypot(w.position.x - outside(st, 2.8)[0], w.position.z - outside(st, 2.8)[1]) < 0.2, 'out through the opening');
    assert.equal(w.position.y, GALLERY_FLOOR);
    walkTo(w, ...outside(st, 0.74), 10);
    climb(w, st, -1, 0);
    assert.equal(w.position.y, 0);
  });

  test(`stair at (${st.x}, ${st.z}): the drum is solid except at its door`, () => {
    const w = walker();
    const [bx, bz] = outside(st, -3); // behind the drum
    w.teleport(bx, bz, 0, 0);
    walkTo(w, st.x, st.z, 6);
    assert.ok(Math.hypot(w.position.x - st.x, w.position.z - st.z) > 1.5, 'stopped at the wall');
  });
}

test('the side gallery: stopped by the parapet and the end railing, tiers climbed by the aisle', () => {
  const w = walker();
  const st = STAIRS[0];
  w.teleport(...outside(st, 0.75), 0, 0);
  climb(w, st, 1, GALLERY_FLOOR);
  walkTo(w, ...outside(st, 0.74), 10);
  walkTo(w, -16, 6.5);
  walkTo(w, -10, 12, 8); // over the parapet into the nave
  assert.ok(w.position.x < -15.2, `x ${w.position.x}`);
  assert.equal(w.position.y, GALLERY_FLOOR);
  walkTo(w, -16, 44, 40);
  walkTo(w, -16, 50, 5); // off the end
  assert.ok(w.position.z < 45 - 0.25, `z ${w.position.z}`);
  walkTo(w, -17, 26.25);
  walkTo(w, -21.9, 26.25, 10); // up the aisle
  assert.ok(w.position.y > GALLERY_FLOOR + 1.5, `top tier ${w.position.y}`);
});

test('the Glory gallery and the apse gallery: no stepping off the front', () => {
  const w = walker();
  const st = STAIRS[0];
  w.teleport(...outside(st, 0.75), 0, 0);
  climb(w, st, 1, GALLERY_FLOOR);
  walkTo(w, ...outside(st, 0.74), 10);
  walkTo(w, -16, 5);
  walkTo(w, 0, 3);
  walkTo(w, 0, 10, 5);
  assert.ok(w.position.z < 6, `z ${w.position.z}`);
  assert.equal(w.position.y, GALLERY_FLOOR);

  const a = STAIRS[2];
  w.teleport(...outside(a, 0.75), 0, 0);
  climb(w, a, 1, GALLERY_FLOOR);
  walkTo(w, ...outside(a, 0.74), 10);
  walkTo(w, ...outside(a, 3.2), 10);
  walkTo(w, -5, 70, 8); // over the arm's parapet
  assert.ok(w.position.x < -8.1, `x ${w.position.x}`);
  walkTo(w, -11, 82);
  walkTo(w, 0, 86.5);
  walkTo(w, 0, 78, 5); // into the apse
  assert.ok(Math.hypot(w.position.x, w.position.z - 75) > 8.1, 'stayed on the ring');
  assert.equal(w.position.y, GALLERY_FLOOR);
});

test('down in the church the galleries and stairs change nothing', () => {
  const w = walker();
  w.teleport(-18, 20, 0, 0);
  walkTo(w, -18, 40, 15);
  assert.ok(w.position.z > 39.8);
  assert.equal(w.position.y, 0);
});
