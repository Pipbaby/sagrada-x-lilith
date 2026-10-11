// Light transport for the basilica.
//
// 1. Sun through glass. From the sun's point of view we render (a) a depth map
//    of everything opaque and (b) a map of the stained glass: its
//    transmittance and depth. A surface point is lit if nothing opaque lies
//    between it and the sun; if a pane of glass does, the light is filtered by
//    that glass. Shadows and coloured patches are softened by the sun's real
//    angular size (0.53°): the further the patch falls from the window, the
//    softer it gets.
//
// 2. Bounce light. A reflective shadow map records every sunlit interior
//    surface (position, normal, reflected flux). Together with each window and
//    skylight as an area light, it is gathered into a volume of irradiance
//    probes, stored as ambient cubes. Surfaces sample the volume, so a floor
//    splashed with red light tints the column beside it, and the Nativity side
//    fills with blue while the Passion side glows orange.

import * as THREE from 'three';
import { BOUNDS, zoneAt } from '../building/plan.js';
import { solarPosition, sunDirection, skyLight } from './sun.js';

// ------------------------------------------------------------------ GLSL

const POISSON = `const vec2 POISSON[16] = vec2[](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));`;

export const SUN_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform mat4 uSunMatrix;
uniform sampler2D uSunDepth;
uniform sampler2D uSunGlass;
uniform vec4 uSunParams;   // x: depth texel (uv), y: metres per depth texel, z: depth range (m), w: glass/depth resolution ratio
uniform float uFrame;
uniform int uDebug;        // 0 normal, 1 bounce only, 2 sun only, 3 sun ignoring glass colour
${POISSON}

// Fixed per pixel. It used to change every frame, which without temporal
// accumulation made shadow edges and light shafts shimmer.
float sunNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
// Noise fixed to the surface (≈3 cm cells), not the screen: a screen-space
// pattern slid across walls and floor as the camera moved and read as flicker.
float surfaceNoise(vec3 wp) {
  vec3 c = floor(wp * 32.0);
  return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

// Glass seen from the sun at one shadow-map position, for a receiver at depth zr.
vec3 glassAt(vec2 uv, float zr, float bias, ivec2 gsz) {
  if (uDebug == 3) return vec3(1.0);   // debug: opaque shadows only
  float gz = texelFetch(uSunGlass, ivec2(uv * vec2(gsz)), 0).a;
  if (zr <= gz + bias) return vec3(1.0);
  float blur = (zr - gz) * uSunParams.z * 0.0093 + 0.03;        // metres
  float lod = log2(max(1.0, blur / (uSunParams.y * uSunParams.w)));
  return textureLod(uSunGlass, uv, lod).rgb;
}

// Opaque visibility at one shadow-map position, bilinearly filtered over the
// four nearest texels so it varies smoothly instead of stepping per texel.
float visibilityAt(vec2 uv, float zr, float bias, vec2 size) {
  vec2 st = uv * size - 0.5;
  vec2 f = fract(st);
  ivec2 i0 = ivec2(floor(st));
  float v00 = step(zr - bias, texelFetch(uSunDepth, i0, 0).r);
  float v10 = step(zr - bias, texelFetch(uSunDepth, i0 + ivec2(1, 0), 0).r);
  float v01 = step(zr - bias, texelFetch(uSunDepth, i0 + ivec2(0, 1), 0).r);
  float v11 = step(zr - bias, texelFetch(uSunDepth, i0 + ivec2(1, 1), 0).r);
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

// Light reaching a point from the sun: black in shadow, glass colour through
// glass. Soft shadows from the sun's real size (0.53°), filtered on a fixed
// grid: no noise, so nothing shimmers or crawls as the camera moves. Each tap
// tests the opaque depth and the glass together, so a penumbra fades to the
// glass colour instead of fringing white.
vec3 sunTransmittance(vec3 wp, vec3 wn, float quality) {
  vec3 p0 = wp + wn * 0.05 + uSunDir * 0.03;
  vec4 lp = uSunMatrix * vec4(p0, 1.0);
  vec3 s = lp.xyz * 0.5 + 0.5;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return vec3(1.0);
  float zr = s.z;
  float bias = 0.00003;
  vec2 size = vec2(textureSize(uSunDepth, 0));
  if (uDebug == 4) {   // debug: raw glass lookup at the centre (r,g,b of glass, or depth info)
    ivec2 gs = textureSize(uSunGlass, 0);
    return glassAt(s.xy, zr, bias, gs);
  }
  if (uDebug == 5) {   // debug: (glass depth, receiver depth, 0)
    ivec2 gs = textureSize(uSunGlass, 0);
    return vec3(texelFetch(uSunGlass, ivec2(s.xy * vec2(gs)), 0).a, zr, 0.0);
  }

  // blocker search on a fixed ring: how far behind the occluder are we?
  // wide enough to find the window edge for a receiver 30 m below it
  // (the sun's 0.53° then blurs the edge by ~28 cm)
  float searchR = 28.0 * uSunParams.x;
  float blockers = 0.0;
  float sum = 0.0;
  for (int i = 0; i < 16; i++) {
    float d = texture2D(uSunDepth, s.xy + POISSON[i] * searchR).r;
    if (d < zr - bias) { sum += d; blockers += 1.0; }
  }
  float radius = 0.0;
  if (blockers > 0.0) {
    float avg = sum / blockers;
    float penumbra = (zr - avg) * uSunParams.z * 0.0093;        // metres
    radius = clamp(penumbra / uSunParams.y, 1.5, 22.0) * uSunParams.x;
  }
  ivec2 gsz = textureSize(uSunGlass, 0);
  if (radius == 0.0) {
    // fully lit: no occluder nearby, only the glass matters
    return visibilityAt(s.xy, zr, bias, size) * glassAt(s.xy, zr, bias, gsz);
  }
  // 6×6 bilinear taps (4×4 on low quality): with fewer, wide penumbrae showed
  // the gaps between taps as stripes along the edges of sun patches.
  int n = quality > 0.5 ? 6 : 4;
  vec3 T = vec3(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 6; j++) {
    if (j >= n) break;
    for (int i = 0; i < 6; i++) {
      if (i >= n) break;
      vec2 o = (vec2(i, j) + 0.5) / float(n) * 2.0 - 1.0;       // -1..1 grid
      float wgt = 1.0 - 0.5 * dot(o, o) / 2.0;                  // gentle falloff
      vec2 uv = s.xy + o * radius;
      float v = visibilityAt(uv, zr, bias, size);
      if (v > 0.0) T += wgt * v * glassAt(uv, zr, bias, gsz);
      wsum += wgt;
    }
  }
  return T / wsum;
}
`;

// Irradiance volume: ambient cube per probe, packed into a 2D atlas.
export const GI = { origin: [-30, 0.5, 0], spacing: [2.5, 4.0, 2.5], count: [25, 19, 37] };
const GI_W = GI.count[0] * GI.count[1];
const GI_H = GI.count[2] * 6;

export const GI_GLSL = /* glsl */ `
uniform sampler2D uGI;
uniform vec3 uGIOrigin;
uniform vec3 uGISpacing;
uniform vec3 uGICount;
uniform vec3 uAmbient;
uniform vec3 uElectric;   // floodlighting when daylight fails
uniform float uProbeScale; // matches probe light to the baked light when a bake is loaded

vec3 giFetch(vec3 g, float dir) {
  float W = uGICount.x * uGICount.y;
  float H = uGICount.z * 6.0;
  float y0 = floor(g.y);
  float fy = g.y - y0;
  float y1 = min(y0 + 1.0, uGICount.y - 1.0);
  float v = (dir * uGICount.z + g.z + 0.5) / H;
  vec3 a = texture2D(uGI, vec2((y0 * uGICount.x + g.x + 0.5) / W, v)).rgb;
  vec3 b = texture2D(uGI, vec2((y1 * uGICount.x + g.x + 0.5) / W, v)).rgb;
  return mix(a, b, fy);
}

vec3 giIrradiance(vec3 wp, vec3 n) {
  vec3 g = clamp((wp - uGIOrigin) / uGISpacing, vec3(0.0), uGICount - 1.0);
  vec3 n2 = n * n;
  vec3 e = n2.x * giFetch(g, n.x > 0.0 ? 0.0 : 1.0)
         + n2.y * giFetch(g, n.y > 0.0 ? 2.0 : 3.0)
         + n2.z * giFetch(g, n.z > 0.0 ? 4.0 : 5.0);
  return (e + uAmbient) * uProbeScale + uElectric;
}
`;

// ------------------------------------------------------------------ system

export class Lighting {
  constructor(renderer, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    const depthSize = quality === 'high' ? 4096 : 2048;
    const glassSize = quality === 'high' ? 2048 : 1024;

    this.depthTarget = new THREE.WebGLRenderTarget(depthSize, depthSize, { type: THREE.UnsignedByteType, depthBuffer: true });
    this.depthTarget.depthTexture = new THREE.DepthTexture(depthSize, depthSize, THREE.FloatType);
    this.glassTarget = new THREE.WebGLRenderTarget(glassSize, glassSize, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.sunCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10);
    this.depthMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });

    this.giTarget = new THREE.WebGLRenderTarget(GI_W, GI_H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.zoneTexture = makeZoneTexture();

    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSkyColor: { value: new THREE.Color() },
      uSunMatrix: { value: new THREE.Matrix4() },
      uSunDepth: { value: this.depthTarget.depthTexture },
      uSunGlass: { value: this.glassTarget.texture },
      uSunParams: { value: new THREE.Vector4() },
      uFrame: { value: 0 },
      uGI: { value: this.giTarget.texture },
      uGIOrigin: { value: new THREE.Vector3(...GI.origin) },
      uGISpacing: { value: new THREE.Vector3(...GI.spacing) },
      uGICount: { value: new THREE.Vector3(...GI.count) },
      uAmbient: { value: new THREE.Color(0.02, 0.02, 0.02) },
      uElectric: { value: new THREE.Color(0, 0, 0) },
      uRoom: { value: 1 }, // Terminal Dogma at night: the hall's own light fades (main.js)
      uZone: { value: this.zoneTexture },
      uBakeOn: { value: 0 },
      uBakeSat: { value: 0.5 },
      uProbeScale: { value: 1 },
      uBakeSkyNorm: { value: new THREE.Vector3(1, 1, 1) },
      uBakeSunNorm: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uBakeW: { value: new THREE.Vector3(0, 1, 0) },
      uDebug: { value: 0 },
      uReflect: { value: null },
      uReflectMatrix: { value: new THREE.Matrix4() },
      uReflectStrength: { value: 0 },
    };
    this.rsm = new ReflectiveShadowMap(this);
    this.gather = new ProbeGather(this);
    this.dirty = true;
    this.giPending = 0;
    this.sun = { elevation: 0, azimuth: 0 };
  }

  // Attach the basilica's light to a MeshStandardMaterial.
  // `key` names the shader variant: materials whose onBeforeCompile is the same
  // can share one program.
  patch(material, key = material.uuid) {
    const uniforms = this.uniforms;
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorldPos;
          attribute float bakeMask;
          attribute vec4 bakeSky; attribute vec4 bakeAm; attribute vec4 bakeNoon; attribute vec4 bakePm;
          uniform vec3 uBakeW; uniform vec3 uBakeSunNorm[3];
          varying float vBakeMask; varying vec3 vBakeSky; varying vec3 vBakeSun;
          vec3 rgbe(vec4 v) { return v.a < 0.5 ? vec3(0.0) : v.rgb * exp2(v.a - 136.0); }`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vBakeMask = bakeMask;
          vBakeSky = rgbe(bakeSky);
          // bounced sunlight per unit sun, blended between the baked sun positions
          vBakeSun = uBakeW.x * rgbe(bakeAm) * uBakeSunNorm[0] + uBakeW.y * rgbe(bakeNoon) * uBakeSunNorm[1] + uBakeW.z * rgbe(bakePm) * uBakeSunNorm[2];
          {
            vec4 lwp = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              lwp = instanceMatrix * lwp;
            #endif
            vWorldPos = (modelMatrix * lwp).xyz;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\nvarying float vBakeMask; varying vec3 vBakeSky; varying vec3 vBakeSun;\nuniform float uBakeOn; uniform vec3 uBakeSkyNorm; uniform float uBakeSat; uniform float uRoom;\n${SUN_GLSL}\n${GI_GLSL}`)
        .replace(
          '#include <lights_fragment_begin>',
          `#include <lights_fragment_begin>
          // a degenerate normal must never reach the lighting (NaN pixels)
          if (!(dot(geometryNormal, geometryNormal) > 1e-8)) geometryNormal = geometryViewDir;
          vec3 worldN = normalize(transpose(mat3(viewMatrix)) * geometryNormal);
          {
            vec3 sunT = sunTransmittance(vWorldPos, worldN, 1.0);
            if (dot(sunT, sunT) > 0.0) {
              IncidentLight sunLight;
              sunLight.direction = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
              sunLight.color = uSunColor * sunT;
              sunLight.visible = true;
              RE_Direct(sunLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
            }
          }`,
        )
        .replace(
          '#include <lights_fragment_maps>',
          `#include <lights_fragment_maps>
          if (uBakeOn > 0.5 && vBakeMask > 0.5) {
            // Cycles-baked light (irradiance / pi), rescaled to the current sky and sun
            vec3 baked = PI * (vBakeSky * uBakeSkyNorm * uSkyColor + vBakeSun * uSunColor);
            // per-vertex glass colour is purer than the real mixing of many panes
            baked = mix(vec3(dot(baked, vec3(0.2126, 0.7152, 0.0722))), baked, uBakeSat);
            irradiance += (baked + uElectric) * uRoom;
          } else {
            irradiance += giIrradiance(vWorldPos, worldN) * uRoom;
          }
          if (uDebug == 1) { reflectedLight.directDiffuse = vec3(0.0); reflectedLight.directSpecular = vec3(0.0); }
          if (uDebug == 2) { irradiance = vec3(0.0); }
          {
            // glossy approximation: the irradiance volume in the mirror direction
            vec3 worldV = normalize(vWorldPos - cameraPosition);
            vec3 R = reflect(worldV, worldN);
            radiance += giIrradiance(vWorldPos + R * 1.5, R) * RECIPROCAL_PI * uRoom;
          }`,
        );
    };
    // meshes without baked light read these constants (mask 0 -> probe lighting)
    material.defaultAttributeValues = { ...(material.defaultAttributeValues || {}), bakeMask: [0], bakeSky: [0, 0, 0, 0], bakeAm: [0, 0, 0, 0], bakeNoon: [0, 0, 0, 0], bakePm: [0, 0, 0, 0] };
    material.customProgramCacheKey = () => `basilica-${key}`;
    return material;
  }

  // Higher-order bounces. The gather gives one bounce of sunlight plus direct
  // daylight; in a pale stone interior (albedo ≈ 0.6) the rest of the
  // series adds roughly E·ρ/(1−ρ), spread evenly through the space.
  updateAmbient() {
    const t = this.giTarget;
    const buf = new Uint16Array(t.width * t.height * 4);
    this.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, buf);
    const half = THREE.DataUtils.fromHalfFloat;
    const [NX, NY, NZ] = GI.count;
    const sum = [0, 0, 0];
    let n = 0;
    for (let iz = 0; iz < NZ; iz++) {
      for (let iy = 0; iy < NY; iy++) {
        for (let ix = 0; ix < NX; ix++) {
          const x = GI.origin[0] + ix * GI.spacing[0];
          const y = GI.origin[1] + iy * GI.spacing[1];
          const z = GI.origin[2] + iz * GI.spacing[2];
          if (zoneAt(x, z) <= y + 1) continue;
          for (let d = 0; d < 6; d++) {
            const k = ((d * NZ + iz) * t.width + iy * NX + ix) * 4;
            sum[0] += half(buf[k]);
            sum[1] += half(buf[k + 1]);
            sum[2] += half(buf[k + 2]);
          }
          n += 6;
        }
      }
    }
    const f = ALBEDO / (1 - ALBEDO);
    // Higher bounces pick up the colour of the stone and gilt they bounce off
    // (warm), not the sky's blue: tint them by the interior's average albedo.
    const tint = [1.08, 1.0, 0.82];
    const next = new THREE.Color((sum[0] / n) * f * tint[0], (sum[1] / n) * f * tint[1], (sum[2] / n) * f * tint[2]);
    // while the day plays, the ambient eases towards the new value (see update); otherwise it is set
    if (this.continuous) this.ambientTarget = next;
    else {
      this.uniforms.uAmbient.value.copy(next);
      this.ambientTarget = null;
    }
    this.averageIrradiance = sum.map((v) => v / n);
    this.updateProbeScale();
  }

  // Blend the baked sun samples by the sun's horizontal direction: the two
  // samples either side of it, weighted by angle.
  updateBakeWeights() {
    if (!this.bakeSunDirs) return;
    const d = this.uniforms.uSunDir.value;
    const az = (v) => Math.atan2(v.x, v.z);
    const a = az(d);
    const diff = this.bakeSunDirs.map((v) => {
      const b = az(v);
      return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    });
    const order = diff.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const [[d0, i0], [d1, i1]] = order;
    const w = [0, 0, 0];
    const t = d0 + d1 > 1e-6 ? d0 / (d0 + d1) : 0;
    w[i0] = 1 - t;
    w[i1] = t;
    this.uniforms.uBakeW.value.set(w[0], w[1], w[2]);
  }

  // With a bake loaded, scale the probe light (used by pews, stands, covers)
  // so its average matches the baked light's average at this hour.
  updateProbeScale() {
    const b = this.bakeAverages;
    const avg = this.averageIrradiance;
    if (!b || !avg) return;
    const u = this.uniforms;
    const lum = (r, g, bl) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const w = u.uBakeW.value.toArray();
    const sky = u.uSkyColor.value;
    const sun = u.uSunColor.value;
    const sn = u.uBakeSkyNorm.value;
    const ch = (c) => {
      let v = b.sky[c] * [sn.x, sn.y, sn.z][c] * [sky.r, sky.g, sky.b][c];
      w.forEach((wk, k) => {
        const nk = u.uBakeSunNorm.value[k];
        v += wk * b.sun[k][c] * [nk.x, nk.y, nk.z][c] * [sun.r, sun.g, sun.b][c];
      });
      return Math.PI * v;
    };
    const baked = lum(ch(0), ch(1), ch(2));
    const amb = u.uAmbient.value;
    const probe = lum(avg[0] + amb.r, avg[1] + amb.g, avg[2] + amb.b);
    u.uProbeScale.value = probe > 1e-5 ? Math.min(1.5, Math.max(0.1, baked / probe)) : 1;
  }

  setTime(dayOfYear, hours, utcOffset) {
    const sun = solarPosition(dayOfYear, hours, utcOffset);
    if (Math.abs(sun.elevation - this.sun.elevation) < 1e-5 && Math.abs(sun.azimuth - this.sun.azimuth) < 1e-5) return;
    this.sun = sun;
    sunDirection(sun, this.uniforms.uSunDir.value);
    const { sun: sunColor, sky } = skyLight(sun.elevation);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSkyColor.value.copy(sky);
    // The basilica is floodlit (warm LED) when daylight fades.
    this.night = 1 - THREE.MathUtils.smoothstep(sun.elevation, -0.1, 0.12);
    this.uniforms.uElectric.value.setRGB(1.0, 0.82, 0.62).multiplyScalar(1.1 * this.night);
    this.updateBakeWeights();
    this.dirty = true;
  }

  fitSunCamera() {
    const dir = this.uniforms.uSunDir.value;
    const cam = this.sunCamera;
    const center = new THREE.Vector3(0, 30, 45);
    cam.position.copy(center).addScaledVector(dir, 300);
    cam.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? BOUNDS.max[0] : BOUNDS.min[0], i & 2 ? BOUNDS.max[1] : BOUNDS.min[1], i & 4 ? BOUNDS.max[2] : BOUNDS.min[2]).applyMatrix4(inv);
      min.min(p);
      max.max(p);
    }
    cam.left = min.x;
    cam.right = max.x;
    cam.bottom = min.y;
    cam.top = max.y;
    cam.near = -max.z - 1;
    cam.far = -min.z + 1;
    cam.updateProjectionMatrix();
    this.uniforms.uSunMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const size = this.depthTarget.width;
    const metresPerTexel = Math.max(cam.right - cam.left, cam.top - cam.bottom) / size;
    this.uniforms.uSunParams.value.set(1 / size, metresPerTexel, cam.far - cam.near, size / this.glassTarget.width);
  }

  // Re-render the sun maps and restart the bounce-light gather.
  renderSunMaps(scene) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    scene.background = null;
    this.fitSunCamera();

    // opaque depth
    this.sunCamera.layers.set(LAYERS.sunBlocker);
    scene.overrideMaterial = this.depthMaterial;
    r.setRenderTarget(this.depthTarget);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, this.sunCamera);
    scene.overrideMaterial = null;

    // glass transmittance + depth
    this.sunCamera.layers.set(LAYERS.glass);
    const swapped = [];
    scene.traverse((o) => {
      if (o.isMesh && o.userData.glass && o.userData.glassShadow) {
        swapped.push([o, o.material]);
        o.material = o.userData.glassShadow;
      }
    });
    r.setRenderTarget(this.glassTarget);
    r.setClearColor(0xffffff, 1);
    r.clear();
    r.render(scene, this.sunCamera);
    for (const [o, m] of swapped) o.material = m;

    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    this.sunCamera.layers.set(0);
  }

  update(scene, windows) {
    this.uniforms.uFrame.value = (this.uniforms.uFrame.value + 1) % 64;
    if (this.dirty && this.continuous) {
      // The day is playing: the sun maps follow every frame, so shadows and coloured light glide
      // as smoothly as when the time is dragged. The bounced light (soft, slow to change, and the
      // costly part) is gathered again four times a second and its ambient eases towards the new
      // value, so it never jumps.
      this.dirty = false;
      this.renderSunMaps(scene);
      const now = performance.now();
      if (!(now - this.bounceAt < 250)) {
        this.bounceAt = now;
        this.rsm.render(scene);
        this.gather.setLights(windows, this);
        this.giPending = 6;
      }
    } else if (this.dirty) {
      this.dirty = false;
      this.renderSunMaps(scene);
      this.rsm.render(scene);
      this.gather.setLights(windows, this);
      this.giPending = 6; // one cube direction per frame
    }
    if (this.giPending > 0) {
      this.gather.render(6 - this.giPending);
      this.giPending--;
      if (this.giPending === 0) this.updateAmbient();
    }
    if (this.ambientTarget) {
      const a = this.uniforms.uAmbient.value;
      a.lerp(this.ambientTarget, 0.12);
      this.updateProbeScale();
      if (Math.abs(a.r - this.ambientTarget.r) + Math.abs(a.g - this.ambientTarget.g) + Math.abs(a.b - this.ambientTarget.b) < 1e-5) this.ambientTarget = null;
    }
  }
}

export const LAYERS = { main: 0, sunBlocker: 1, glass: 2 };
const ALBEDO = 0.6;

// Zone heights on a 0.5 m grid (for inside/outside tests on the GPU).
function makeZoneTexture() {
  const step = 0.5;
  const nx = Math.round((BOUNDS.max[0] - BOUNDS.min[0]) / step);
  const nz = Math.round((BOUNDS.max[2] - BOUNDS.min[2]) / step);
  const data = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      data[j * nx + i] = zoneAt(BOUNDS.min[0] + (i + 0.5) * step, BOUNDS.min[2] + (j + 0.5) * step);
    }
  }
  const t = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export const ZONE_GLSL = /* glsl */ `
uniform sampler2D uZone;
float zoneHeight(vec2 xz) {
  vec2 uv = (xz - vec2(${BOUNDS.min[0].toFixed(1)}, ${BOUNDS.min[2].toFixed(1)})) / vec2(${(BOUNDS.max[0] - BOUNDS.min[0]).toFixed(1)}, ${(BOUNDS.max[2] - BOUNDS.min[2]).toFixed(1)});
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(uZone, uv).r;
}
`;

// ------------------------------------------------------------------ RSM

const RSM_SIZE = 256;
const VPL = 32; // RSM downsampled to VPL × VPL virtual point lights

class ReflectiveShadowMap {
  constructor(lighting) {
    this.lighting = lighting;
    this.target = new THREE.WebGLRenderTarget(RSM_SIZE, RSM_SIZE, { count: 3, type: THREE.FloatType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.small = new THREE.WebGLRenderTarget(VPL, VPL, { count: 3, type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.materials = new Map();
    this.downsample = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tFlux; uniform sampler2D tPos; uniform sampler2D tNrm;
      layout(location = 0) out vec4 oFlux;
      layout(location = 1) out vec4 oPos;
      layout(location = 2) out vec4 oNrm;
      void main() {
        ivec2 base = ivec2(gl_FragCoord.xy) * ${RSM_SIZE / VPL};
        vec3 flux = vec3(0.0); vec3 pos = vec3(0.0); vec3 nrm = vec3(0.0); float w = 0.0;
        for (int j = 0; j < ${RSM_SIZE / VPL}; j++) for (int i = 0; i < ${RSM_SIZE / VPL}; i++) {
          ivec2 c = base + ivec2(i, j);
          vec4 f = texelFetch(tFlux, c, 0);
          if (f.a <= 0.0) continue;
          float lum = dot(f.rgb, vec3(0.3, 0.6, 0.1)) + 1e-6;
          flux += f.rgb;
          pos += texelFetch(tPos, c, 0).xyz * lum;
          nrm += texelFetch(tNrm, c, 0).xyz * lum;
          w += lum;
        }
        oFlux = vec4(flux, w > 0.0 ? 1.0 : 0.0);
        oPos = vec4(w > 0.0 ? pos / w : vec3(0.0), 1.0);
        oNrm = vec4(w > 0.0 ? normalize(nrm) : vec3(0.0, 1.0, 0.0), 1.0);
      }`,
      { tFlux: { value: this.target.textures[0] }, tPos: { value: this.target.textures[1] }, tNrm: { value: this.target.textures[2] } },
    );
  }

  materialFor(albedo, side) {
    const key = `${albedo.getHexString()}-${side}`;
    if (!this.materials.has(key)) {
      const L = this.lighting;
      this.materials.set(
        key,
        new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          side,
          uniforms: { ...L.uniforms, uAlbedo: { value: albedo.clone() }, uTexelArea: { value: 1 } },
          vertexShader: /* glsl */ `
            out vec3 vW; out vec3 vN;
            void main() {
              vec4 p = vec4(position, 1.0);
              vec3 n = normal;
              #ifdef USE_INSTANCING
                p = instanceMatrix * p;
                n = mat3(instanceMatrix) * n;
              #endif
              vec4 w = modelMatrix * p;
              vW = w.xyz;
              vN = normalize(mat3(modelMatrix) * n);
              gl_Position = projectionMatrix * viewMatrix * w;
            }`,
          fragmentShader: /* glsl */ `
            precision highp float;
            in vec3 vW; in vec3 vN;
            uniform vec3 uAlbedo; uniform float uTexelArea;
            layout(location = 0) out vec4 oFlux;
            layout(location = 1) out vec4 oPos;
            layout(location = 2) out vec4 oNrm;
            ${SUN_GLSL}
            ${ZONE_GLSL}
            void main() {
              vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
              // only interior surfaces bounce light into the basilica
              vec3 probe = vW + n * 0.3;
              float zone = zoneHeight(probe.xz);
              if (zone <= 0.0 || probe.y > zone + 0.5) discard;
              vec3 T = sunTransmittance(vW, n, 0.0);
              float cosTheta = max(0.0, dot(n, uSunDir));
              if (cosTheta <= 0.0) discard;
              // flux over this texel's footprint (area perpendicular to the sun)
              oFlux = vec4(uSunColor * T * uAlbedo * uTexelArea, 1.0);
              oPos = vec4(vW, 1.0);
              oNrm = vec4(n, 1.0);
            }`,
        }),
      );
    }
    return this.materials.get(key);
  }

  render(scene) {
    const L = this.lighting;
    const r = L.renderer;
    const cam = L.sunCamera;
    const area = ((cam.right - cam.left) / RSM_SIZE) * ((cam.top - cam.bottom) / RSM_SIZE);
    const swapped = [];
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.layers.isEnabled(LAYERS.sunBlocker)) return;
      const src = o.material;
      if (!src || src.userData.glass) return;
      const albedo = src.userData.albedo || new THREE.Color(0.5, 0.5, 0.5);
      const m = this.materialFor(albedo, src.side);
      m.uniforms.uTexelArea.value = area;
      swapped.push([o, src]);
      o.material = m;
    });
    const prev = r.getRenderTarget();
    const bg = scene.background;
    scene.background = null;
    cam.layers.set(LAYERS.sunBlocker);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    cam.layers.set(0);
    for (const [o, m] of swapped) o.material = m;
    scene.background = bg;
    this.downsample.render(r, this.small);
    r.setRenderTarget(prev);
  }
}

// ------------------------------------------------------------------ probe gather

const MAX_LIGHTS = 1024;

class ProbeGather {
  constructor(lighting) {
    this.lighting = lighting;
    // area lights (windows, skylights): 3 texels each — position+area, normal, radiance
    this.lightData = new Float32Array(MAX_LIGHTS * 3 * 4);
    this.lightTexture = new THREE.DataTexture(this.lightData, 3, MAX_LIGHTS, THREE.RGBAFormat, THREE.FloatType);
    this.lightTexture.minFilter = this.lightTexture.magFilter = THREE.NearestFilter;
    this.count = 0;
    const rsm = lighting.rsm.small;
    this.pass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tFlux; uniform sampler2D tPos; uniform sampler2D tNrm;
      uniform sampler2D tLights; uniform int uLightCount; uniform int uDir;
      uniform vec3 uGIOrigin; uniform vec3 uGISpacing; uniform vec3 uGICount;
      layout(location = 0) out vec4 oColor;
      const vec3 DIRS[6] = vec3[](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
      void main() {
        ivec2 px = ivec2(gl_FragCoord.xy);
        int NX = int(uGICount.x);
        int NZ = int(uGICount.z);
        int dir = px.y / NZ;
        if (dir != uDir) discard;
        int ix = px.x % NX;
        int iy = px.x / NX;
        int iz = px.y % NZ;
        vec3 P = uGIOrigin + vec3(float(ix), float(iy), float(iz)) * uGISpacing;
        vec3 D = DIRS[dir];
        vec3 E = vec3(0.0);
        // one bounce of sunlight off every lit interior surface
        for (int j = 0; j < ${VPL}; j++) for (int i = 0; i < ${VPL}; i++) {
          vec4 f = texelFetch(tFlux, ivec2(i, j), 0);
          if (f.a <= 0.0) continue;
          vec3 X = texelFetch(tPos, ivec2(i, j), 0).xyz;
          vec3 N = texelFetch(tNrm, ivec2(i, j), 0).xyz;
          vec3 w = P - X;
          float r2 = dot(w, w);
          w *= inversesqrt(max(r2, 1e-4));
          float cosV = max(0.0, dot(N, w));
          float cosP = max(0.0, -dot(D, w));
          E += f.rgb * cosV * cosP / (3.14159265 * max(r2, 4.0));
        }
        // daylight through each window and skylight
        for (int k = 0; k < ${MAX_LIGHTS}; k++) {
          if (k >= uLightCount) break;
          vec4 a = texelFetch(tLights, ivec2(0, k), 0);
          vec3 n = texelFetch(tLights, ivec2(1, k), 0).xyz;
          vec3 L = texelFetch(tLights, ivec2(2, k), 0).rgb;
          vec3 w = P - a.xyz;
          float r2 = dot(w, w);
          w *= inversesqrt(max(r2, 1e-4));
          float cosW = max(0.0, dot(n, w));
          float cosP = max(0.0, -dot(D, w));
          E += L * a.w * cosW * cosP / max(r2, a.w + 1.0);
        }
        oColor = vec4(E, 1.0);
      }`,
      {
        tFlux: { value: rsm.textures[0] },
        tPos: { value: rsm.textures[1] },
        tNrm: { value: rsm.textures[2] },
        tLights: { value: this.lightTexture },
        uLightCount: { value: 0 },
        uDir: { value: 0 },
        uGIOrigin: lighting.uniforms.uGIOrigin,
        uGISpacing: lighting.uniforms.uGISpacing,
        uGICount: lighting.uniforms.uGICount,
      },
    );
  }

  // windows: [{position, normal, area, color}], plus skylights registered by main
  setLights(windows, lighting) {
    const sunDir = lighting.uniforms.uSunDir.value;
    const sun = lighting.uniforms.uSunColor.value;
    const sky = lighting.uniforms.uSkyColor.value;
    let n = 0;
    for (const w of windows) {
      if (n >= MAX_LIGHTS) break;
      const o = n * 12;
      const outward = -1;
      const cosSun = Math.max(0, outward * (w.normal.x * sunDir.x + w.normal.y * sunDir.y + w.normal.z * sunDir.z));
      const glow = w.skylight ? 0.7 : 0.8;
      const k = 1.0;
      this.lightData.set([w.position.x, w.position.y, w.position.z, w.area], o);
      this.lightData.set([w.normal.x, w.normal.y, w.normal.z, 0], o + 4);
      this.lightData.set(
        [
          k * w.color[0] * (sky.r * glow + sun.r * cosSun * 0.1),
          k * w.color[1] * (sky.g * glow + sun.g * cosSun * 0.1),
          k * w.color[2] * (sky.b * glow + sun.b * cosSun * 0.1),
          0,
        ],
        o + 8,
      );
      n++;
    }
    this.count = n;
    this.lightTexture.needsUpdate = true;
    this.pass.material.uniforms.uLightCount.value = n;
  }

  render(dir) {
    const r = this.lighting.renderer;
    this.pass.material.uniforms.uDir.value = dir;
    const target = this.lighting.giTarget;
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.pass.render(r, target, false);
    r.autoClear = autoClear;
  }
}

// ------------------------------------------------------------------ helpers

export function fullscreen(fragmentShader, uniforms) {
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    material,
    render(renderer, target, clear = true) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      if (clear) renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
    },
  };
}
