// The basilica's plan, from the Junta Constructora's interior booklet (no. 9):
// everything is a multiple of the 7.5 m module. Central nave 15 m wide and
// 45 m high; two side naves either side, 7.5 m each and 30 m high; choir
// galleries at 15 m; crossing 60 m; apse 75 m; 90 m inside length.
//
// Axes: x across the nave, y up, z along the nave from the Glory façade
// (z = 0) to the apse (z = 90). Facing the apse (+z) your right hand points
// north-east, towards the Nativity façade, which is at negative x.

export const M = 7.5;

export const HEIGHTS = {
  gallery: 15,
  side: 30,
  nave: 45,
  crossing: 60,
  apse: 75,
};

// Apse: semicircle centred where the transept ends; presbytery inside the
// column ring (radius 7.5), ambulatory and the seven chapels beyond it.
export const APSE = { cx: 0, cz: 75, inner: M, outer: 2 * M, presbyteryHeight: 2 };

// Height of the vault over a plan point, or 0 outside the building.
export function zoneAt(x, z) {
  if (z < 0 || z > 90) return 0;
  const ax = Math.abs(x);
  if (z >= APSE.cz) {
    const d = Math.hypot(x - APSE.cx, z - APSE.cz);
    if (d < APSE.inner) return HEIGHTS.apse;
    if (d < APSE.outer) return HEIGHTS.side;
    return 0;
  }
  const j = Math.floor(z / M);
  if (j <= 5) return ax < M ? HEIGHTS.nave : ax < 3 * M ? HEIGHTS.side : 0; // nave
  if (ax >= 4 * M) return 0;
  if (j === 6) return ax < M ? HEIGHTS.nave : HEIGHTS.side; // transept side nave
  if (j === 7 || j === 8) return ax < M ? HEIGHTS.crossing : HEIGHTS.nave; // crossing, transept
  return ax < M ? HEIGHTS.apse : HEIGHTS.side; // j = 9: bay in front of the apse
}

// ------------------------------------------------------------------ columns
//
// Four stones, ranked by load (booklet p.6): sandstone on the side naves (6
// points), granite in the central nave (8), basalt around the crossing (10),
// red porphyry at the crossing (12). Double-twist rule: the first section is n
// metres tall and each following one half as tall, so the shaft reaches its
// knot at 2n metres (12/16/20/24 m; the 24 m porphyry matches published data).

export const COLUMN_TYPES = {
  sandstone: { points: 6, diameter: 1.05, knot: 12 },
  granite: { points: 8, diameter: 1.4, knot: 16 },
  basalt: { points: 10, diameter: 1.75, knot: 20 },
  porphyry: { points: 12, diameter: 2.1, knot: 24 },
};

export const columns = [];
const add = (type, x, z) => columns.push({ type, x, z });

for (const s of [-1, 1]) {
  for (let k = 1; k <= 5; k++) {
    add('granite', s * M, k * M); // central nave
    add('sandstone', s * 2 * M, k * M); // between the side naves
  }
  add('basalt', s * M, 6 * M); // crossing perimeter
  add('basalt', s * M, 10 * M);
  add('basalt', s * 2 * M, 7 * M);
  add('basalt', s * 2 * M, 9 * M);
  add('porphyry', s * M, 7 * M); // the four at the crossing
  add('porphyry', s * M, 9 * M);
  add('granite', s * 3 * M, 7 * M); // transepts
  add('granite', s * 3 * M, 9 * M);
  add('sandstone', s * 2 * M, 6 * M);
  add('sandstone', s * 3 * M, 6 * M);
  add('sandstone', s * 2 * M, 10 * M);
  add('sandstone', s * 3 * M, 10 * M);
}
for (let k = 1; k <= 5; k++) {
  // presbytery ring around the apse
  const a = Math.PI * (k / 6);
  add('granite', APSE.cx + Math.cos(a) * APSE.inner, APSE.cz + Math.sin(a) * APSE.inner);
}

// Choir galleries at 15 m over the outer side naves and along the Glory wall.
// The side galleries' fronts start where the Glory gallery's front crosses them.
export const GLORY_GALLERY_DEPTH = 6;
export const GALLERIES = [
  { x0: -3 * M, x1: -2 * M, z0: 0, z1: 6 * M, frontFrom: GLORY_GALLERY_DEPTH + 0.3 },
  { x0: 2 * M, x1: 3 * M, z0: 0, z1: 6 * M, frontFrom: GLORY_GALLERY_DEPTH + 0.3 },
  // over the Glory doors, across the central and inner side naves
  { axis: 'x', x0: -2 * M, x1: 2 * M, z0: 0, z1: GLORY_GALLERY_DEPTH, frontFrom: -2 * M + 0.3, frontTo: 2 * M - 0.3 },
  // the apse gallery's straight arms over the bay in front of the apse
  { x0: -2 * M + 0.2, x1: -8.4, z0: 9 * M, z1: 10 * M },
  { x0: 8.4, x1: 2 * M - 0.2, z0: 9 * M, z1: 10 * M },
];

// Around the apse: the children's choir gallery at 15 m over the ambulatory,
// a half ring from the presbytery columns to the chapel wall; and a narrow
// triforium walkway at 45 m on the inner apse wall (between its first and
// second tier of windows). Angles as in the plan: 0 = +x, π/2 = +z.
export const APSE_GALLERY = { cx: APSE.cx, cz: APSE.cz, r0: 8.4, r1: 2 * M - 0.2, y: 15 };
export const TRIFORIUM = { cx: APSE.cx, cz: APSE.cz, r0: 6.55, r1: 7.36, y: 45 };

// ------------------------------------------------------------------ light
//
// Stained glass programme (booklet p.8): Nativity side bluer (morning light),
// Passion side orange (evening); darkest low down, clearer higher up, clear
// glass at the very top of the central nave.

export function facadeOf(inwardX, inwardZ) {
  if (inwardX > 0.5) return 'nativity'; // wall at negative x
  if (inwardX < -0.5) return 'passion';
  if (inwardZ > 0.5) return 'glory';
  return 'apse';
}

// Real orientation: the nave runs from the Glory façade (south-east) to the
// apse (north-west). World-space (x, z) unit vectors for north and east.
export const COMPASS = { north: [-Math.SQRT1_2, Math.SQRT1_2], east: [-Math.SQRT1_2, -Math.SQRT1_2] };
export const LATITUDE = 41.4036;
export const LONGITUDE = 2.1744;

export const BOUNDS = { min: [-31, -1, -1], max: [31, 78, 91] };
