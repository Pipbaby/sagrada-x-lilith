import * as THREE from 'three';
import { Lighting, LAYERS } from './render/lighting.js';
import { PostPipeline } from './render/post.js';
import { FloorReflection } from './render/reflection.js';
import { attachBakedLight } from './render/baked-light.js';
import { barcelonaOffset, dayOfYear } from './render/sun.js';
import { createMaterials } from './materials.js';
import { buildBasilica } from './building/index.js';
import { vaults } from './building/vaults.js';
import { STAIRS } from './building/stairs.js';
import { TerminalDogma, STAGE } from './building/dogma.js';
import { Walker } from './player/controls.js';
import { basilicaEnv } from './player/basilica-env.js';
import { AudioPlayer } from './player/audio.js';
import { Exhibition } from './player/exhibits.js';
import { Interface, loadState, saveState } from './player/ui.js';
import * as i18n from './i18n.js';
const { t, applyI18n, onLangChange, mountLangButtons, LOCALE } = i18n;

const params = new URLSearchParams(location.search);
const state = loadState();
const quality = params.get('quality') || state.quality || 'high';
mountLangButtons(document.querySelector('#top .buttons'));
applyI18n();
const step = (key) => (document.getElementById('loading-step').textContent = t(key));

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const pixelRatio = () => Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1);
renderer.setPixelRatio(pixelRatio());
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);

// Give the loading screen a chance to paint between the heavy steps.
const breathe = () => new Promise((r) => setTimeout(r, 0));

step('load.columns');
await breathe();
const lighting = new Lighting(renderer, { quality });
const materials = createMaterials(lighting);
const basilica = buildBasilica(materials);
scene.add(basilica.group);

// Layers: everything opaque blocks the sun; glass is drawn into the sun's
// glass map instead; lamps neither block nor cast.
basilica.group.traverse((o) => {
  if (!o.isMesh) return;
  o.layers.enable(LAYERS.sunBlocker);
  o.frustumCulled = !o.isInstancedMesh;
});
for (const m of basilica.glassMeshes) {
  m.layers.disable(LAYERS.sunBlocker);
  m.layers.enable(LAYERS.glass);
  m.userData.glassShadow = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { map: { value: m.material.uniforms.map.value } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; varying vec2 vUv;
      void main(){
        // Cathedral glass passes much of the light of its own colour: a
        // gentler curve than sRGB decoding, so deep blues and reds still glow.
        // The atlas is sRGB: the sampler returns linear values, so re-encode
        // before applying the curve (it is defined on the sRGB values, like
        // averageGlassColor in glass.js). Without this, blues and greens were
        // darkened twice and the Nativity and Glory glass cast almost no light.
        vec3 c = pow(texture2D(map, vUv).rgb, vec3(1.0 / 2.2));
        vec3 T = min(vec3(0.92), pow(c, vec3(1.45)) * 1.3);
        gl_FragColor = vec4(T, gl_FragCoord.z);
      }`,
  });
}
for (const m of basilica.emissive) m.layers.disable(LAYERS.sunBlocker);
basilica.group.traverse((o) => o.userData.noSunBlock && o.layers.disable(LAYERS.sunBlocker));

// Skylights also shed daylight into the bounce-light gather.
const lights = [...basilica.windows];
for (const v of vaults) {
  for (const n of v.necks) {
    lights.push({ position: new THREE.Vector3(n.x, v.H, n.z), normal: new THREE.Vector3(0, -1, 0), area: Math.PI * n.r * n.r * 0.35, color: [0.8, 0.8, 0.8], skylight: true });
  }
}

const post = new PostPipeline(renderer, lighting);
const reflection = new FloorReflection(renderer, lighting.uniforms);
const floorMesh = basilica.group.getObjectByName('floor');
// Small lamps stay out of the floor mirror: their reflections slid and flared as you moved.
// The inside of the spiral stairs is drawn only when one is near a drum (it can't be seen from
// further away), and never in the floor mirror.
const stairInside = basilica.group.getObjectByName('stair-inside');
const nearStair = (p) => STAIRS.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 14);
const notReflected = [floorMesh, stairInside, ...basilica.emissive.filter((m) => !m.userData.skylight)];
const walker = new Walker(camera, canvas, basilica.colliders, basilica.seats, basilicaEnv);
const pose = state.pose;
if (pose && walker.free(pose.x, pose.z, pose.y ?? 0)) {
  walker.teleport(pose.x, pose.z, pose.yaw, pose.pitch);
  // up a stair or on a gallery: stand at the height one left from, if there is ground there
  const y = pose.y ?? 0;
  if (y > 0.3 && Math.abs(walker.groundAt(pose.x, pose.z, y) - y) < 0.05) walker.position.y = walker.headY = y;
} else walker.teleport(0, 3, 0, 0.12);

function resize() {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  reflection.setSize(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ time of day

const clock = {
  live: params.has('hour') ? false : state.clock?.live ?? true,
  hour: Number(params.get('hour') ?? state.clock?.hour ?? 12),
  day: Number(params.get('day') ?? state.clock?.day ?? 0),
};
const timeInput = document.getElementById('time');
const timeLabel = document.getElementById('time-label');
function applyTime({ save = true, light = true } = {}) {
  const now = new Date();
  const day = clock.day || dayOfYear(now);
  const offset = barcelonaOffset(now);
  if (clock.live) {
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    clock.hour = (utcHours + offset + 24) % 24;
  }
  if (light) applyLight(day, offset);
  if (!dragging) timeInput.value = clock.hour;
  const h = Math.floor(clock.hour);
  const m = Math.floor((clock.hour - h) * 60);
  timeLabel.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${clock.live ? t('time.live.suffix') : ''}`;
  if (save) saveState({ ...loadState(), clock });
}
const LAMP_BASE = { warmLamp: materials.warmLamp.color.clone(), downlight: materials.downlight.color.clone() };
let dogma = null; // Terminal Dogma (set up further down, with the settings)
function applyLight(day, offset) {
  lighting.setTime(day, clock.hour, offset);
  materials.skylight.uniforms.uSky.value = lighting.uniforms.uSkyColor.value.g * 1.6;
  materials.neck.emissiveIntensity = lighting.uniforms.uSkyColor.value.g * 0.9;
  // Terminal Dogma at night: the room's electric light and lamps fade to a glimmer while the
  // exposure holds, so the hall goes dark round the spotlit cross (building/dogma.js)
  // (the hall's own light is scaled in the shaders by uRoom; setTime does not always recompute
  // uElectric, so it must not be scaled here)
  const stage = dogma ? dogma.updateStage(lighting.night, clock.hour) : 0;
  const blackout = dogma ? dogma.blackout : 0;
  const room = (1 - (1 - STAGE.room) * stage) * (1 - blackout);
  lighting.uniforms.uRoom.value = room;
  materials.vaultLamp.color.setRGB(1.0, 0.95, 0.88).multiplyScalar((lighting.uniforms.uSkyColor.value.g * 3 + lighting.night * 0.6) * room);
  materials.warmLamp.color.copy(LAMP_BASE.warmLamp).multiplyScalar(room);
  materials.downlight.color.copy(LAMP_BASE.downlight).multiplyScalar(room);
  materials.knotLamp.uniforms.uLevel.value = room;
  materials.skylight.uniforms.uSky.value *= room;
  materials.neck.emissiveIntensity *= room;
  // hold the exposure as the hall dims, so it really looks darker (the eye would brighten it again)
  post.settings.stageBias = Math.log2(Math.max(room, STAGE.room));
  post.settings.lockWeight = blackout;
  post.settings.lockAverage = STAGE.lockAverage;
}
// While the slider is being dragged, the day cycle holds still under the pointer.
let dragging = false;
timeInput.addEventListener('pointerdown', () => (dragging = true));
addEventListener('pointerup', () => (dragging = false));
timeInput.addEventListener('input', () => {
  clock.live = false;
  clock.hour = Number(timeInput.value) % 24;
  applyTime();
});
document.getElementById('time-live').addEventListener('click', () => {
  setCycle(false);
  clock.live = true;
  applyTime();
});

// Day cycle: ▶ runs the clock through all 24 hours and loops; ❚❚ stops it
// where it is, for the slider to take over.
// The pace slider: real seconds for one hour of daylight, from slow (a minute) to fast (half a
// second). The default, five seconds, plays a whole day in about a minute and a half.
const PACES = [60, 30, 20, 10, 5, 3, 2, 1, 0.5];
const paceInput = document.getElementById('time-pace');
const paceLabel = document.getElementById('time-pace-label');
let pace = PACES.includes(state.dayPace) ? state.dayPace : 5;
function showPace() {
  paceInput.value = PACES.indexOf(pace);
  paceLabel.textContent = `1 h · ${pace} s`;
}
paceInput.addEventListener('input', () => {
  pace = PACES[Number(paceInput.value)];
  showPace();
  saveState({ ...loadState(), dayPace: pace });
});
// after a drag, let go of the focus so WASD walks again straight away (the walker ignores keys
// while a slider has the focus)
paceInput.addEventListener('pointerup', () => paceInput.blur());
showPace();
// Night runs faster: between dusk and dawn only the electric light is on and nothing changes, so
// the clock speeds up once the sun is well below the horizon (full speed past -7°, the dark side
// of civil twilight) and slows back to normal before the sky starts to brighten. Sunrise and
// sunset themselves always play at the normal pace.
const NIGHT_SPEED = 6;
const cycleButton = document.getElementById('time-cycle');
let cycling = false;
let cycleSaved = 0;
function setCycle(on) {
  cycling = on;
  lighting.continuous = on;
  if (!on) lighting.dirty = true; // when it stops, one full update so the bounced light is exact
  cycleButton.textContent = on ? '❚❚' : '▶';
  cycleButton.setAttribute('aria-pressed', String(on));
  cycleButton.title = t(on ? 'time.stop' : 'time.play');
  if (on) clock.live = false;
  applyTime();
}
cycleButton.addEventListener('click', () => setCycle(!cycling));
function stepCycle(dt) {
  if (!cycling || dragging) return;
  const dark = 1 - THREE.MathUtils.smoothstep(lighting.sun.elevation, -0.12, -0.05);
  const speed = 1 + (NIGHT_SPEED - 1) * dark;
  clock.hour = (clock.hour + (speed / pace) * dt) % 24;
  cycleSaved += dt;
  // the lighting follows every frame; while playing it re-gathers the costly bounced light only a
  // few times a second (lighting.continuous, see render/lighting.js)
  applyTime({ save: cycleSaved > 2 }); // the clock is stored every couple of seconds, not every frame
  if (cycleSaved > 2) cycleSaved = 0;
}

// Arrow keys on the hour and date sliders: a tap moves one minute (one day);
// holding the key glides smoothly instead of jumping, so the light can be
// watched as it changes. Holding Shift glides (and taps) five times faster,
// and can be pressed or released in the middle of a glide.
function glideKeys(input, { tap, perSecond, get, set }) {
  const ARROWS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
  let dir = 0;
  let held = null; // the arrow key being held
  let fast = false;
  let last = 0;
  const tick = (t) => {
    if (!dir) return;
    const dt = THREE.MathUtils.clamp((t - last) / 1000, 0, 0.1);
    last = Math.max(last, t);
    set(get() + dir * perSecond * (fast ? 5 : 1) * dt);
    requestAnimationFrame(tick);
  };
  input.addEventListener('keydown', (e) => {
    fast = e.shiftKey;
    const d = ARROWS[e.key];
    if (!d) return;
    e.preventDefault();
    if (!e.repeat) {
      held = e.key;
      set(get() + d * tap * (fast ? 5 : 1));
    } else if (dir !== d) {
      const start = !dir;
      dir = d;
      held = e.key;
      last = performance.now();
      if (start) requestAnimationFrame(tick);
    }
  });
  input.addEventListener('keyup', (e) => {
    fast = e.shiftKey;
    // releasing Shift keeps the glide going at normal speed; only the arrow stops it
    if (e.key === held) {
      dir = 0;
      held = null;
    }
  });
  input.addEventListener('blur', () => {
    dir = 0;
    held = null;
    fast = false;
  });
}
glideKeys(timeInput, {
  tap: 1 / 60,
  perSecond: 0.25, // a quarter of an hour per second
  get: () => clock.hour,
  set: (v) => {
    clock.live = false;
    clock.hour = ((v % 24) + 24) % 24; // wraps past midnight
    applyTime();
  },
});
applyTime();
// On entry the day plays by itself, from the current time (or the last one chosen), so walking
// around shows the light changing. A link with ?hour= (review stills) keeps the clock still.
if (!params.has('hour')) setCycle(true);

// ------------------------------------------------------------------ music

step('load.bake');
await breathe();
const baked = await attachBakedLight(basilica, lighting).catch((e) => ({ ok: false, reason: String(e) }));
if (baked.ok) post.settings.ao = 0.45; // the bake already holds the large-scale occlusion
console.info('baked light', baked);

step('load.library');
await breathe();
let catalog = { albums: [], summary: {} };
try {
  catalog = await (await fetch('/api/catalog')).json();
} catch {
  /* the basilica still works without a catalog */
}
const audio = new AudioPlayer();
audio.volume = state.volume ?? 0.8;
const exhibition = new Exhibition(scene, lighting, materials, basilica.colliders);
const ui = new Interface({ catalog, audio, exhibition, walker, lighting, camera, canvas });
walker.onNotice = (text) => ui.toast(text);
exhibition.page = state.page ?? 0;
exhibition.setAlbums(catalog.albums);
const lastAlbum = catalog.albums.find((a) => a.id === state.album);
// Nothing played before: the built-in 1923 recording of the Ode to Joy is ready (it starts with the
// first click, since browsers only allow sound after a gesture).
const builtIn = catalog.albums.find((a) => a.builtIn);
if (lastAlbum) audio.playAlbum(lastAlbum, Math.max(0, state.index ?? 0), state.position ?? 0, false);
else if (builtIn) {
  audio.playAlbum(builtIn, 0, 0, false);
  canvas.addEventListener('pointerdown', () => audio.el.paused && audio.play(), { once: true });
}

// settings
const settings = { reverb: state.reverb ?? 0, exposure: state.exposure ?? 0, shafts: state.shafts ?? 1 };
// Each slider shows its value ("0 = normal" for exposure) and can be reset.
const DEFAULTS = { reverb: 0, exposure: 0, shafts: 1 };
const FORMAT = {
  reverb: (v) => (v === 0 ? t('out.off') : `${Math.round(v * 100)}%`),
  exposure: (v) => (v === 0 ? t('out.normal') : t('out.stops', { v: `${v > 0 ? '+' : ''}${v.toFixed(1)}` })),
  shafts: (v) => `${Math.round(v * 100)}%`,
};
const rangeBindings = {};
const bindRange = (id, key, apply) => {
  const el = document.getElementById(id);
  const out = document.querySelector(`output[for="${id}"]`);
  const set = (v) => {
    settings[key] = v;
    el.value = v;
    out.textContent = FORMAT[key](v);
    apply(v);
  };
  set(settings[key]);
  el.addEventListener('input', () => {
    set(Number(el.value));
    saveState({ ...loadState(), [key]: settings[key] });
  });
  rangeBindings[key] = set;
};
bindRange('set-reverb', 'reverb', (v) => audio.setReverb(v));
bindRange('set-exposure', 'exposure', (v) => (post.settings.exposureBias = v));
bindRange('set-shafts', 'shafts', (v) => (post.settings.shafts = v));
// The altar canopy (baldachin) can be taken down: the canopy, its lamps and the crucifix below
// it hide together. Its lamps are glowing spheres, not lights, so nothing of it stays behind in
// the lighting or in the floor reflection.
const canopyInput = document.getElementById('set-canopy');
const canopyLabel = document.querySelector('output[for="set-canopy"]');
const setCanopy = (show) => {
  basilica.baldachin.visible = show;
  lighting.dirty = true; // redraw the sun maps and bounce light without (or with) its shadow
  canopyInput.checked = show;
  canopyLabel.textContent = t(show ? 'out.shown' : 'out.hidden');
};
setCanopy(state.canopy ?? true);
canopyInput.addEventListener('change', () => {
  setCanopy(canopyInput.checked);
  saveState({ ...loadState(), canopy: canopyInput.checked });
  canopyInput.blur(); // so WASD walks again straight away
});
// The railings on top of the gallery parapets can be hidden, for an open view over the parapets
// (hidden by default; the parapets themselves stay, and still stop one falling).
const railingsInput = document.getElementById('set-railings');
const railingsLabel = document.querySelector('output[for="set-railings"]');
const setRailings = (show) => {
  for (const n of ['gallery-railings', 'gallery-end-railings']) basilica.group.getObjectByName(n).visible = show;
  railingsInput.checked = show;
  railingsLabel.textContent = t(show ? 'out.shown' : 'out.hidden');
  lighting.dirty = true;
};
setRailings(state.railings ?? false);
railingsInput.addEventListener('change', () => {
  setRailings(railingsInput.checked);
  saveState({ ...loadState(), railings: railingsInput.checked });
  railingsInput.blur();
});

// Terminal Dogma: Lilith on her cross behind the altar (building/dogma.js), off by default and
// loaded only when first switched on.
dogma = new TerminalDogma({ scene, materials, lighting, colliders: basilica.colliders, sunLayer: LAYERS.sunBlocker, renderer });
const dogmaInput = document.getElementById('set-dogma');
const dogmaLabel = document.querySelector('output[for="set-dogma"]');
async function setDogma(on) {
  dogmaInput.checked = on;
  dogmaLabel.textContent = t(on ? 'out.loading' : 'out.off');
  try {
    await dogma.setVisible(on);
    for (const m of dogma.noReflect) if (!notReflected.includes(m)) notReflected.push(m);
    applyTime({ save: false }); // the stage lighting follows at once
    dogmaLabel.textContent = t(dogmaInput.checked ? 'out.on' : 'out.off');
  } catch (e) {
    console.error(e);
    dogmaInput.checked = false;
    dogmaLabel.textContent = t('out.failed');
  }
}
setDogma(state.dogma ?? false);
dogmaInput.addEventListener('change', () => {
  setDogma(dogmaInput.checked);
  saveState({ ...loadState(), dogma: dogmaInput.checked });
  dogmaInput.blur();
});
const dayInput = document.getElementById('set-day');
const dayLabel = document.getElementById('set-day-label');
const showDay = () => {
  const d = clock.day || dayOfYear(new Date());
  dayInput.value = Math.round(d);
  dayLabel.textContent = clock.day ? new Date(Date.UTC(2026, 0, Math.round(d))).toLocaleDateString(LOCALE[i18n.lang], { day: 'numeric', month: 'short' }) : t('out.today');
};
dayInput.addEventListener('input', () => {
  clock.day = Number(dayInput.value);
  showDay();
  applyTime();
});
glideKeys(dayInput, {
  tap: 1,
  perSecond: 4, // four days per second; the sun's path shifts continuously
  get: () => clock.day || dayOfYear(new Date()),
  set: (v) => {
    clock.day = ((((v - 1) % 365) + 365) % 365) + 1;
    showDay();
    applyTime();
  },
});
showDay();
onLangChange(() => {
  for (const [key, set] of Object.entries(rangeBindings)) set(settings[key]);
  setCanopy(basilica.baldachin.visible);
  setRailings(basilica.group.getObjectByName('gallery-railings').visible);
  dogmaLabel.textContent = t(dogmaInput.checked ? 'out.on' : 'out.off');
  showDay();
  cycleButton.title = t(cycling ? 'time.stop' : 'time.play');
  applyTime({ save: false, light: false });
});
document.getElementById('reset-settings').addEventListener('click', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) rangeBindings[key](value);
  setCanopy(true);
  setDogma(false);
  clock.day = 0;
  showDay();
  applyTime();
  saveState({ ...loadState(), ...DEFAULTS, canopy: true, dogma: false });
});
const qualitySelect = document.getElementById('set-quality');
qualitySelect.value = quality;
qualitySelect.addEventListener('change', () => saveState({ ...loadState(), quality: qualitySelect.value }));
const toggle = (id, show) => (document.getElementById(id).hidden = !show);
document.getElementById('open-settings').addEventListener('click', () => toggle('settings', true));
document.getElementById('close-settings').addEventListener('click', () => toggle('settings', false));
document.getElementById('open-library').addEventListener('click', () => ui.toggleLibrary());
document.getElementById('open-help').addEventListener('click', () => document.body.classList.toggle('help-open'));
document.getElementById('close-help').addEventListener('click', () => document.body.classList.remove('help-open'));
document.addEventListener('pointerlockchange', () => document.body.classList.toggle('locked', document.pointerLockElement === canvas));

// One small line above the bottom bar, only when it helps: just after the mouse is captured,
// "Esc frees the cursor" for a few seconds (longer the first three times); while the cursor is
// free and no panel is open, "click the scene to return". Translated, and gone when not needed.
const mouseHint = document.getElementById('mousehint');
let hintShown = '';
let escUntil = 0;
let escSeen = 0;
try {
  escSeen = Number(localStorage.getItem('sagrada-x-lilith.escHints')) || 0;
} catch {}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) return (escUntil = 0);
  escUntil = performance.now() + (escSeen < 3 ? 4000 : 2000);
  escSeen++;
  try {
    localStorage.setItem('sagrada-x-lilith.escHints', String(escSeen));
  } catch {}
});
function updateMouseHint(now) {
  const b = document.body.classList;
  const panel = b.contains('library-open') || b.contains('help-open') || !document.getElementById('settings').hidden || !!document.getElementById('loading');
  const want = b.contains('locked') ? (now < escUntil ? 'hint.esc' : '') : panel || walker.seat ? '' : 'hint.click';
  if (want === hintShown) return;
  hintShown = want;
  if (want) mouseHint.innerHTML = t(want);
  mouseHint.classList.toggle('on', !!want);
}
onLangChange(() => hintShown && (mouseHint.innerHTML = t(hintShown)));
if (!state.seenHelp) {
  document.body.classList.add('help-open');
  saveState({ ...loadState(), seenHelp: true });
}
addEventListener('beforeunload', () => ui.persist());

// ------------------------------------------------------------------ loop

step('load.light');
await breathe();
let last = performance.now();
let liveTimer = 0;
let fpsFrames = 0;
let fpsTime = 0;
let elapsed = 0;
function frame(now) {
  const realDt = (now - last) / 1000;
  updateMouseHint(now);
  const dt = Math.min(0.05, realDt);
  last = now;
  elapsed += dt;
  liveTimer += dt;
  if (clock.live && liveTimer > 30) {
    liveTimer = 0;
    applyTime();
  }
  stepCycle(dt);
  walker.enabled = !document.body.classList.contains('library-open');
  walker.update(dt);
  stairInside.visible = nearStair(camera.position);
  exhibition.update(camera, elapsed);
  ui.updateHover();
  lighting.update(scene, lights);
  reflection.render(scene, camera, notReflected);
  post.render(scene, camera);
  fpsFrames++;
  fpsTime += realDt; // real time: dt is capped at 1/20 s, which made a slow scene read as 20 fps
  if (fpsTime > 1) {
    document.getElementById('fps').textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
    fpsFrames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const loading = document.getElementById('loading');
loading.style.opacity = 0;
setTimeout(() => loading.remove(), 900);

// Review hook: place the camera precisely and save stills for comparison.
window.basilica = {
  view(x, y, z, yaw, pitch) {
    walker.fly = true;
    walker.flyPosition.set(x, y, z);
    walker.yaw = yaw;
    walker.pitch = pitch;
  },
  walk(x, z, yaw, pitch) {
    walker.teleport(x, z, yaw, pitch);
  },
  time(hour, day) {
    setCycle(false);
    clock.live = false;
    clock.hour = hour;
    if (day) clock.day = day;
    applyTime();
  },
  // Render a still and save it to review/captures/<name>.png.
  // Film renders (video/): one frame at a time, lighting fully settled,
  // exposure scripted by the caller (see review/film.js).
  film: {
    begin(width, height) {
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      post.setSize(width, height, 1);
      reflection.setSize(width, height);
      this.size = [width, height];
    },
    // camera and the moving cover are set by the caller first
    settle(time) {
      walker.update(0);
      exhibition.update(camera, time);
      for (let i = 0; i < 10; i++) {
        lighting.update(scene, lights);
        if (!lighting.dirty && !lighting.giPending) break;
      }
    },
    // the eye's instant reading of this view (scene average luminance)
    meter() {
      post.settings.fixedAverage = 0;
      post.instantExposure = true;
      reflection.render(scene, camera, notReflected);
      post.render(scene, camera);
      post.instantExposure = false;
      const v = new Float32Array(4);
      renderer.readRenderTargetPixels(post.lastAdapt, 0, 0, 1, 1, v);
      return v[0];
    },
    // render with the given exposure and return the RGBA pixels (bottom-up)
    frame(average) {
      post.settings.fixedAverage = average;
      for (let i = 0; i < 2; i++) {
        reflection.render(scene, camera, notReflected);
        post.render(scene, camera);
      }
      const [w, h] = this.size;
      renderer.setRenderTarget(null);
      const gl = renderer.getContext();
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    },
    end() {
      post.settings.fixedAverage = 0;
      resize();
    },
  },
  async capture(name, width = 1600, height = 900) {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    post.setSize(width, height, 1);
    reflection.setSize(width, height);
    walker.update(0);
    exhibition.update(camera, elapsed);
    // let the bounce light finish, then meter this view instantly
    for (let i = 0; i < 12; i++) {
      lighting.update(scene, lights);
      post.instantExposure = i > 8;
      reflection.render(scene, camera, notReflected);
      post.render(scene, camera);
    }
    post.instantExposure = false;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await fetch(`/api/capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    resize();
    return `${width}x${height}`;
  },
  post,
  reflection,
  lighting,
  renderer,
  scene,
  camera,
  ui,
  walker,
  building: basilica,
  dogma,
  setDogma,
  baked: () => baked,
  async exportBake() {
    const { exportBake } = await import('./render/bake-export.js');
    const r = await exportBake({ building: basilica, lighting, scene });
    applyTime();
    return r;
  },
  audio,
  exhibition,
};
