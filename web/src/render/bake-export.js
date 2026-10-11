// Export the static building for the Cycles bake (tools/bake.py).
//
// Writes data/bake/in/geometry.bin + manifest.json + the two glass atlases.
// Every bake target is written in its runtime vertex order, in world space,
// so the baked values map back one-to-one. Instanced meshes (columns, pews,
// stands) are expanded and exported as occluders only; they keep the probe
// lighting at runtime. Glass carries its UVs so Blender filters sunlight
// through the same textures the renderer uses.

import * as THREE from 'three';

async function upload(file, body) {
  const r = await fetch(`/api/bake-upload?file=${encodeURIComponent(file)}`, { method: 'POST', body });
  if (!r.ok) throw new Error(`upload ${file}: ${r.status}`);
}

function canvasPng(texture) {
  const img = texture.image;
  return new Promise((resolve) => img.toBlob(resolve, 'image/png'));
}

export async function exportBake({ building, lighting, scene }) {
  scene.updateMatrixWorld(true);
  const chunks = [];
  let offset = 0;
  const push = (typed) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(bytes);
    const at = offset;
    offset += bytes.byteLength;
    return at;
  };

  const meshes = [];
  const add = (mesh, role, matrix, extra = {}) => {
    const g = mesh.geometry;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const pos = new Float32Array(p.count * 3);
    const nor = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      pos.set([v.x, v.y, v.z], i * 3);
      if (n) {
        v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
        nor.set([v.x, v.y, v.z], i * 3);
      }
    }
    const entry = {
      name: mesh.name || mesh.material?.type || 'mesh',
      role,
      vertexCount: p.count,
      positions: push(pos),
      normals: push(nor),
      ...extra,
    };
    if (g.index) {
      const idx = new Uint32Array(g.index.count);
      for (let i = 0; i < idx.length; i++) idx[i] = g.index.getX(i);
      entry.indexCount = idx.length;
      entry.index = push(idx);
    }
    if (role === 'glass') {
      const uv = g.getAttribute('uv');
      entry.uv = push(new Float32Array(uv.array));
    }
    meshes.push(entry);
  };

  for (const mesh of building.bakeTargets) {
    const m = mesh.material;
    add(mesh, 'target', mesh.matrixWorld, {
      bakeId: mesh.userData.bakeId,
      albedo: (m.userData.albedo || new THREE.Color(0.5, 0.5, 0.5)).toArray(),
      roughness: m.roughness ?? 0.8,
    });
  }
  // occluders: instanced meshes expanded instance by instance
  const im = new THREE.Matrix4();
  scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.visible) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, im);
      add(o, 'occluder', new THREE.Matrix4().multiplyMatrices(o.matrixWorld, im), {
        albedo: (o.material.userData.albedo || new THREE.Color(0.4, 0.4, 0.4)).toArray(),
      });
    }
  });
  for (const mesh of building.glassMeshes) add(mesh, 'glass', mesh.matrixWorld, { atlas: mesh.name.replace('glass-', '') });

  // lights to bake: sky, and the sun at three times on the equinox
  const samples = [];
  const keep = { ...lighting.sun };
  for (const [key, hour] of [['am', 9.5], ['noon', 13.7], ['pm', 17.5]]) {
    lighting.setTime(266, hour, 2);
    samples.push({ key, hour, day: 266, dir: lighting.uniforms.uSunDir.value.toArray(), color: lighting.uniforms.uSunColor.value.toArray() });
  }
  lighting.setTime(266, 13.7, 2);
  const sky = lighting.uniforms.uSkyColor.value.toArray();
  void keep;

  const blob = new Blob(chunks);
  await upload('geometry.bin', blob);
  for (const [kind, tex] of Object.entries(building.atlases)) await upload(`glass-${kind}.png`, await canvasPng(tex));
  const manifest = {
    version: 1,
    created: new Date().toISOString(),
    bytes: offset,
    targets: building.bakeTargets.length,
    targetVertices: building.bakeTargets.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0),
    sky,
    sun: samples,
    meshes,
  };
  await upload('manifest.json', JSON.stringify(manifest));
  return { meshes: meshes.length, bytes: offset, targetVertices: manifest.targetVertices };
}
