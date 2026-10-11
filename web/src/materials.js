// Surface materials. Photographic CC0 textures (Poly Haven) supply the grain;
// colour, pattern and finish are set to match the basilica: pale Montjuïc
// sandstone walls, granite / basalt / porphyry / sandstone columns, off-white
// concrete branches and side vaults, tiled and gilt central vaults, polished
// grey floor with a red rhombus band down the central aisle.
//
// Every lit material goes through `lighting.patch()`, which replaces three's
// light loop with the basilica's sun (through glass) and bounce light.

import * as THREE from 'three';
import { TOOTH_REACH } from './building/vaults.js';
import { REFLECT_GLSL } from './render/reflection.js';

const loader = new THREE.TextureLoader();
const cache = new Map();

// One download per image; each material gets its own Texture (for its own
// repeat) sharing the image, flagged for upload once the image has arrived.
function tex(name, kind, { srgb = kind === 'diff', repeat = 1 } = {}) {
  const key = `${name}_${kind}`;
  if (!cache.has(key)) {
    const entry = { loaded: false, copies: [] };
    entry.base = loader.load(`/assets/textures/${name}_${kind}.jpg`, () => {
      entry.loaded = true;
      for (const c of entry.copies) c.needsUpdate = true;
    });
    cache.set(key, entry);
  }
  const entry = cache.get(key);
  const t = entry.base.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  if (entry.loaded) t.needsUpdate = true;
  else entry.copies.push(t);
  return t;
}

// Mean linear luminance of each photo (measured offline), so the grain can be
// re-centred on a chosen albedo.
const TEXTURE_MEAN = {
  concrete_floor_01: 0.158,
  grey_plaster: 0.242,
  marble_01: 0.349,
  large_sandstone_blocks: 0.094,
  oak_veneer_01: 0.234,
  granite_tile_03: 0.108,
};

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b); // linear working space

// A stone surface: the photo supplies only grain (luminance variation around
// its mean) and relief; the colour is the stone's measured-looking albedo.
function stone(name, albedo, { roughness = 0.7, repeat = 0.5, normalScale = 0.6, contrast = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: albedo.clone(),
    map: tex(name, 'diff', { repeat }),
    normalMap: tex(name, 'nor', { repeat }),
    roughnessMap: tex(name, 'rough', { repeat }),
    roughness,
    metalness: 0,
  });
  m.normalScale.set(normalScale, normalScale);
  m.userData.albedo = albedo.clone();
  const mean = TEXTURE_MEAN[name] ?? 0.2;
  m.onBeforeCompile = chain(m.onBeforeCompile, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        float lum = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb *= clamp(1.0 + ${contrast.toFixed(2)} * (lum / ${mean.toFixed(3)} - 1.0), 0.25, 2.0);
      #endif`,
    );
  });
  return m;
}

// Kept for call sites: stone() already neutralises.
const neutralise = (m) => m;

export function chain(a, b) {
  return (shader, renderer) => {
    if (a) a(shader, renderer);
    b(shader, renderer);
  };
}

// ------------------------------------------------------------------ vaults

// Side-nave vaults: bare white concrete, with the ruled lines of the
// hyperboloid formwork faintly visible.
function vaultConcrete() {
  const m = stone('grey_plaster', lin(0.66, 0.65, 0.61), { roughness: 0.85, repeat: 0.25, contrast: 0.5 });
  m.side = THREE.FrontSide;
  m.flatShading = true;
  m.onBeforeCompile = chain(m.onBeforeCompile, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 vault;\nattribute vec4 neck;\nvarying vec4 vVault;\nvarying vec4 vNeck;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVault = vault;\nvNeck = neck;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vVault;\nvarying vec4 vNeck;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float t = vVault.x;
          float teeth = vNeck.z;
          float u = vVault.y * teeth + 0.5;
          float tri = 1.0 - abs(fract(u) * 2.0 - 1.0);
          float edge = 1.0 - ${TOOTH_REACH.toFixed(2)} * tri;
          float white = smoothstep(edge - 0.02, edge + 0.02, t);
          // formwork: the straight rulings of the hyperboloid, in two skew families
          float a = vVault.y * 6.2831853;
          float r1 = abs(fract(a * 22.0 + t * 3.0) - 0.5);
          float r2 = abs(fract(a * 22.0 - t * 3.0) - 0.5);
          float rule = smoothstep(0.0, 0.06, min(r1, r2));
          float boards = 0.5 + 0.5 * sin(t * 140.0);
          diffuseColor.rgb *= mix(0.9 + 0.1 * rule, 1.0, white) * (0.97 + 0.03 * boards);
          diffuseColor.rgb *= mix(0.82, 1.0, white * 0.6 + 0.4);
          // cavity shading: the funnel darkens steeply towards its neck (the light
          // comes down the skylight shaft and spreads over the rim, not into the hole)
          diffuseColor.rgb *= mix(0.16, 1.0, smoothstep(0.0, 0.55, t)) * mix(1.0, 1.12, white);
        }`,
      );
  });
  m.userData.albedo = new THREE.Color(0.62, 0.61, 0.58);
  return m;
}

// Central nave / crossing / apse: flat tiles laid along the generatrices, and
// triangles of green and gold Venetian glass between them near each neck;
// white serrated rims where the hyperboloids meet.
function vaultMosaic() {
  const m = stone('grey_plaster', lin(0.7, 0.68, 0.64), { roughness: 0.75, repeat: 0.25, contrast: 0.4 });
  m.onBeforeCompile = chain(m.onBeforeCompile, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 vault;\nattribute vec4 neck;\nvarying vec4 vVault;\nvarying vec4 vNeck;\nvarying vec2 vPlan;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVault = vault;\nvNeck = neck;\nvPlan = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vVault;\nvarying vec4 vNeck;\nvarying vec2 vPlan;\nfloat vaultGlint = 0.0;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float t = vVault.x;                 // 0 at the neck, 1 at the crease
          float teeth = vNeck.z;
          float kind = vNeck.w;               // 0 star, 1 medallion, 2 crossing, 3 apse
          float u = vVault.y * teeth + 0.5;   // tooth coordinate (matches the geometry)
          float tri = 1.0 - abs(fract(u) * 2.0 - 1.0);
          // white serrated triangles reach in from the crease between gilt points
          float edge = 1.0 - ${TOOTH_REACH.toFixed(2)} * tri;
          float white = smoothstep(edge - 0.012, edge + 0.012, t);
          // tiles laid along the generatrices: fine rays, alternately gilt
          float fine = vVault.y * teeth * 9.0 + t * 1.2;
          float ray = 1.0 - smoothstep(0.0, 0.18, abs(fract(fine) - 0.5) * 2.0 - 0.62);
          float giltRay = step(0.5, fract(floor(fine) * 0.5));
          // palm leaves: gold and green glass triangles pointing out along each gilt point
          float leafT = (t - 0.18) / max(0.05, edge - 0.18);
          float leaf = step(abs(fract(u) - 0.5) * 2.0, 1.0 - leafT) * step(0.0, leafT) * step(leafT, 1.0);
          float leafColour = step(0.5, fract(floor(u) * 0.5));
          vec3 gold = vec3(0.96, 0.62, 0.12);
          vec3 green = vec3(0.24, 0.46, 0.12);
          vec3 tile = vec3(0.95, 0.83, 0.60);
          float mosaic = kind > 0.5 ? 1.0 : 0.8;
          vec3 inner = tile;
          inner = mix(inner, gold, ray * giltRay * 0.85 * mosaic);
          inner = mix(inner, mix(gold, green, leafColour), leaf * 0.9 * mosaic * (1.0 - smoothstep(0.85, 1.0, leafT)));
          // sunburst ring around the neck
          if (kind < 2.5) inner = mix(inner, gold * 1.05, (1.0 - smoothstep(0.05, 0.16, t)) * 0.9);
          if (kind > 1.5 && kind < 2.5) {
            // crossing: a sunburst of gilt rays radiating from the central skylight
            float rays = smoothstep(0.35, 0.0, abs(fract(vVault.y * 48.0) - 0.5) * 2.0 - 0.3);
            inner = mix(inner, gold * 1.08, max(0.5 * (1.0 - smoothstep(0.2, 0.55, t)), rays * (1.0 - smoothstep(0.55, 0.9, t)) * 0.85));
          }
          float trinity = 0.0;
          if (vVault.w > 1.5) {
            // Apse (75 m): God the Creator in gold Venetian glass — an
            // equilateral triangle (the Trinity) interlaced with a circle (the
            // cosmos) around the great skylight. Drawn in plan metres over the
            // whole apse vault, because the central funnel is only a narrow
            // ring round its 2.8 m opening. Apex towards the apse end, so it
            // stands upright seen from the nave.
            vec2 q = vPlan - vec2(0.0, 75.5);
            q.y = -q.y;
            float tri = max(abs(q.x) * 0.866 + q.y * 0.5, -q.y) - 3.3; // inradius 3.3 m
            float triBand = 1.0 - smoothstep(0.16, 0.24, abs(tri));
            float ring = 1.0 - smoothstep(0.1, 0.17, abs(length(q) - 4.6));
            trinity = max(triBand, ring);
            // gilt rays stream out from the figure towards the walls
            float ang = atan(q.y, q.x) / 6.2831853;
            float fan = smoothstep(0.3, 0.0, abs(fract(ang * 42.0) - 0.5) * 2.0 - 0.5);
            float inside = 1.0 - smoothstep(-0.05, 0.05, tri);
            float d = length(q);
            inner = mix(inner, vec3(0.98, 0.95, 0.86), inside * 0.8);
            inner = mix(inner, gold * 1.1, fan * (1.0 - inside) * smoothstep(4.0, 5.0, d) * (1.0 - smoothstep(6.5, 7.4, d)) * 0.75);
            inner = mix(inner, gold * 1.3, trinity);
            trinity = max(trinity, fan * (1.0 - inside) * 0.5 * smoothstep(4.0, 5.0, d));
          }
          vec3 base = mix(inner, vec3(0.95, 0.94, 0.90), white * (1.0 - trinity));
          diffuseColor.rgb *= base;
          vaultGlint = max((1.0 - white) * max(ray * giltRay, leaf) * smoothstep(0.02, 0.1, t), trinity);
          // the shaft of the neck is in shadow
          // cavity shading: the funnel darkens steeply towards its neck (the light
          // comes down the skylight shaft and spreads over the rim, not into the hole;
          // the apse figure is lit by its ring of lamps, so it stays readable)
          float cavity = mix(0.16, 1.0, smoothstep(0.0, 0.55, t));
          if (vVault.w > 1.5) cavity = mix(cavity, 1.0, max(trinity, 0.45));
          diffuseColor.rgb *= cavity * mix(1.0, 1.12, white);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, vaultGlint);',
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, vaultGlint * 0.5);');
  });
  m.userData.albedo = new THREE.Color(0.66, 0.6, 0.5);
  return m;
}

// ------------------------------------------------------------------ floor

function floor() {
  const m = stone('marble_01', lin(0.72, 0.72, 0.7), { roughness: 0.3, repeat: 0.18, normalScale: 0.15, contrast: 1.2 });
  m.onBeforeCompile = chain(m.onBeforeCompile, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vFloorPos;\nfloat floorJoint = 0.0;\nfloat floorGlaze = 0.0;\nfloat floorMosaic = 0.0;\n${REFLECT_GLSL}
        float seg(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a, ba = b - a;
          return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `{
          // polished stone: mirror the interior, blurred by roughness
          vec4 fr = floorReflection(vWorldPos, worldN, material.roughness);
          radiance = mix(radiance, fr.rgb, fr.a * uReflectStrength);
        }
        #include <lights_fragment_end>`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = vFloorPos.xz;
          // large grey slabs laid diagonally, as in the nave
          vec2 d = vec2(p.x + p.y, p.x - p.y) * 0.70710678 / 1.25;
          vec2 f = abs(fract(d) - 0.5);
          floorJoint = 1.0 - smoothstep(0.485, 0.497, max(f.x, f.y));
          vec2 cell = floor(d);
          float tone = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          vec3 slab = mix(vec3(0.80, 0.80, 0.79), vec3(0.90, 0.90, 0.88), tone);
          // red rhombus band along the central aisle
          float along = mod(p.y + 1.6, 3.2) - 1.6;
          float rhombus = step(abs(p.x) / 1.15 + abs(along) / 1.6, 1.0) * step(p.y, 64.0) * step(0.0, p.y);
          vec3 red = vec3(0.47, 0.19, 0.17);
          vec3 col = mix(slab, red, rhombus);
          col *= 1.0 - 0.35 * (1.0 - floorJoint);
          // Crossing: Gaudí's JMJ monogram (Jesus, Maria, Josep) in trencadís,
          // after the medallion he made for the Sagrada Família schools roof.
          // One white ribbon makes five hanging bars — the J of Jesus, the
          // three bars of the M, the J of Josep — joined by arches at the altar
          // end; the last J turns along the nave side and ends in the gold
          // flower of Joseph's flowering rod. A gold crown band ties the M,
          // a small gold cross stands above it. Blue field, brass rim, set in
          // a square of maroon trencadís. Read upright from the nave:
          // 'right' is −x, 'up' (towards the altar) is +z. Radius 2 m.
          vec2 e = vec2(-p.x, p.y - 60.0) / 2.0;
          float re = length(e);
          float squareD = max(abs(e.x), abs(e.y));
          float inMed = 1.0 - step(1.22, squareD);
          // screen-space footprint, taken outside the branch (derivatives need uniform flow)
          float px = length(fwidth(e)) + 1e-5;
          if (inMed > 0.5) {
            // --- the white ribbon (distance to its centre line, half width 0.1)
            float rib = 1e3;
            rib = min(rib, seg(e, vec2(-0.66, 0.5), vec2(-0.66, -0.22)));   // J of Jesus
            rib = min(rib, seg(e, vec2(-0.33, 0.5), vec2(-0.33, -0.15)));   // M
            rib = min(rib, seg(e, vec2(0.0, 0.5), vec2(0.0, -0.15)));
            rib = min(rib, seg(e, vec2(0.33, 0.5), vec2(0.33, -0.15)));
            rib = min(rib, seg(e, vec2(0.66, 0.5), vec2(0.66, -0.25)));     // J of Josep
            for (int k = 0; k < 4; k++) {                                   // arches
              vec2 c = vec2(-0.495 + 0.33 * float(k), 0.5);
              if (e.y >= 0.5) rib = min(rib, abs(length(e - c) - 0.165));
            }
            vec2 cc = vec2(0.46, -0.25);                                    // turn into the tail
            if (e.x >= cc.x && e.y <= cc.y) rib = min(rib, abs(length(e - cc) - 0.2));
            rib = min(rib, seg(e, vec2(0.46, -0.45), vec2(-0.42, -0.45)));  // tail
            float white = rib - 0.1;
            // --- gold: crown band, cross, flower
            float band = max(abs(e.x) - 0.43, abs(e.y - 0.3) - 0.07);
            float cross = min(max(abs(e.x) - 0.022, abs(e.y - 0.865) - 0.085), max(abs(e.x) - 0.065, abs(e.y - 0.89) - 0.022));
            vec2 fc = vec2(-0.36, -0.45);
            float flower = length(e - fc) - 0.06;
            for (int k = 0; k < 3; k++) {
              float a = radians(180.0 + 62.0 * float(k - 1));
              vec2 dir = vec2(cos(a), sin(a));
              vec2 pe = e - fc;
              // a petal: a drop that swells then closes to a point
              float t = clamp(dot(pe, dir) / 0.23, 0.0, 1.0);
              float w = 0.06 * sin(3.14159 * pow(t, 0.6));
              flower = min(flower, length(pe - dir * t * 0.23) - w);
            }
            flower = min(flower, max(abs(e.x - (fc.x + 0.08)) - 0.022, abs(e.y - fc.y) - 0.12)); // the collar
            float gold = min(band, min(cross, flower));
            // --- broken-tile pieces, ~12 cm, with their grout
            vec2 vx = e * 16.0;
            vec2 vn = floor(vx), vf = fract(vx);
            vec2 mg = vec2(0.0), mr = vec2(0.0);
            float md = 8.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = fract(sin(vec2(dot(vn + g, vec2(127.1, 311.7)), dot(vn + g, vec2(269.5, 183.3)))) * 43758.5453);
              vec2 r = g + o - vf;
              float d2 = dot(r, r);
              if (d2 < md) { md = d2; mr = r; mg = g; }
            }
            md = 8.0;
            for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
              vec2 g = mg + vec2(float(i), float(j));
              vec2 o = fract(sin(vec2(dot(vn + g, vec2(127.1, 311.7)), dot(vn + g, vec2(269.5, 183.3)))) * 43758.5453);
              vec2 r = g + o - vf;
              if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
            }
            float piece = fract(sin(dot(vn + mg, vec2(41.3, 289.1))) * 15731.7);
            float aa = px * 16.0;
            float grout = 1.0 - smoothstep(0.035, 0.035 + aa, md);
            // the pieces are cut along the figure's outlines: grout there too
            float ea = px;
            grout = max(grout, 1.0 - smoothstep(0.0025, 0.0025 + ea, abs(white)));
            grout = max(grout, 1.0 - smoothstep(0.0025, 0.0025 + ea, abs(gold)));
            // --- colours (sRGB), per piece
            vec3 navy = vec3(0.10, 0.18, 0.45), mid = vec3(0.22, 0.38, 0.72), light = vec3(0.50, 0.64, 0.86), teal = vec3(0.28, 0.58, 0.72), pale = vec3(0.74, 0.82, 0.90);
            vec3 blue = piece < 0.18 ? navy : piece < 0.5 ? mid : piece < 0.7 ? light : piece < 0.88 ? teal : pale;
            vec3 tile = blue;
            vec3 groutCol = vec3(0.62, 0.62, 0.6);
            if (white < 0.0) tile = mix(vec3(0.86, 0.86, 0.83), vec3(0.95, 0.94, 0.9), piece);
            if (gold < 0.0) {
              tile = mix(vec3(0.80, 0.56, 0.16), vec3(0.90, 0.68, 0.24), piece);
              // pale diamonds along the crown band
              vec2 dl = vec2(mod(e.x + 0.055, 0.11) - 0.055, e.y - 0.3);
              if (band < 0.0 && abs(dl.x) + abs(dl.y) < 0.062) tile = vec3(0.97, 0.88, 0.58);
            }
            float rim = step(1.0, re) * (1.0 - step(1.025, re));
            if (re >= 1.025) {
              tile = mix(vec3(0.30, 0.11, 0.08), vec3(0.42, 0.17, 0.12), piece);
              groutCol = vec3(0.74, 0.70, 0.62);
            }
            vec3 med = mix(tile, groutCol, grout * (1.0 - rim));
            med = mix(med, vec3(0.72, 0.55, 0.3), rim); // brass ring
            // the square's brass edge
            float edge = step(1.2, squareD);
            med = mix(med, vec3(0.72, 0.55, 0.3), edge);
            col = mix(col, med, inMed);
            floorJoint = mix(floorJoint, 1.0 - grout * (1.0 - rim) * 0.7, inMed);
            floorGlaze = inMed * (1.0 - grout) * (1.0 - edge);
            floorMosaic = inMed;
          }
          // mosaic colours are absolute (no stone texture under the glaze)
          diffuseColor.rgb = mix(diffuseColor.rgb * col, pow(col, vec3(2.2)), floorMosaic);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.55, roughnessFactor, floorJoint);\nroughnessFactor = mix(roughnessFactor, 0.12, floorGlaze);');
  });
  m.userData.albedo = new THREE.Color(0.5, 0.49, 0.47);
  m.userData.floor = true;
  return m;
}

// ------------------------------------------------------------------ glass

// Stained glass: lit from outside by sky and sun, scattered inside the glass.
function glassFactory(lighting) {
  return (atlas) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas }, ...lighting.uniforms },
      vertexShader: /* glsl */ `
        attribute vec2 glassInfo;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorld;
        varying vec2 vInfo;
        void main() {
          vUv = uv;
          vInfo = glassInfo;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform float uRoom;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorld;
        varying vec2 vInfo;
        void main() {
          // same transmittance curve as the sun's glass map (see main.js)
          vec3 T = pow(texture2D(map, vUv).rgb, vec3(1.0 / 2.2));
          T = min(vec3(0.92), pow(T, vec3(1.45)) * 1.3);
          vec3 outward = -normalize(vNormal);
          float cosSun = max(0.0, dot(outward, uSunDir));
          // sky seen through (and scattered by) the glass
          vec3 sky = uSkyColor * (0.75 + 0.35 * max(0.0, outward.y) + 0.15 * vInfo.x);
          // sunlight striking the outside, diffused through textured glass
          vec3 sun = uSunColor * cosSun * 0.1;
          // looking straight into the sun through the glass
          vec3 view = normalize(vWorld - cameraPosition);
          float forward = pow(max(0.0, dot(view, uSunDir)), 24.0) * cosSun;
          vec3 radiance = T * (sky + sun + uSunColor * min(forward, 0.5) * 0.6);
          gl_FragColor = vec4(radiance * uRoom, 1.0);
        }`,
    });
    m.userData.glass = true;
    return m;
  };
}

// ------------------------------------------------------------------ all

export function createMaterials(lighting) {
  const patch = (m) => lighting.patch(m);
  const granite = stone('concrete_floor_01', lin(0.5, 0.49, 0.46), { roughness: 0.42, repeat: 1.6, normalScale: 0.12, contrast: 0.32 });
  const m = {
    shaft: {
      granite,
      // C1 (vs Sagrada_Familia_columns.jpg): basalt is a dark blue-grey, not
      // black; porphyry a muted purple-brown rather than brick red
      basalt: stone('concrete_floor_01', lin(0.07, 0.082, 0.085), { roughness: 0.38, repeat: 1.6, normalScale: 0.12, contrast: 0.3 }),
      porphyry: stone('concrete_floor_01', lin(0.17, 0.1, 0.11), { roughness: 0.36, repeat: 1.8, normalScale: 0.12, contrast: 0.3 }),
      sandstone: stone('grey_plaster', lin(0.6, 0.54, 0.43), { roughness: 0.6, repeat: 0.6, normalScale: 0.2, contrast: 0.45 }), // Montjuïc sandstone: fine, even grain
    },
    knot: {
      granite: stone('grey_plaster', lin(0.66, 0.65, 0.62), { roughness: 0.6, repeat: 0.5, contrast: 0.5 }),
      basalt: stone('concrete_floor_01', lin(0.06, 0.07, 0.072), { roughness: 0.4, repeat: 1.6, contrast: 0.3 }),
      porphyry: stone('grey_plaster', lin(0.66, 0.64, 0.6), { roughness: 0.6, repeat: 0.5, contrast: 0.5 }),
      sandstone: stone('grey_plaster', lin(0.6, 0.54, 0.43), { roughness: 0.6, repeat: 0.6, contrast: 0.45 }),
    },
    branch: stone('grey_plaster', lin(0.64, 0.63, 0.6), { roughness: 0.75, repeat: 0.35, contrast: 0.55 }),
    vaultConcrete: vaultConcrete(),
    vaultMosaic: vaultMosaic(),
    // the inside of a skylight shaft is lit by the daylight falling down it
    neck: new THREE.MeshStandardMaterial({ color: 0xd8d3c9, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xefeae0, emissiveIntensity: 0.5 }),
    wall: stone('marble_01', lin(0.58, 0.54, 0.46), { roughness: 0.8, repeat: 0.22, normalScale: 0.7, contrast: 1.1 }),
    reveal: stone('grey_plaster', lin(0.62, 0.55, 0.43), { roughness: 0.85, repeat: 0.4, contrast: 0.5 }),
    floor: floor(),
    // plain white concrete soffit (a stretched photo read as streaks)
    gallery: Object.assign(new THREE.MeshStandardMaterial({ color: lin(0.66, 0.65, 0.62), roughness: 0.85 }), { userData: { albedo: lin(0.66, 0.65, 0.62) } }),
    parapet: stone('grey_plaster', lin(0.68, 0.67, 0.64), { roughness: 0.85, repeat: 0.3, contrast: 0.5 }),
    presbytery: stone('marble_01', lin(0.66, 0.64, 0.6), { roughness: 0.35, repeat: 0.3, contrast: 0.8 }),
    wood: new THREE.MeshStandardMaterial({ color: lin(1.3, 1.35, 1.3), map: tex('oak_veneer_01', 'diff', { repeat: 1 }), roughness: 0.5 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.55, metalness: 0.6 }),
    gilt: new THREE.MeshStandardMaterial({ color: 0xc9a14e, roughness: 0.3, metalness: 1 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0xc8c2b6, roughness: 0.22, metalness: 1 }),
    // Glory doors: dark patinated bronze, polished where the letters stand proud
    bronze: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.6, metalness: 0.4 }),
    parchment: new THREE.MeshStandardMaterial({ color: 0xf0e2c0, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x6b5530, emissiveIntensity: 0.6 }),
    warmLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.4).multiplyScalar(4) }),
    downlight: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.65).multiplyScalar(3), side: THREE.DoubleSide }),
    knotLamp: knotLamp(),
    // daylight diffusers: brightness is set from the sky in main.js
    vaultLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.95, 0.88), side: THREE.DoubleSide }),
    skylight: skylight(),
  };
  m.reveal.side = THREE.DoubleSide;
  m.parapet.side = THREE.DoubleSide;
  m.wood.userData.albedo = lin(0.46, 0.28, 0.13);
  m.iron.userData.albedo = new THREE.Color(0.03, 0.03, 0.03);
  m.neck.userData.albedo = new THREE.Color(0.3, 0.28, 0.26);
  m.gilt.userData.albedo = new THREE.Color(0.5, 0.38, 0.15);
  m.pipe.userData.albedo = new THREE.Color(0.5, 0.48, 0.45);
  m.parchment.userData.albedo = new THREE.Color(0.7, 0.6, 0.45);
  m.bronze.userData.albedo = new THREE.Color(0.07, 0.04, 0.02);
  for (const group of [m.shaft, m.knot]) Object.values(group).forEach(patch);
  for (const k of ['branch', 'vaultConcrete', 'vaultMosaic', 'neck', 'wall', 'reveal', 'floor', 'gallery', 'parapet', 'presbytery', 'wood', 'iron', 'gilt', 'pipe', 'parchment', 'bronze']) patch(m[k]);
  m.glass = glassFactory(lighting);
  return m;
}

// Lamps in the knots: frosted glass ovals; the porphyry ones carry the four
// evangelists' colours (tetramorph) instead.
function knotLamp() {
  return new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 1 } }, // dimmed at night for the Terminal Dogma stage
    vertexShader: `attribute float medallion; varying float vKind; varying vec2 vUv;
      void main(){ vKind = medallion; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying float vKind; varying vec2 vUv; uniform float uLevel;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        if (vKind < 0.5) {
          // frosted lamp in a granite knot
          float rays = 0.5 + 0.5 * cos(a * 16.0);
          vec3 c = vec3(1.0, 0.93, 0.8) * (1.0 + 0.8 * (1.0 - r));
          c *= mix(1.0, 0.35 + 0.65 * rays, smoothstep(0.55, 0.95, r));
          c *= smoothstep(1.0, 0.93, r) * 0.9 + 0.1;
          gl_FragColor = vec4(c * uLevel, 1.0);
          return;
        }
        // Evangelist medallion: pieced coloured glass in lead, a pale centre
        // (the symbol) inside rings of the Evangelist's colour
        vec3 tint = vKind < 1.5 ? vec3(1.0, 0.78, 0.18) : vKind < 2.5 ? vec3(0.95, 0.25, 0.12) : vKind < 3.5 ? vec3(0.35, 0.75, 0.25) : vec3(0.2, 0.45, 1.0);
        float ring = floor(r * 5.0);
        float seg = floor((a / 6.2831853 + 0.5) * (8.0 + ring * 6.0));
        float piece = hash(vec2(ring, seg) + vKind);
        vec3 glass = mix(tint, tint * vec3(0.6, 0.7, 0.8) + 0.2 * piece, piece * 0.6);
        vec3 centre = mix(vec3(1.0, 0.96, 0.85), tint, 0.25);
        vec3 c = mix(centre * 1.4, glass, smoothstep(0.32, 0.4, r));
        // lead lines between rings and pieces
        float lead = max(smoothstep(0.93, 0.99, fract(r * 5.0)), smoothstep(0.96, 1.0, fract((a / 6.2831853 + 0.5) * (8.0 + ring * 6.0))) * step(0.36, r));
        c *= 1.0 - 0.85 * lead;
        c *= 1.4;                                   // lit from within
        c = mix(vec3(0.08, 0.06, 0.04), c, smoothstep(1.0, 0.95, r)); // bronze rim
        gl_FragColor = vec4(c * uLevel, 1.0);
      }`,
  });
}

// Skylight necks, seen from below: daylight falling down the shaft, a lamp in
// the large ones, a gilt medallion in the central-nave stars.
function skylight() {
  return new THREE.ShaderMaterial({
    uniforms: { uSky: { value: 1 } },
    vertexShader: `attribute float kind; varying float vKind; varying vec2 vUv;
      void main(){ vKind = kind; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uSky; varying float vKind; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        vec3 day = vec3(0.95, 0.97, 1.0) * uSky;
        // looking up a white shaft into daylight: bright, brightest at the centre
        vec3 c = day * (0.8 + 2.4 * smoothstep(0.75, 0.0, r));
        if (vKind > 0.5 && vKind < 1.5) {
          // monogram medallion: gilt disc with a red/green cross
          float cross = step(abs(p.x), 0.12) + step(abs(p.y), 0.12);
          c = mix(vec3(1.6, 1.1, 0.4) * uSky, vec3(0.8, 0.12, 0.1) * uSky, clamp(cross, 0.0, 1.0) * step(r, 0.6));
          c *= smoothstep(1.0, 0.85, r);
        }
        if (vKind > 1.5) c = mix(vec3(3.0, 2.2, 0.9), day * 2.5, smoothstep(0.5, 0.0, r)) * uSky;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
