// The basilica as a place to walk: what the Walker needs to know about it.
import { zoneAt } from '../building/plan.js';
import { floorAt } from '../building/furnishings.js';
import { vaultAbove } from '../building/vaults.js';

export const basilicaEnv = {
  floorAt,
  // can a body of this radius stand here (walls only; obstacles are colliders)
  standable(x, z, radius) {
    for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      if (zoneAt(x + dx, z + dz) <= 0) return false;
    }
    // stay clear of the outer walls and window reveals
    return !(Math.abs(x) > 22.0 && z < 45);
  },
  // for the free camera: well inside the building
  inside: (x, z) => zoneAt(x, z) > 0 && zoneAt(x + 0.6, z) > 0 && zoneAt(x - 0.6, z) > 0 && zoneAt(x, z + 0.6) > 0 && zoneAt(x, z - 0.6) > 0,
  // highest the free camera may go here
  ceilingAt: (x, z) => (vaultAbove(x, z)?.height(x, z) ?? 30) - 0.8,
  minFlyY: () => 0.3,
};
