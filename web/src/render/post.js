// HDR frame: scene → light shafts → bloom → auto-exposure → AgX → screen.
//
// Light shafts are marched through the same sun maps the surfaces use, so a
// beam that crosses a red pane is red, and it stops where a column blocks it.

import * as THREE from 'three';
import { fullscreen } from './lighting.js';
import { SUN_GLSL } from './lighting.js';
import { ZONE_GLSL } from './lighting.js';

export class PostPipeline {
  constructor(renderer, lighting) {
    this.renderer = renderer;
    this.lighting = lighting;
    this.settings = { exposureBias: 0, shafts: 1, bloom: 1, haze: 1 };
    this.scene = null;
    this.frame = 0;

    const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.shaftTarget = new THREE.WebGLRenderTarget(1, 1, half);
    this.shaftBlur = new THREE.WebGLRenderTarget(1, 1, half);
    this.bloomDown = [];
    this.bloomUp = [];
    for (let i = 0; i < 6; i++) {
      this.bloomDown.push(new THREE.WebGLRenderTarget(1, 1, half));
      this.bloomUp.push(new THREE.WebGLRenderTarget(1, 1, half));
    }
    this.lumTarget = new THREE.WebGLRenderTarget(64, 64, { ...half, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.adapt = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false }));

    this.shaftPass = fullscreen(
      /* glsl */ `
      precision highp float;
      ${SUN_GLSL}
      ${ZONE_GLSL}
      uniform sampler2D tDepth;
      uniform mat4 uInvProj;
      uniform mat4 uCamWorld;
      uniform vec2 uRes;
      uniform float uDensity;
      layout(location = 0) out vec4 oColor;

      float sunVis(vec3 p) {
        vec4 lp = uSunMatrix * vec4(p, 1.0);
        vec3 s = lp.xyz * 0.5 + 0.5;
        if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0) return 0.0;
        return step(s.z - 0.00004, texture(uSunDepth, s.xy).r);
      }
      vec3 sunGlass(vec3 p) {
        vec4 lp = uSunMatrix * vec4(p, 1.0);
        vec3 s = lp.xyz * 0.5 + 0.5;
        ivec2 gsz = textureSize(uSunGlass, 0);
        float gz = texelFetch(uSunGlass, ivec2(s.xy * vec2(gsz)), 0).a;
        return s.z > gz ? textureLod(uSunGlass, s.xy, 1.5).rgb : vec3(1.0);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        float d = texture(tDepth, uv).r;
        vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        v /= v.w;
        vec3 ro = (uCamWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 wp = (uCamWorld * v).xyz;
        vec3 rd = wp - ro;
        float dist = min(length(rd), 160.0);
        rd = normalize(rd);
        const int N = 48;
        float stepL = dist / float(N);
        float jitter = sunNoise(gl_FragCoord.xy);
        // Henyey–Greenstein, mostly forward: beams glow when you look sunward
        float g = 0.55;
        float c = dot(rd, uSunDir);
        float phase = (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * c, 1.5));
        phase = mix(phase, 1.0 / (4.0 * 3.14159265), 0.35);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < N; i++) {
          float t = (float(i) + jitter) * stepL;
          vec3 p = ro + rd * t;
          float zone = zoneHeight(p.xz);
          if (zone <= 0.0 || p.y > zone) continue;
          float vis = sunVis(p);
          if (vis <= 0.0) continue;
          acc += sunGlass(p) * exp(-uDensity * 0.5 * t);
        }
        vec3 inscatter = acc * stepL * uDensity * phase * uSunColor;
        // faint ambient haze so distance reads in the deep nave
        inscatter += uSkyColor * uDensity * dist * 0.012;
        oColor = vec4(inscatter, 1.0);
      }`,
      {
        ...lighting.uniforms,
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2() },
        uDensity: { value: 0.006 },
      },
    );

    // depth-aware blur of the quarter-resolution shafts
    this.blurPass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tInput; uniform vec2 uTexel; uniform vec2 uDir;
      layout(location = 0) out vec4 oColor;
      void main() {
        vec2 uv = gl_FragCoord.xy * uTexel;
        vec3 c = texture(tInput, uv).rgb * 0.227;
        c += (texture(tInput, uv + uDir * uTexel * 1.38).rgb + texture(tInput, uv - uDir * uTexel * 1.38).rgb) * 0.316;
        c += (texture(tInput, uv + uDir * uTexel * 3.23).rgb + texture(tInput, uv - uDir * uTexel * 3.23).rgb) * 0.070;
        oColor = vec4(c, 1.0);
      }`,
      { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2() } },
    );

    this.downPass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tInput; uniform vec2 uTexel; uniform float uThreshold; uniform bool uFirst; uniform sampler2D tAdapt;
      layout(location = 0) out vec4 oColor;
      void main() {
        // uTexel is the output texel; four bilinear taps cover a 4×4 input block
        vec2 uv = gl_FragCoord.xy * uTexel;
        vec2 o = uTexel * 0.5;
        vec3 c = texture(tInput, uv + vec2(-o.x, -o.y)).rgb + texture(tInput, uv + vec2(o.x, -o.y)).rgb
               + texture(tInput, uv + vec2(-o.x, o.y)).rgb + texture(tInput, uv + vec2(o.x, o.y)).rgb;
        c *= 0.25;
        // one bad pixel must never spread through the blur chain
        if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
        if (uFirst) {
          // threshold on the exposed image: only what will look very bright blooms
          float exposure = 0.18 / clamp(texture(tAdapt, vec2(0.5)).r, 0.004, 4.0);
          c *= exposure;
          float l = max(c.r, max(c.g, c.b));
          float soft = clamp(l - uThreshold * 0.5, 0.0, uThreshold);
          soft = soft * soft / (4.0 * uThreshold + 1e-4);
          c *= max(soft, l - uThreshold) / max(l, 1e-4);
          c = min(c, vec3(8.0)); // sub-pixel glints must not bloom into flashes
          c /= exposure;
        }
        oColor = vec4(c, 1.0);
      }`,
      { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.6 }, uFirst: { value: false }, tAdapt: { value: null } },
    );

    this.upPass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel; uniform vec2 uLowTexel;
      layout(location = 0) out vec4 oColor;
      void main() {
        vec2 uv = gl_FragCoord.xy * uTexel;
        vec2 o = uLowTexel;
        vec3 c = texture(tLow, uv).rgb * 4.0;
        c += (texture(tLow, uv + vec2(o.x, 0.0)).rgb + texture(tLow, uv - vec2(o.x, 0.0)).rgb + texture(tLow, uv + vec2(0.0, o.y)).rgb + texture(tLow, uv - vec2(0.0, o.y)).rgb) * 2.0;
        c += texture(tLow, uv + o).rgb + texture(tLow, uv - o).rgb + texture(tLow, uv + vec2(o.x, -o.y)).rgb + texture(tLow, uv + vec2(-o.x, o.y)).rgb;
        c /= 16.0;
        oColor = vec4(c + texture(tHigh, uv).rgb, 1.0);
      }`,
      { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uLowTexel: { value: new THREE.Vector2() } },
    );

    this.lumPass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tInput;
      layout(location = 0) out vec4 oColor;
      void main() {
        // 16 taps per metering cell over the full-resolution HDR scene
        vec2 cell = vec2(1.0 / 64.0);
        float l = 0.0;
        for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
          vec2 uv = (gl_FragCoord.xy - 0.5 + (vec2(i, j) + 0.5) / 4.0) * cell;
          l += clamp(log2(max(dot(texture(tInput, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4)), -8.0, 4.0);
        }
        l /= 16.0;
        vec2 uv = gl_FragCoord.xy * cell;
        // centre-weighted metering
        float w = 1.0 - 0.6 * length(uv - 0.5);
        oColor = vec4(l * w, w, 0.0, 1.0);
      }`,
      { tInput: { value: null } },
    );

    this.adaptPass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uBlend;
      layout(location = 0) out vec4 oColor;
      void main() {
        vec2 m = textureLod(tLum, vec2(0.5), 6.0).rg;
        float avg = exp2(m.x / max(m.y, 1e-4));
        float prev = texture(tPrev, vec2(0.5)).r;
        // adapt in log space, and more slowly towards darkness (like the eye),
        // so a brief dark view doesn't blow the next ones out
        float rate = avg < prev ? uBlend * 0.5 : uBlend;
        float next = prev <= 0.0 ? avg : exp2(mix(log2(prev), log2(avg), rate));
        oColor = vec4(next, 0.0, 0.0, 1.0);
      }`,
      { tLum: { value: this.lumTarget.texture }, tPrev: { value: null }, uBlend: { value: 0.05 } },
    );

    // Ambient occlusion (half resolution) from the depth buffer: corners,
    // column feet, pew undersides and the creases of the vaults darken as they
    // do in a real interior. Normals are rebuilt from depth, so no extra pass.
    const halfF = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, halfF);
    this.aoBlur = new THREE.WebGLRenderTarget(1, 1, halfF);
    this.aoPass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uInvProj; uniform vec2 uRes; uniform float uRadius;
      layout(location = 0) out vec4 oColor;
      vec3 viewPos(vec2 uv) {
        float d = texture(tDepth, uv).r;
        vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return v.xyz / v.w;
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        float d = texture(tDepth, uv).r;
        if (d >= 1.0) { oColor = vec4(1.0); return; }
        vec3 P = viewPos(uv);
        vec2 px = 1.0 / uRes;
        vec3 N = normalize(cross(viewPos(uv + vec2(px.x, 0.0)) - P, viewPos(uv + vec2(0.0, px.y)) - P));
        // projected radius in uv for a world radius uRadius
        float rUv = uRadius * uProj[1][1] / max(-P.z, 0.1) * 0.5;
        rUv = min(rUv, 0.1);
        // two scales: contact shadows (radius R) and room-scale shading (4R),
        // fixed spiral, no per-frame noise so nothing shimmers
        float h = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        float ao = 1.0;
        for (int scale = 0; scale < 2; scale++) {
          float R = scale == 0 ? uRadius : uRadius * 4.0;
          float rr = min(R * uProj[1][1] / max(-P.z, 0.1) * 0.5, 0.18);
          float occ = 0.0;
          for (int i = 0; i < 12; i++) {
            float t = (float(i) + 0.5) / 12.0;
            float a = h + float(i) * 2.39996323 + float(scale) * 1.3;
            vec2 o = vec2(cos(a), sin(a)) * rr * sqrt(t);
            vec3 S = viewPos(uv + o);
            vec3 v = S - P;
            float vv = dot(v, v);
            float range = 1.0 - smoothstep(R * R, 4.0 * R * R, vv);
            occ += max(0.0, dot(v, N) - 0.02 * -P.z) * inversesqrt(vv + 0.0001) / (1.0 + vv / (R * R)) * range;
          }
          ao *= clamp(1.0 - (scale == 0 ? 3.2 : 2.6) * occ / 12.0, 0.0, 1.0);
        }
        oColor = vec4(ao, ao, ao, 1.0);
      }`,
      { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() }, uRadius: { value: 0.7 } },
    );

    this.finalPass = fullscreen(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tScene; uniform sampler2D tShafts; uniform sampler2D tBloom; uniform sampler2D tAdapt; uniform sampler2D tAO; uniform float uAO;
      uniform float uBloom; uniform float uShafts; uniform float uExposureBias; uniform float uLockAvg; uniform float uLockW; uniform vec2 uRes; uniform float uFrame;
      layout(location = 0) out vec4 oColor;

      const mat3 SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
      const mat3 REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
      vec3 agxContrast(vec3 x) {
        vec3 x2 = x * x; vec3 x4 = x2 * x2;
        return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
      }
      vec3 agx(vec3 color) {
        const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
        const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
        color = SRGB_TO_2020 * color;
        color = inset * color;
        color = clamp((log2(max(color, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
        color = agxContrast(color);
        // "punchy" look keeps stained glass saturated
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = luma + 1.25 * (color - luma);
        color = outset * color;
        color = pow(max(vec3(0.0), color), vec3(2.2));
        return clamp(REC2020_TO_SRGB * color, 0.0, 1.0);
      }
      // Minimal FXAA: blend along the local edge direction where luma contrast is high.
      float luma(vec3 c) { return log2(1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
      vec3 fxaa(sampler2D t, vec2 uv, vec2 px) {
        vec3 cM = texture(t, uv).rgb;
        float lM = luma(cM);
        float lN = luma(texture(t, uv + vec2(0.0, px.y)).rgb);
        float lS = luma(texture(t, uv - vec2(0.0, px.y)).rgb);
        float lE = luma(texture(t, uv + vec2(px.x, 0.0)).rgb);
        float lW = luma(texture(t, uv - vec2(px.x, 0.0)).rgb);
        float range = max(max(max(lN, lS), max(lE, lW)), lM) - min(min(min(lN, lS), min(lE, lW)), lM);
        if (range < 0.08) return cM;
        // blend across the edge: perpendicular to the luma gradient
        vec2 dir = normalize(vec2(-(lN - lS), lE - lW) + 1e-5) * px;
        vec3 a = 0.5 * (texture(t, uv - dir * 0.5).rgb + texture(t, uv + dir * 0.5).rgb);
        return mix(cM, a, clamp(range * 2.0, 0.0, 0.75));
      }
      // Khronos PBR Neutral: keeps hue and saturation of coloured light until
      // it nears white, which suits stained glass better than AgX's early desaturation.
      vec3 neutral(vec3 color) {
        const float start = 0.76;
        const float desaturation = 0.15;
        float x = min(color.r, min(color.g, color.b));
        float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
        color -= offset;
        float peak = max(color.r, max(color.g, color.b));
        if (peak < start) return color;
        float d = 1.0 - start;
        float newPeak = 1.0 - d * d / (peak + d - start);
        color *= newPeak / peak;
        float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
        return mix(color, vec3(newPeak), g);
      }
      vec3 toSRGB(vec3 c) {
        c = max(c, vec3(0.0));
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        vec3 c = fxaa(tScene, uv, 1.0 / uRes);
        if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
        float aoV = texture(tAO, uv).r;
        if (isnan(aoV) || isinf(aoV)) aoV = 1.0;
        c *= mix(1.0, clamp(aoV, 0.0, 1.0), uAO);
        c += texture(tShafts, uv).rgb * uShafts;
        c += texture(tBloom, uv).rgb * uBloom * 0.06;
        float avg = texture(tAdapt, vec2(0.5)).r;
        // expose so the average lands a little below middle grey; clamp the range
        // a locked exposure (Terminal Dogma's blackout: a stage, not an eye, so the dark stays dark)
        avg = exp2(mix(log2(clamp(avg, 0.004, 4.0)), log2(max(uLockAvg, 1e-4)), uLockW));
        float exposure = 0.18 / clamp(avg, 0.004, 4.0) * exp2(uExposureBias);
        c *= exposure;
        // slight vignette, as the eye and lens do
        float vig = 1.0 - 0.22 * pow(length(uv - 0.5) * 1.3, 2.4);
        c *= vig;
        c = neutral(c);
        c = toSRGB(c);
        // dither against banding in the smooth vault gradients
        float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 7.0, vec2(0.06711056, 0.00583715))));
        c += (n - 0.5) / 255.0;
        oColor = vec4(c, 1.0);
      }`,
      {
        tScene: { value: null },
        tShafts: { value: this.shaftBlur.texture },
        tBloom: { value: null },
        tAdapt: { value: null },
        uBloom: { value: 1 },
        uShafts: { value: 1 },
        uExposureBias: { value: 0 },
        uLockAvg: { value: 0.02 },
        uLockW: { value: 0 },
        tAO: { value: null },
        uAO: { value: 0.75 },
        uRes: { value: new THREE.Vector2() },
        uFrame: { value: 0 },
      },
    );
  }

  setSize(width, height, pixelRatio) {
    const w = Math.floor(width * pixelRatio);
    const h = Math.floor(height * pixelRatio);
    if (this.sceneTarget) this.sceneTarget.dispose();
    // Not multisampled: sampling a resolved MSAA target from later passes read
    // back empty on this GPU/ANGLE path. Supersampling + FXAA instead.
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.sceneTarget.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.shaftTarget.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.aoTarget.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.aoBlur.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.shaftBlur.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    let bw = w;
    let bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, Math.ceil(bw / 2));
      bh = Math.max(1, Math.ceil(bh / 2));
      this.bloomDown[i].setSize(bw, bh);
      this.bloomUp[i].setSize(bw, bh);
    }
    this.width = w;
    this.height = h;
  }

  render(scene, camera) {
    const r = this.renderer;
    this.frame++;

    // 1. scene into HDR
    r.setRenderTarget(this.sceneTarget);
    r.clear();
    r.render(scene, camera);

    // 1b. ambient occlusion
    const ao = this.aoPass.material.uniforms;
    ao.tDepth.value = this.sceneTarget.depthTexture;
    ao.uProj.value.copy(camera.projectionMatrix);
    ao.uInvProj.value.copy(camera.projectionMatrixInverse);
    ao.uRes.value.set(this.aoTarget.width, this.aoTarget.height);
    this.aoPass.render(r, this.aoTarget);
    {
      const bl = this.blurPass.material.uniforms;
      bl.uTexel.value.set(1 / this.aoTarget.width, 1 / this.aoTarget.height);
      bl.tInput.value = this.aoTarget.texture;
      bl.uDir.value.set(1, 0);
      this.blurPass.render(r, this.aoBlur);
      bl.tInput.value = this.aoBlur.texture;
      bl.uDir.value.set(0, 1);
      this.blurPass.render(r, this.aoTarget);
    }

    // 2. light shafts at quarter resolution
    const s = this.shaftPass.material.uniforms;
    s.tDepth.value = this.sceneTarget.depthTexture;
    s.uInvProj.value.copy(camera.projectionMatrixInverse);
    s.uCamWorld.value.copy(camera.matrixWorld);
    s.uRes.value.set(this.shaftTarget.width, this.shaftTarget.height);
    s.uDensity.value = 0.006 * this.settings.shafts;
    this.shaftPass.render(r, this.shaftTarget);
    const b = this.blurPass.material.uniforms;
    b.uTexel.value.set(1 / this.shaftTarget.width, 1 / this.shaftTarget.height);
    b.tInput.value = this.shaftTarget.texture;
    b.uDir.value.set(1, 0);
    this.blurPass.render(r, this.shaftBlur);
    b.tInput.value = this.shaftBlur.texture;
    b.uDir.value.set(0, 1);
    this.blurPass.render(r, this.shaftTarget);
    b.tInput.value = this.shaftTarget.texture;
    b.uDir.value.set(1.5, 1.5);
    this.blurPass.render(r, this.shaftBlur);

    // 3. bloom mip chain
    const d = this.downPass.material.uniforms;
    let input = this.sceneTarget.texture;
    for (let i = 0; i < 6; i++) {
      const t = this.bloomDown[i];
      d.tInput.value = input;
      d.uTexel.value.set(1 / t.width, 1 / t.height);
      d.uFirst.value = i === 0;
      d.tAdapt.value = this.adapt[(this.frame + 1) % 2].texture; // last frame's exposure
      this.downPass.render(r, t);
      input = t.texture;
    }
    const u = this.upPass.material.uniforms;
    let low = this.bloomDown[5];
    for (let i = 4; i >= 0; i--) {
      const t = this.bloomUp[i];
      u.tLow.value = low.texture;
      u.tHigh.value = this.bloomDown[i].texture;
      u.uTexel.value.set(1 / t.width, 1 / t.height);
      u.uLowTexel.value.set(1 / low.width, 1 / low.height);
      this.upPass.render(r, t);
      low = t;
    }

    // 4. exposure adaptation
    this.lumPass.material.uniforms.tInput.value = this.sceneTarget.texture;
    this.lumPass.render(r, this.lumTarget);
    const [prev, next] = this.frame % 2 ? this.adapt : [this.adapt[1], this.adapt[0]];
    this.adaptPass.material.uniforms.tPrev.value = prev.texture;
    this.adaptPass.material.uniforms.uBlend.value = this.frame < 5 || this.instantExposure ? 1 : 0.04;
    this.adaptPass.render(r, next);
    this.lastAdapt = next;
    // Film renders script the exposure: a fixed scene average instead of the eye's.
    if (this.settings.fixedAverage > 0) {
      const clear = r.getClearColor(new THREE.Color());
      const alpha = r.getClearAlpha();
      const target = r.getRenderTarget();
      r.setRenderTarget(next);
      r.setClearColor(new THREE.Color(this.settings.fixedAverage, this.settings.fixedAverage, this.settings.fixedAverage), 1);
      r.clear(true, false, false);
      r.setClearColor(clear, alpha);
      r.setRenderTarget(target);
    }

    // 5. tone map to screen
    const f = this.finalPass.material.uniforms;
    f.tScene.value = this.sceneTarget.texture;
    f.tAO.value = this.aoTarget.texture;
    f.uAO.value = this.settings.ao ?? 0.75;
    f.tBloom.value = this.bloomUp[0].texture;
    f.tAdapt.value = next.texture;
    f.uBloom.value = this.settings.bloom;
    f.uShafts.value = 1;
    f.uExposureBias.value = this.settings.exposureBias + (this.settings.stageBias ?? 0); // stageBias: Terminal Dogma at night
    f.uLockW.value = this.settings.lockWeight ?? 0;
    f.uLockAvg.value = this.settings.lockAverage ?? 0.02;
    f.uRes.value.set(this.width, this.height);
    f.uFrame.value = this.frame % 64;
    this.finalPass.render(r, null);
  }
}
