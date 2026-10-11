// First-person walking with collisions, and a free-flying camera for looking
// at the vaults up close.
//
// Keys:
//   W A S D walk · Shift hurry · double-tap Shift (while walking forward) sprint
//   C tap: stand ⇄ crouch (prone → crouch) · C hold: next of stand → crouch → prone
//   C while sprinting: slide; C again while sliding: stop the slide
//   Space jump (or stand up from crouch / prone) · E sit on a pew / stand up
//   F free camera (Space / C rise / sink)

import * as THREE from 'three';
import { t } from '../i18n.js';

export const EYE_HEIGHTS = { stand: 1.62, crouch: 1.0, prone: 0.32 };
const STANCES = ['stand', 'crouch', 'prone'];
const SPEED = { walk: 2.5, hurry: 4.5, sprint: 6.5, crouch: 1.55, prone: 1.0 };
const RADIUS = 0.3;
const GRAVITY = 11.8;
const JUMP = 4.8;
const HOLD = 0.6; // seconds of holding C before the stance moves on
const DOUBLE_TAP = 0.32;
const SLIDE_TIME = 0.85;
const SLIDE_EYE = 0.65;
const SEATED_EYE = 0.74; // above the seat

// C: a short press toggles, a long hold steps through the stances.
export class StanceGesture {
  constructor() {
    this.clear();
  }
  down(time) {
    if (this.started === null) {
      this.started = time;
      this.consumed = false;
    }
  }
  update(time, stance) {
    if (this.started !== null && !this.consumed && time - this.started >= HOLD) {
      this.consumed = true;
      return STANCES[(STANCES.indexOf(stance) + 1) % 3];
    }
    return null;
  }
  up(stance) {
    const short = this.started !== null && !this.consumed;
    this.clear();
    return short ? (stance === 'crouch' ? 'stand' : 'crouch') : null;
  }
  clear() {
    this.started = null;
    this.consumed = false;
  }
}

export class Walker {
  // env: the place being walked (see basilica-env.js): floorAt, standable,
  // inside, ceilingAt, minFlyY
  constructor(camera, dom, colliders, seats = [], env) {
    this.env = env;
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.seats = seats;
    this.position = new THREE.Vector3(0, 0, 3); // feet
    this.headY = 0; // the feet's height as the camera follows it (smoothed over steps)
    this.yaw = 0; // 0 = looking towards the apse (+z)
    this.pitch = 0.08;
    this.fly = false;
    this.flyPosition = new THREE.Vector3();
    this.keys = new Set();
    this.velocityY = 0;
    this.grounded = true;
    this.stance = 'stand';
    this.eye = EYE_HEIGHTS.stand;
    this.gesture = new StanceGesture();
    this.sprinting = false;
    this.lastShiftTap = -Infinity;
    this.slide = null;
    this.motion = { x: 0, z: 0 };
    this.seat = null;
    this.onNotice = null; // (text) => void
    this.enabled = true;
    this.dragging = false;

    addEventListener('keydown', (e) => this.keyDown(e));
    addEventListener('keyup', (e) => this.keyUp(e));
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => document.hidden && this.clear());
    dom.addEventListener('mousedown', (e) => {
      if (e.button === 0 && document.pointerLockElement !== dom) this.dragging = true;
    });
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (!this.enabled || this.lookBlocked) return; // lookBlocked: the mouse is busy with something else (e.g. turning a hologram)
      if (document.pointerLockElement === dom || this.dragging) this.look(e.movementX, e.movementY);
    });
  }

  get now() {
    return performance.now() / 1000;
  }

  clear() {
    this.keys.clear();
    this.gesture.clear();
    this.sprinting = false;
    this.lastShiftTap = -Infinity;
    this.slide = null;
  }

  notice(text) {
    this.onNotice?.(text);
  }

  keyDown(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.enabled) return;
    if (['KeyC', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'KeyF') {
      this.toggleFly();
      return;
    }
    if (this.fly) return;
    if (this.seat) {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) this.leaveSeat();
      return;
    }
    if (e.code.startsWith('Shift')) {
      // double-tap Shift while walking forward, standing, on the ground: sprint
      const now = this.now;
      const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp')) && !this.keys.has('KeyS');
      if (forward && this.stance === 'stand' && this.grounded) {
        if (now - this.lastShiftTap <= DOUBLE_TAP) {
          this.sprinting = true;
          this.lastShiftTap = -Infinity;
        } else this.lastShiftTap = now;
      } else this.lastShiftTap = -Infinity;
    }
    if (e.code === 'KeyC') {
      if (this.slide) {
        this.endSlide();
        return;
      }
      if (this.sprinting && this.grounded && Math.hypot(this.motion.x, this.motion.z) > 2.5) {
        this.beginSlide();
        return;
      }
      this.sprinting = false;
      this.gesture.down(this.now);
    }
    if (e.code === 'Space' && this.grounded) {
      if (this.slide) this.endSlide();
      if (this.stance !== 'stand') {
        this.changeStance('stand');
        return;
      }
      this.velocityY = JUMP;
      this.grounded = false;
    }
  }

  keyUp(e) {
    this.keys.delete(e.code);
    if (e.code === 'KeyC' && !this.fly && !this.seat) {
      const next = this.gesture.up(this.stance);
      if (next) this.changeStance(next);
    }
  }

  changeStance(next) {
    this.stance = next;
    if (next !== 'stand') this.sprinting = false;
  }

  beginSlide() {
    const speed = Math.hypot(this.motion.x, this.motion.z);
    this.slide = { x: this.motion.x / speed, z: this.motion.z / speed, age: 0, speed: Math.max(SPEED.sprint, speed) };
    this.sprinting = false;
    this.gesture.clear();
    this.changeStance('crouch');
  }

  endSlide() {
    this.slide = null;
    this.sprinting = false;
    this.gesture.clear();
    this.motion = { x: 0, z: 0 };
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.5, 1.5);
  }

  toggleFly() {
    if (this.seat) this.leaveSeat();
    this.fly = !this.fly;
    this.endSlide();
    if (this.fly) this.flyPosition.copy(this.position).setY(this.position.y + this.eye);
  }

  // Can a body stand at (x, z)? Inside the building and clear of obstacles.
  free(x, z, y = 0) {
    if (!this.env.standable(x, z, RADIUS)) return false;
    for (const c of this.colliders) {
      if (c.type === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + RADIUS) return false;
      } else if (c.type === 'shape') {
        // any footprint with its own height (a curved stair): too high to step onto blocks
        const h = c.heightAt(x, z, y);
        if (h !== null && y < h - 0.25) return false;
      } else if (y < (c.height ?? 3) - 0.015 && x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS) {
        return false;
      }
    }
    return true;
  }

  // Highest thing to stand on under the body: the floor, or the top of a
  // pew one has jumped onto.
  groundAt(x, z, y) {
    let g = this.env.floorAt(x, z);
    for (const c of this.colliders) {
      if (c.type === 'shape') {
        const h = c.heightAt(x, z, y);
        if (h !== null && h < y + 0.26 && h > g) g = h;
        continue;
      }
      if (c.type === 'box' && (c.height ?? 3) < y + 0.22 && (c.height ?? 3) > g && x > c.minX - RADIUS * 0.8 && x < c.maxX + RADIUS * 0.8 && z > c.minZ - RADIUS * 0.8 && z < c.maxZ + RADIUS * 0.8) g = c.height;
    }
    return g;
  }

  // ------------------------------------------------------------ pews

  // The seat being looked at, within reach (for E).
  seatInReach() {
    if (this.fly || this.seat || !this.grounded) return null;
    const p = this.position;
    const view = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
    let best = null;
    let bestScore = Infinity;
    for (const s of this.seats) {
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6 || Math.abs(this.env.floorAt(s.x, s.z) - p.y) > 0.6) continue;
      const facing = d > 0.01 ? (dx * view.x + dz * view.y) / d : 1;
      if (facing < 0.2) continue;
      const score = d * (1.6 - facing);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  sit(seat = this.seatInReach()) {
    if (!seat) return false;
    this.seat = seat;
    this.endSlide();
    this.stance = 'stand';
    this.velocityY = 0;
    this.yaw = seat.yaw ?? 0; // towards the altar, unless the seat says otherwise
    this.pitch = 0.04;
    this.notice(t('walk.seated'));
    return true;
  }

  leaveSeat() {
    const s = this.seat;
    if (!s) return;
    const exits = [...s.exits].sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x));
    const exit = exits.find((p) => this.free(p.x, p.z));
    if (!exit) {
      this.notice(t('walk.noRoom'));
      return;
    }
    this.seat = null;
    this.position.set(exit.x, this.env.floorAt(exit.x, exit.z), exit.z);
    this.keys.clear();
  }

  // ------------------------------------------------------------ camera

  // The free camera may cross the nave and pass through columns, but never
  // leave the building: outside there is no sky, and the exposure jump on
  // re-entering flashed the whole screen white.
  keepInside(p, prev) {
    const inside = this.env.inside;
    if (!inside(p.x, p.z)) {
      if (inside(p.x, prev.z)) p.z = prev.z;
      else if (inside(prev.x, p.z)) p.x = prev.x;
      else {
        p.x = prev.x;
        p.z = prev.z;
      }
    }
    // Above a lower vault the wall between is solid: stop rather than drop.
    const ceilingAt = this.env.ceilingAt;
    if (ceilingAt(p.x, p.z) < p.y && ceilingAt(prev.x, prev.z) >= prev.y - 0.01) {
      p.x = prev.x;
      p.z = prev.z;
    }
    const low = this.env.minFlyY(p.x, p.z);
    p.y = THREE.MathUtils.clamp(p.y, low, Math.max(low, ceilingAt(p.x, p.z)));
  }

  teleport(x, z, yaw = this.yaw, pitch = this.pitch) {
    this.fly = false;
    this.seat = null;
    this.stance = 'stand';
    this.eye = EYE_HEIGHTS.stand;
    this.velocityY = 0;
    this.grounded = true;
    this.endSlide();
    this.position.set(x, this.env.floorAt(x, z), z);
    this.headY = this.position.y;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forward);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forward);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right);
    }
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    if (this.fly) {
      const prev = this.flyPosition.clone();
      const speed = fast ? 14 : 5;
      if (move.lengthSq()) move.normalize();
      const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      const fwd = move.dot(forward);
      const side = move.clone().sub(forward.clone().multiplyScalar(fwd));
      this.flyPosition.addScaledVector(dir, fwd * speed * dt).addScaledVector(side, speed * dt);
      if (this.keys.has('Space')) this.flyPosition.y += speed * dt;
      if (this.keys.has('KeyC')) this.flyPosition.y -= speed * dt;
      this.keepInside(this.flyPosition, prev);
      this.camera.position.copy(this.flyPosition);
    } else if (this.seat) {
      const s = this.seat;
      const target = new THREE.Vector3(s.x, this.env.floorAt(s.x, s.z) + s.seatY + SEATED_EYE, s.z - 0.04);
      this.camera.position.lerp(target, 1 - Math.exp(-dt * 10));
      this.position.set(s.x, this.env.floorAt(s.x, s.z), s.z);
      this.eye = this.camera.position.y - this.position.y;
    } else {
      const next = this.gesture.update(this.now, this.stance);
      if (next) this.changeStance(next);
      const forwardHeld = move.dot(forward) > 0.5;
      if (!forwardHeld || this.stance !== 'stand') this.sprinting = false;
      // small sub-steps so a sprint or slide never skips through an obstacle
      const steps = Math.max(1, Math.ceil(dt * 120));
      for (let i = 0; i < steps; i++) this.walkStep(dt / steps, move, fast);
      this.eye = THREE.MathUtils.lerp(this.eye, this.slide ? SLIDE_EYE : EYE_HEIGHTS[this.stance], 1 - Math.exp(-dt * 13));
      // On steps the feet jump a riser at a time; the head follows them quickly but smoothly,
      // so a stair reads as steps without jolting the view. Falls and jumps are followed at once.
      const dy = this.position.y - this.headY;
      if (this.grounded && Math.abs(dy) < 0.3) this.headY += dy * (1 - Math.exp(-dt * 16));
      else this.headY = this.position.y;
      this.camera.position.set(this.position.x, this.headY + this.eye, this.position.z);
    }
    const target = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.lookAt(this.camera.position.clone().add(target));
  }

  walkStep(dt, move, fast) {
    const p = this.position;
    let speed = this.stance === 'prone' ? SPEED.prone : this.stance === 'crouch' ? SPEED.crouch : this.sprinting ? SPEED.sprint : fast ? SPEED.hurry : SPEED.walk;
    // a spiral stair is climbed at a stair's pace (shape colliders may say so)
    for (const c of this.colliders) if (c.speedAt) speed *= c.speedAt(p.x, p.z);
    let vx = 0;
    let vz = 0;
    if (move.lengthSq()) {
      const m = move.clone().normalize();
      vx = m.x * speed;
      vz = m.z * speed;
    }
    if (this.slide) {
      const s = this.slide;
      s.age += dt;
      const v = s.speed + (SPEED.crouch - s.speed) * Math.min(1, s.age / SLIDE_TIME);
      vx = s.x * v;
      vz = s.z * v;
      if (s.age >= SLIDE_TIME || !this.grounded) this.endSlide();
    }
    this.motion = { x: vx, z: vz };
    // slide along obstacles one axis at a time
    const movedX = vx === 0 || (this.free(p.x + vx * dt, p.z, p.y) && ((p.x += vx * dt), true));
    const movedZ = vz === 0 || (this.free(p.x, p.z + vz * dt, p.y) && ((p.z += vz * dt), true));
    if (this.slide && (!movedX || !movedZ)) this.endSlide();

    const ground = this.groundAt(p.x, p.z, p.y);
    const wasGrounded = this.grounded;
    this.velocityY -= GRAVITY * dt;
    p.y += this.velocityY * dt;
    // walk up steps at once, follow the floor down small steps, fall from higher
    const follows = wasGrounded && this.velocityY <= 0 && p.y - ground <= 0.25;
    if (p.y <= ground || follows) {
      p.y = ground;
      this.velocityY = 0;
      this.grounded = true;
    } else this.grounded = false;
  }
}
