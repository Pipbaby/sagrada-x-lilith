// Album covers on slim bronze stands in the outer side aisles, beneath the
// choir galleries — twelve along each side, facing the nave. They are ordinary
// lit surfaces, so coloured light from the windows falls across them.
//
// A cover can also be taken off its stand and floated into warm, cool or clear
// sunlight (see sunlight.js), where it hovers, turning slowly to the listener.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M } from '../building/plan.js';

export const PAGE_SIZE = 24;
const COVER = 0.92;

function slots() {
  const list = [];
  for (const side of [1, -1]) {
    for (let k = 0; k < 6; k++) {
      for (const dz of [-1.6, 1.6]) {
        const z = 3.75 + k * M + dz;
        // stand against the outer aisle, facing into the nave
        list.push({ x: side * 20.2, z, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, side });
      }
    }
  }
  return list;
}
export const SLOTS = slots();

function labelTexture(album) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1712';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#e8dcc2';
  g.font = '600 34px "Segoe UI", "Microsoft YaHei", sans-serif';
  const title = album.title.length > 26 ? album.title.slice(0, 25) + '…' : album.title;
  g.fillText(title, 24, 62);
  g.fillStyle = '#b8a888';
  g.font = '26px "Segoe UI", "Microsoft YaHei", sans-serif';
  const artist = album.artist.length > 32 ? album.artist.slice(0, 31) + '…' : album.artist;
  g.fillText(artist + (album.year ? `  ·  ${album.year}` : ''), 24, 110);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Exhibition {
  constructor(scene, lighting, materials, colliders) {
    this.scene = scene;
    this.lighting = lighting;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.loader = new THREE.TextureLoader();
    this.items = [];
    this.page = 0;
    this.albums = [];
    this.floating = null;

    // shared stand geometry: base, post, bracket
    const bronze = new THREE.MeshStandardMaterial({ color: 0x3b2c1c, roughness: 0.45, metalness: 0.85 });
    bronze.userData.albedo = new THREE.Color(0.18, 0.12, 0.07);
    lighting.patch(bronze, 'bronze');
    const base = new THREE.CylinderGeometry(0.28, 0.32, 0.05, 32).translate(0, 0.025, 0);
    const post = new THREE.CylinderGeometry(0.022, 0.03, 1.05, 12).translate(0, 0.55, -0.06);
    const bracket = new THREE.BoxGeometry(COVER + 0.06, 0.03, 0.05).translate(0, 1.07, -0.02);
    const standGeo = mergeGeometries([base, post, bracket]);
    const stands = new THREE.InstancedMesh(standGeo, bronze, SLOTS.length);
    SLOTS.forEach((s, i) => {
      stands.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.yaw, 0)), new THREE.Vector3(1, 1, 1)));
      colliders.push({ type: 'box', minX: s.x - 0.35, maxX: s.x + 0.35, minZ: s.z - 0.55, maxZ: s.z + 0.55, height: 2 });
    });
    stands.frustumCulled = false;
    this.group.add(stands);

    this.coverGeo = new THREE.PlaneGeometry(COVER, COVER);
    this.backGeo = new THREE.BoxGeometry(COVER + 0.04, COVER + 0.04, 0.03);
    this.labelGeo = new THREE.PlaneGeometry(0.62, 0.195);
    this.frameMat = bronze;
  }

  setAlbums(albums) {
    this.albums = albums;
    this.showPage(Math.min(this.page, this.pageCount - 1));
  }

  get pageCount() {
    return Math.max(1, Math.ceil(this.albums.length / PAGE_SIZE));
  }

  pageOf(album) {
    const i = this.albums.indexOf(album);
    return i < 0 ? -1 : Math.floor(i / PAGE_SIZE);
  }

  clear() {
    for (const it of this.items) {
      it.group.removeFromParent();
      it.cover.material.map?.dispose();
      it.cover.material.dispose();
      it.label.material.map?.dispose();
      it.label.material.dispose();
    }
    this.items = [];
  }

  showPage(page) {
    this.page = (page + this.pageCount) % this.pageCount;
    this.returnFloating(true);
    this.clear();
    const albums = this.albums.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    albums.forEach((album, i) => {
      const s = SLOTS[i];
      const group = new THREE.Group();
      group.position.set(s.x, 0, s.z);
      group.rotation.y = s.yaw;
      const holder = new THREE.Group();
      holder.position.set(0, 1.58, 0);
      holder.rotation.x = -0.14; // tilted back like a lectern
      const back = new THREE.Mesh(this.backGeo, this.frameMat);
      back.position.z = -0.02;
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });
      mat.userData.albedo = new THREE.Color(0.35, 0.33, 0.3);
      this.lighting.patch(mat, 'cover');
      const cover = new THREE.Mesh(this.coverGeo, mat);
      cover.userData.album = album;
      holder.add(back, cover);
      const labelMat = new THREE.MeshStandardMaterial({ map: labelTexture(album), roughness: 0.7 });
      labelMat.userData.albedo = new THREE.Color(0.1, 0.09, 0.07);
      this.lighting.patch(labelMat, 'label');
      const label = new THREE.Mesh(this.labelGeo, labelMat);
      label.position.set(0, 0.97, 0.03);
      label.rotation.x = -0.5;
      group.add(holder, label);
      this.group.add(group);
      const item = { album, slot: s, group, holder, cover, label };
      this.loadCover(item, false);
      this.items.push(item);
      group.traverse((o) => o.isMesh && o.layers.enable(1));
    });
    this.dispatchPage?.();
  }

  loadCover(item, full) {
    const url = full ? item.album.cover : item.album.thumb || item.album.cover;
    if (!url) {
      item.cover.material.color.set(0x5a5148);
      return;
    }
    if (item.url === url) return;
    item.url = url;
    this.loader.load(url, (t) => {
      if (item.url !== url) return t.dispose();
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      item.cover.material.map?.dispose();
      item.cover.material.map = t;
      item.cover.material.needsUpdate = true;
      const img = t.image;
      const a = img.width / img.height;
      item.cover.scale.set(a >= 1 ? 1 : a, a >= 1 ? 1 / a : 1, 1);
    });
  }

  // Load full-resolution art for covers near the camera.
  update(camera, time) {
    for (const it of this.items) {
      const d = camera.position.distanceTo(it.group.position);
      this.loadCover(it, d < 7);
    }
    const f = this.floating;
    if (f) {
      f.t = Math.min(1, f.t + 0.012);
      const e = f.t * f.t * (3 - 2 * f.t);
      const p = new THREE.Vector3().lerpVectors(f.from, f.to, e);
      p.y += Math.sin(Math.PI * e) * 1.2 + Math.sin(time * 1.3) * 0.04 * e;
      f.item.holder.position.copy(f.item.group.worldToLocal(p.clone()));
      // turn to face the listener once it arrives
      const look = new THREE.Vector3(camera.position.x, p.y, camera.position.z);
      const target = new THREE.Object3D();
      target.position.copy(p);
      target.lookAt(look);
      const q = f.item.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(target.quaternion);
      f.item.holder.quaternion.slerp(q, 0.06);
    }
  }

  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.items.map((i) => i.cover), false);
    return hits[0] ? this.items.find((i) => i.cover === hits[0].object) : null;
  }

  itemFor(album) {
    return this.items.find((i) => i.album === album) || null;
  }

  // Float a cover to a point (world x, z) and hold it there.
  float(item, x, z) {
    if (this.floating && this.floating.item !== item) this.returnFloating(true);
    const from = item.holder.getWorldPosition(new THREE.Vector3());
    this.floating = { item, from, to: new THREE.Vector3(x, 1.75, z), t: 0 };
  }

  returnFloating(immediate = false) {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    f.item.holder.position.set(0, 1.58, 0);
    f.item.holder.rotation.set(-0.14, 0, 0);
    void immediate;
  }

  // A point in front of a stand, for walking the listener there.
  viewpoint(item) {
    const s = item.slot;
    return { x: s.x - s.side * 2.3, z: s.z, yaw: s.side > 0 ? Math.PI / 2 : -Math.PI / 2 };
  }
}
