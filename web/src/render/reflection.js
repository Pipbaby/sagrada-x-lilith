// Planar reflection for the polished floor (y = 0).
//
// A virtual camera mirrored below the floor renders the interior at half
// resolution into a mip-mapped target; the floor projects its fragments with
// that camera's matrix to look the reflection up, blurring with roughness.

import * as THREE from 'three';

export class FloorReflection {
  constructor(renderer, uniforms) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.virtual = new THREE.PerspectiveCamera();
    this.uniforms = uniforms;
    uniforms.uReflect.value = this.target.texture;
    this.enabled = true;
  }

  setSize(width, height) {
    this.target.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  }

  render(scene, camera, hide) {
    if (!this.enabled) {
      this.uniforms.uReflectStrength.value = 0;
      return;
    }
    this.uniforms.uReflectStrength.value = 1;
    const v = this.virtual;
    v.copy(camera);
    const p = camera.position;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    v.position.set(p.x, -p.y, p.z);
    v.up.set(up.x, -up.y, up.z);
    v.lookAt(p.x + dir.x, -p.y - dir.y, p.z + dir.z);
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.uniforms.uReflectMatrix.value.multiplyMatrices(v.projectionMatrix, v.matrixWorldInverse);

    const r = this.renderer;
    const prev = r.getRenderTarget();
    // hide, then restore each object's own visibility (others may have hidden it)
    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, v);
    hide.forEach((o, i) => (o.visible = was[i]));
    r.setRenderTarget(prev);
  }
}

// Injected into the floor material (see materials.js).
export const REFLECT_GLSL = /* glsl */ `
uniform sampler2D uReflect;
uniform mat4 uReflectMatrix;
uniform float uReflectStrength;
// rgb: reflected radiance; a: confidence (fades where it leaves the view)
vec4 floorReflection(vec3 wp, vec3 n, float roughness) {
  vec4 c = uReflectMatrix * vec4(wp, 1.0);
  // Floor right under the viewer can sit at or behind the mirrored camera:
  // dividing by w there gave NaN, which the bloom spread into black squares.
  if (c.w < 0.05) return vec4(0.0);
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  // the normal map ripples the reflection slightly
  uv += n.xz * 0.02;
  float lod = roughness * 7.0;
  vec3 r = textureLod(uReflect, clamp(uv, 0.001, 0.999), lod).rgb;
  float edge = smoothstep(0.0, 0.04, uv.x) * smoothstep(1.0, 0.96, uv.x) * smoothstep(0.0, 0.04, uv.y) * smoothstep(1.0, 0.96, uv.y);
  return vec4(r, edge);
}
`;
