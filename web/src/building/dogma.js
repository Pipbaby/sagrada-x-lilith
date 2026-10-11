// "Terminal Dogma": Lilith on her red cross behind the altar, a private layer (Settings, off by
// default). The figure is "Lilith – Evangelion" by solodovnykov (CC BY 4.0), reworked
// (tools/lilith/soften.py, finish.py): softened body, stronger roots, smooth hooded head, the
// lilac Seele mask, a clean red cracked cross, hexagonal bolts and two orange LCL streams. The
// character belongs to Khara; this layer is not for publishing.
//
// The cross stands in the presbytery ring, just behind the canopy's cables and in front of
// the column at the back of the apse, facing down the nave; its foot sinks into a shallow pool
// of LCL with a little haze over it, the presbytery floor in front left dry. It is loaded only
// when first switched on.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const URL = '/assets/lilith/lilith.glb';
export const DOGMA = {
  // 23 m: the largest cross whose arms clear the apse columns either side (at x ±6.5,
  // z 78.75) and whose post stands between the organ cases (|x| > 1.8)
  height: 23, // metres, foot of the cross to its top
  z: 79.7, // the cross's centre line: behind the canopy's cables (z < 78.6), in front of the back column
  foot: 1.55, // the cross's foot, below the pool's surface
  // the pool round the post's foot, reaching forward into the presbytery; its kerb runs into
  // the organ cases at the back corners, which hide it
  pool: { x: 0, z: 79.3, rx: 2.05, rz: 0.95, y: 2.12 }, // the presbytery platform is at 2
};

// Linear albedo for the bounce-light gather, by the model's material names.
const ALBEDO = { Stone_2: [0.5, 0.02, 0.02], Body: [0.72, 0.72, 0.72], Mask: [0.25, 0.13, 0.33], Metal: [0.2, 0.2, 0.2], LCL: [0.7, 0.25, 0.03] };

function poolMeshes(materials, lighting) {
  const P = DOGMA.pool;
  const lcl = lighting.patch(
    Object.assign(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.17, 0.01), roughness: 0.06, metalness: 0, emissive: new THREE.Color(1.0, 0.36, 0.05), emissiveIntensity: 0.18 }), {
      userData: { albedo: new THREE.Color(0.7, 0.25, 0.03) },
    }),
    'dogma-lcl',
  );
  const surface = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), lcl);
  surface.scale.set(P.rx, 1, P.rz);
  surface.position.set(P.x, P.y, P.z);
  // a low stone kerb round the pool
  const kerbShape = new THREE.Shape().absellipse(0, 0, P.rx + 0.3, P.rz + 0.3, 0, Math.PI * 2);
  kerbShape.holes.push(new THREE.Path().absellipse(0, 0, P.rx, P.rz, 0, Math.PI * 2, true));
  const kerbGeo = new THREE.ExtrudeGeometry(kerbShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 64 });
  kerbGeo.rotateX(-Math.PI / 2).translate(P.x, 2.0, P.z);
  const kerb = new THREE.Mesh(kerbGeo, materials.presbytery);
  // haze: a faint glowing veil standing over the surface, fading upwards
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 64, 1, true),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.45, 0.12).multiplyScalar(0.35) } },
      vertexShader: 'varying float vH; void main(){ vH = position.y + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vH; void main(){ float a = pow(1.0 - vH, 3.0); gl_FragColor = vec4(uColor * a, 1.0); }',
    }),
  );
  haze.scale.set(P.rx * 0.97, 0.9, P.rz * 0.97);
  haze.position.set(P.x, P.y + 0.45, P.z);
  haze.renderOrder = 2;
  return { surface, kerb, haze };
}

// At night, with the layer on, the basilica becomes a stage: its electric light and lamps fade
// down and one spotlight, high over the crossing, picks out the cross, throwing Lilith's shadow
// onto it, as in the series (a dark hall, the white figure on the red cross). It fades in over
// dusk and out over dawn with the sun's height (lighting.night). Tuned by eye on screenshots.
export const STAGE = {
  room: 0.12, // what is left of the electric light and the lamps at full night
  spot: 2600, // candela: about 2.3 irradiance units on the cross at 33 m (the room's night light is 1.1)
  // Blackout, deep in the night (hours, Barcelona time): the hall goes completely dark and only
  // the cross and a glow round it remain, fading to black down the nave. It comes on over the
  // first hour and goes off over the last.
  blackout: { from: 23.0, full: 0.0, until: 3.5, end: 4.5 },
  glow: 320, // candela of the glow round the cross during the blackout
  // during the blackout the exposure is held at the evening stage's (the scene average it settles
  // on from the nave at 22:00), instead of following the eye into the dark
  lockAverage: 0.0186,
};

// 0..1: how far into the blackout this hour is.
export function blackoutAt(hour) {
  const { from, full, until, end } = STAGE.blackout;
  const h = hour < 12 ? hour + 24 : hour; // one night, 12:00 to 12:00
  const s = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
  return s(from, full + 24, h) * (1 - s(until + 24, end + 24, h));
}

export class TerminalDogma {
  constructor({ scene, materials, lighting, colliders, sunLayer, renderer }) {
    Object.assign(this, { scene, materials, lighting, colliders, sunLayer, renderer });
    this.stage = 0;
    // The spotlight lives in the scene from the start (at zero), so switching the layer on and off
    // never recompiles the basilica's shaders; its shadow map is drawn only when something changes.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const spot = new THREE.SpotLight(new THREE.Color(0.96, 0.95, 1.0), 0, 40, 0.34, 0.45, 2);
    spot.position.set(0, 36, 54);
    spot.target.position.set(0, 13.5, DOGMA.z);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.camera.near = 12;
    spot.shadow.camera.far = 50;
    spot.shadow.bias = -0.0005;
    spot.shadow.normalBias = 0.04;
    scene.add(spot, spot.target);
    this.spot = spot;
    // during the blackout, a soft light round the foot of the cross that dies away with distance:
    // the presbytery and the crossing catch a little of it, the nave none
    const glow = new THREE.PointLight(new THREE.Color(1.0, 0.86, 0.74), 0, 30, 2);
    glow.position.set(0, 7, DOGMA.z - 6);
    scene.add(glow);
    this.glow = glow;
    this.blackout = 0;
    this.altarCollider = colliders.find((c) => c.name === 'altar');
    this.group = new THREE.Group();
    this.group.name = 'terminal-dogma';
    this.group.visible = false;
    scene.add(this.group);
    const P = DOGMA.pool;
    // the pool (with the cross standing in it) can't be walked into
    this.collider = { type: 'box', minX: P.x - P.rx - 0.3, maxX: P.x + P.rx + 0.3, minZ: P.z - P.rz - 0.3, maxZ: P.z + P.rz + 0.6, height: 2.6 };
    this.loading = null;
    this.noReflect = [];
  }

  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const gltf = await new GLTFLoader().loadAsync(URL);
      const fig = gltf.scene;
      // face down the nave (the model faces +z)
      fig.rotation.y = Math.PI;
      fig.updateMatrixWorld(true);
      const cross = new THREE.Box3();
      fig.traverse((o) => o.isMesh && /Stone/.test(o.material?.name ?? '') && cross.expandByObject(o));
      const s = DOGMA.height / (cross.max.y - cross.min.y);
      fig.scale.setScalar(s);
      fig.updateMatrixWorld(true);
      cross.makeEmpty();
      fig.traverse((o) => o.isMesh && /Stone/.test(o.material?.name ?? '') && cross.expandByObject(o));
      const c = cross.getCenter(new THREE.Vector3());
      fig.position.add(new THREE.Vector3(-c.x, DOGMA.foot - cross.min.y, DOGMA.z - c.z));
      const patched = new Set(); // pieces share materials: attach the light once each
      fig.traverse((o) => {
        if (!o.isMesh) return;
        o.layers.enable(this.sunLayer);
        const m = o.material;
        if (patched.has(m)) return;
        patched.add(m);
        const key = Object.keys(ALBEDO).find((k) => (m.name || '').includes(k));
        m.userData.albedo = new THREE.Color(...(ALBEDO[key] || [0.5, 0.5, 0.5]));
        if (key === 'Body') {
          // she reads white in the series, with cool lilac shading: lift the skin a little and
          // give it a faint cool self-light so the warm stone's bounce doesn't turn it khaki
          m.color.multiplyScalar(1.15);
          m.emissive = new THREE.Color(0.78, 0.8, 0.9);
          m.emissiveMap = m.map;
          m.emissiveIntensity = 0.1;
        }
        if (key === 'LCL') {
          m.color.setRGB(0.66, 0.2, 0.015);
          m.emissive = new THREE.Color(1.0, 0.36, 0.05);
          m.emissiveIntensity = 0.12;
          m.roughness = 0.08;
        }
        this.lighting.patch(m, `dogma-${m.name || m.uuid}`);
      });
      // the figure throws its shadow onto the cross under the stage light
      this.lcl = [];
      fig.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        if (/LCL/.test(o.material.name) && !this.lcl.includes(o.material)) this.lcl.push(o.material);
      });
      this.group.add(fig);
      const pool = poolMeshes(this.materials, this.lighting);
      pool.kerb.layers.enable(this.sunLayer);
      this.group.add(pool.surface, pool.kerb, pool.haze);
      this.noReflect = [pool.surface, pool.haze];
      this.lcl.push(pool.surface.material);
      for (const m of this.lcl) m.userData.glow = m.emissiveIntensity;
      this.figure = fig;
    })();
    return this.loading;
  }

  async setVisible(on) {
    if (on) await this.load();
    this.group.visible = on;
    const swap = (c, add) => {
      const i = this.colliders.indexOf(c);
      if (add && i < 0) this.colliders.push(c);
      if (!add && i >= 0) this.colliders.splice(i, 1);
    };
    swap(this.collider, on);
    // the altar would stand in front of the pool and block the view: it goes while the cross is here
    const altar = this.scene.getObjectByName('altar');
    if (altar) altar.visible = !on;
    if (this.altarCollider) swap(this.altarCollider, !on);
    this.renderer.shadowMap.needsUpdate = true;
    this.lighting.dirty = true; // sun maps and bounce light with (or without) the cross
  }

  // How far the stage has taken over (0 by day or with the layer off, 1 at full night); sets the
  // spotlight and the LCL's glow to match. main.js dims the room by the same amount.
  updateStage(night, hour) {
    const on = this.group.visible;
    const k = on ? THREE.MathUtils.smoothstep(night, 0.25, 0.95) : 0;
    const b = on ? blackoutAt(hour) * k : 0;
    this.stage = k;
    this.blackout = b;
    this.spot.intensity = k * STAGE.spot;
    this.glow.intensity = b * STAGE.glow;
    for (const m of this.lcl ?? []) m.emissiveIntensity = m.userData.glow * (1 + 3 * k);
    return k;
  }
}
