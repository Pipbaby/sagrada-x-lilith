// Baked bounce light (tools/bake.py) on the static building.
//
// Each bake target gets five vertex attributes: a mask and four RGBE-packed
// irradiance samples — sky (direct + bounced) and bounced sunlight for a
// morning, noon and afternoon sun. The shader (lighting.js) blends the sun
// samples by the sun's current direction and rescales everything by the
// current sun and sky colours, so the bake holds for any hour and season.
// If the bake does not match the geometry vertex for vertex, nothing is
// attached and the probe lighting is used as before.

import * as THREE from 'three';

export const BAKE_ATTRIBUTES = ['bakeMask', 'bakeSky', 'bakeAm', 'bakeNoon', 'bakePm'];

export async function attachBakedLight(building, lighting) {
  let manifest;
  try {
    const r = await fetch('/bake/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return { ok: false, reason: 'no bake' };
    manifest = await r.json();
  } catch {
    return { ok: false, reason: 'no bake' };
  }
  const targets = building.bakeTargets;
  const counts = targets.map((m) => m.geometry.getAttribute('position').count);
  if (manifest.targets.length !== counts.length || manifest.targets.some((n, i) => n !== counts[i])) {
    console.warn('Baked light does not match the current geometry; re-run the bake.');
    return { ok: false, reason: 'stale bake' };
  }
  const files = ['sky', ...manifest.sun.map((s) => `sun-${s.key}`)];
  const data = await Promise.all(files.map(async (f) => new Uint8Array(await (await fetch(`/bake/${f}.rgbe`)).arrayBuffer())));
  if (data.some((d) => d.length !== manifest.targetVertices * 4)) return { ok: false, reason: 'truncated bake' };

  // average of each pass over all baked vertices (for matching the probe light)
  const average = (d) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      if (!d[i + 3]) continue;
      const f = Math.pow(2, d[i + 3] - 136);
      sum[0] += d[i] * f;
      sum[1] += d[i + 1] * f;
      sum[2] += d[i + 2] * f;
      n++;
    }
    return sum.map((v) => v / Math.max(1, n));
  };
  lighting.bakeAverages = { sky: average(data[0]), sun: data.slice(1).map(average) };

  let offset = 0;
  for (const [i, mesh] of targets.entries()) {
    const n = counts[i];
    const g = mesh.geometry;
    g.setAttribute('bakeMask', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
    ['bakeSky', 'bakeAm', 'bakeNoon', 'bakePm'].forEach((name, k) => {
      g.setAttribute(name, new THREE.Uint8BufferAttribute(data[k].subarray(offset * 4, (offset + n) * 4), 4));
    });
    offset += n;
  }

  // Normalisers: per-unit sky and per-unit sun for each sample.
  const u = lighting.uniforms;
  u.uBakeSkyNorm.value.set(1 / manifest.sky[0], 1 / manifest.sky[1], 1 / manifest.sky[2]);
  manifest.sun.forEach((s, k) => u.uBakeSunNorm.value[k].set(1 / s.color[0], 1 / s.color[1], 1 / s.color[2]));
  lighting.bakeSunDirs = manifest.sun.map((s) => new THREE.Vector3(...s.dir));
  u.uBakeOn.value = 1;
  lighting.updateBakeWeights();
  lighting.updateProbeScale();
  return { ok: true, vertices: manifest.targetVertices, baked: manifest.baked, samples: manifest.samples };
}
