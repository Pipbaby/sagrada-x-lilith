// The interface around the basilica: now-playing bar, library drawer, album
// pages, exhibition paging, light buttons and settings.

import * as THREE from 'three';
import { findLight } from './sunlight.js';
import { t, onLangChange } from '../i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const fmt = (s) => {
  if (!Number.isFinite(s)) return '–:––';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const STORE = 'sagrada-music-state';
export function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}
export function saveState(state) {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {}
}

export class Interface {
  constructor({ catalog, audio, exhibition, walker, lighting, camera, canvas }) {
    Object.assign(this, { catalog, audio, exhibition, walker, lighting, camera, canvas });
    this.byId = new Map(catalog.albums.map((a) => [a.id, a]));
    this.hovered = null;
    this.selected = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 9;
    this.buildNowPlaying();
    this.buildLibrary();
    this.buildExhibitionBar();
    onLangChange(() => {
      this.renderPage?.();
      this.search && this.search.dispatchEvent(new Event('input'));
      const page = document.querySelector('#library .album-page');
      if (this.selected && page && !page.hidden) this.openAlbum(this.selected);
    });
    this.bindKeys();
    this.bindAudio();
    exhibition.dispatchPage = () => this.renderPage();
  }

  // ------------------------------------------------------------------ now playing

  buildNowPlaying() {
    const bar = $('#now');
    bar.innerHTML = `
      <img class="art" alt="" />
      <div class="meta"><div class="title"></div><div class="sub"></div></div>
      <div class="controls">
        <button data-act="prev" data-i18n-title="now.prev">⏮</button>
        <button data-act="toggle" class="play" data-i18n-title="now.toggle">▶</button>
        <button data-act="next" data-i18n-title="now.next">⏭</button>
      </div>
      <div class="seek"><span class="cur">0:00</span><input type="range" min="0" max="1000" value="0" /><span class="dur">–:––</span></div>
      <input class="vol" type="range" min="0" max="1" step="0.01" data-i18n-title="now.volume" />`;
    bar.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'prev') this.audio.previous();
      if (act === 'next') this.audio.next();
      if (act === 'toggle') this.audio.toggle();
    });
    $('.art', bar).addEventListener('click', () => this.audio.album && this.openAlbum(this.audio.album));
    const seek = $('.seek input', bar);
    seek.addEventListener('input', () => {
      const d = Number.isFinite(this.audio.el.duration) ? this.audio.el.duration : this.audio.track?.duration || 0;
      this.audio.seek((seek.value / 1000) * d);
    });
    const vol = $('.vol', bar);
    vol.value = this.audio.volume;
    vol.addEventListener('input', () => {
      this.audio.volume = Number(vol.value);
      this.persist();
    });
  }

  bindAudio() {
    const bar = $('#now');
    const a = this.audio;
    const refresh = () => {
      const album = a.album;
      const tr = a.track;
      $('.title', bar).textContent = tr ? tr.title : t('now.none');
      $('.sub', bar).textContent = tr ? `${tr.artist || album.artist} — ${album.title}` : t('now.hint');
      const art = $('.art', bar);
      art.src = album?.thumb || '';
      art.style.visibility = album?.thumb ? 'visible' : 'hidden';
      $('.play', bar).textContent = a.playing ? '❚❚' : '▶';
      document.querySelectorAll('.tracks li').forEach((li) => li.classList.toggle('current', album && li.dataset.album === album.id && Number(li.dataset.index) === a.index));
    };
    for (const ev of ['trackchange', 'play', 'pause', 'albumchange']) a.addEventListener(ev, refresh);
    a.addEventListener('waiting', () => ($('.sub', bar).textContent = t('now.preparing')));
    const warn = () => {
      const reason = a.silentReason;
      const text = { muted: t('now.muted'), volume: t('now.vol0'), suspended: t('now.suspended') }[reason];
      bar.classList.toggle('silent', !!text);
      bar.dataset.warning = text || '';
    };
    for (const ev of ['play', 'pause', 'volumechange', 'audiostate', 'playing']) a.addEventListener(ev, warn);
    a.el.addEventListener('volumechange', warn);
    const wake = () => {
      if (a.graph && a.graph.ctx.state !== 'running') a.graph.ctx.resume().then(warn, warn);
    };
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    a.addEventListener('playing', refresh);
    a.addEventListener('timeupdate', () => {
      // while a converted track is still streaming the element can't know its length yet
      const d = Number.isFinite(a.el.duration) ? a.el.duration : a.track?.duration;
      $('.cur', bar).textContent = fmt(a.el.currentTime);
      $('.dur', bar).textContent = fmt(d);
      if (d) $('.seek input', bar).value = (a.el.currentTime / d) * 1000;
      if (performance.now() - (this.lastSave || 0) > 4000) this.persist();
    });
    refresh();
    onLangChange(() => {
      refresh();
      warn();
    });
  }

  // ------------------------------------------------------------------ library

  buildLibrary() {
    const lib = $('#library');
    lib.innerHTML = `
      <div class="lib-head">
        <input type="search" data-i18n-placeholder="lib.search" spellcheck="false" />
        <button class="close" data-i18n-title="lib.close">✕</button>
      </div>
      <div class="lib-folder">
        <div class="lf-row"><span class="lf-path"></span><button class="lf-pick"></button></div>
        <div class="lf-manual" hidden><input type="text" spellcheck="false" data-i18n-placeholder="folder.paste" /><button class="lf-go" data-i18n="folder.scan"></button></div>
        <div class="lf-status"></div>
      </div>
      <div class="lib-count"></div>
      <ul class="albums"></ul>
      <section class="album-page" hidden></section>`;
    this.search = $('input', lib);
    this.search.addEventListener('input', () => this.renderResults());
    $('.close', lib).addEventListener('click', () => this.toggleLibrary(false));
    $('.albums', lib).addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) this.openAlbum(this.byId.get(li.dataset.id));
    });
    this.indexCatalog();
    this.renderResults();
    this.buildFolder();
  }

  indexCatalog() {
    this.byId = new Map(this.catalog.albums.map((a) => [a.id, a]));
    // search index: album + artist + track titles, lower-cased
    this.index = this.catalog.albums.map((a) => ({
      album: a,
      text: `${a.title} ${a.artist} ${a.genre || ''} ${a.tracks.map((tr) => tr.title).join(' ')}`.toLowerCase(),
    }));
  }

  // The music folder: chosen with the system's folder dialog (or a pasted path), scanned by the
  // server in the background (tools/scan-library.mjs); the covers go up on the stands when it ends.
  buildFolder() {
    const box = $('#library .lib-folder');
    const status = $('.lf-status', box);
    const manual = $('.lf-manual', box);
    let info = { root: null, scan: {} };
    const show = () => {
      const s = info.scan || {};
      $('.lf-path', box).textContent = info.root ? t('folder.current', { path: info.root }) : t('folder.none');
      $('.lf-path', box).title = info.root || '';
      $('.lf-pick', box).textContent = t(info.root ? 'folder.change' : 'folder.pick');
      $('.lf-pick', box).disabled = !!s.running;
      $('.lf-go', box).disabled = !!s.running;
      status.classList.toggle('error', !!s.error && !s.running);
      if (s.running) status.textContent = s.stage === 'tags' ? t('folder.tags', { done: s.done, total: s.total }) : s.stage === 'covers' ? t('folder.covers', { done: s.done, total: s.total }) : t('folder.files');
      else if (s.error) status.textContent = t('folder.error', { error: s.error.split('\n').pop() });
      else status.textContent = t('folder.note');
    };
    const refresh = async () => {
      try {
        info = await (await fetch('/api/library', { cache: 'no-store' })).json();
      } catch {}
      show();
      return info;
    };
    const poll = async () => {
      const was = info.scan?.finished;
      while ((await refresh()).scan?.running) await new Promise((r) => setTimeout(r, 700));
      if (info.scan?.finished && info.scan.finished !== was && !info.scan.error) {
        this.catalog = await (await fetch('/api/catalog?reload=1', { cache: 'no-store' })).json();
        this.indexCatalog();
        this.exhibition.setAlbums(this.catalog.albums);
        this.renderResults();
        this.toast(t('folder.done', { albums: this.catalog.albums.length - 1 }));
      }
    };
    const start = async (folder) => {
      const r = await fetch('/api/library/scan', { method: 'POST', body: JSON.stringify({ folder }) });
      if (!r.ok) {
        info.scan = { error: await r.text() };
        return show();
      }
      manual.hidden = true;
      poll();
    };
    $('.lf-pick', box).addEventListener('click', async () => {
      status.textContent = t('folder.dialog');
      const r = await (await fetch('/api/library/pick', { method: 'POST' })).json().catch(() => ({ unsupported: true }));
      if (r.unsupported) {
        manual.hidden = false;
        $('input', manual).focus();
        return show();
      }
      if (r.folder) start(r.folder);
      else show();
    });
    $('.lf-go', box).addEventListener('click', () => start($('input', manual).value.trim()));
    $('input', manual).addEventListener('keydown', (e) => e.key === 'Enter' && start(e.target.value.trim()));
    onLangChange(show);
    refresh().then((i) => i.scan?.running && poll());
  }

  renderResults() {
    const q = this.search.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const list = words.length ? this.index.filter((e) => words.every((w) => e.text.includes(w))).map((e) => e.album) : this.catalog.albums;
    const ul = $('#library .albums');
    ul.innerHTML = list
      .slice(0, 600)
      .map(
        (a) => `<li data-id="${a.id}">
          <img loading="lazy" src="${a.thumb || ''}" alt="" ${a.thumb ? '' : 'class="none"'} />
          <div><div class="t">${esc(a.title)}</div><div class="s">${esc(a.artist)}${a.year ? ' · ' + a.year : ''} · ${t('lib.tracks', { n: a.tracks.length })}</div></div>
        </li>`,
      )
      .join('');
    const tracks = this.catalog.albums.reduce((n, a) => n + a.tracks.length, 0);
    $('#library .lib-count').textContent = words.length ? t('lib.found', { n: list.length, total: this.catalog.albums.length }) : t('lib.count', { albums: this.catalog.albums.length, tracks });
    this.filtered = words.length ? list : null;
    $('#library .albums').hidden = false;
    $('#library .album-page').hidden = true;
  }

  openAlbum(album) {
    if (!album) return;
    this.selected = album;
    this.toggleLibrary(true);
    const page = $('#library .album-page');
    const onDisplay = this.exhibition.itemFor(album);
    page.innerHTML = `
      <button class="back">${t('lib.back')}</button>
      <div class="hero">
        ${album.cover ? `<img src="${album.cover}" alt="" />` : '<div class="noart"></div>'}
        <div>
          <h2>${esc(album.title)}</h2>
          <p>${esc(album.artist)}${album.year ? ' · ' + album.year : ''}${album.genre ? ' · ' + esc(album.genre) : ''}</p>
          <div class="actions">
            <button data-act="play">${t('lib.play')}</button>
            <button data-act="show">${t('lib.show')}</button>
          </div>
          <div class="light" ${onDisplay ? '' : 'hidden'}>
            <span>${t('lib.carry')}</span>
            <button data-light="warm" title="${t('light.warm.tip')}">${t('light.warm')}</button>
            <button data-light="cool" title="${t('light.cool.tip')}">${t('light.cool')}</button>
            <button data-light="clear" title="${t('light.clear.tip')}">${t('light.clear')}</button>
            <button data-light="home" title="${t('light.home.tip')}">${t('light.home')}</button>
          </div>
          <p class="light-note"></p>
        </div>
      </div>
      <ol class="tracks">${album.tracks
        .map(
          (tr, i) => `<li data-album="${album.id}" data-index="${i}"><span class="n">${tr.disc > 1 ? tr.disc + '.' : ''}${tr.number}</span><span class="tt">${esc(tr.title)}${tr.artist ? `<em> — ${esc(tr.artist)}</em>` : ''}</span><span class="d">${fmt(tr.duration)}</span></li>`,
        )
        .join('')}</ol>`;
    $('#library .albums').hidden = true;
    page.hidden = false;
    $('.back', page).addEventListener('click', () => {
      page.hidden = true;
      $('#library .albums').hidden = false;
    });
    $('[data-act="play"]', page).addEventListener('click', () => this.audio.playAlbum(album, 0));
    $('[data-act="show"]', page).addEventListener('click', () => this.showInBasilica(album));
    $('.tracks', page).addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) this.audio.playAlbum(album, Number(li.dataset.index));
    });
    page.querySelectorAll('[data-light]').forEach((b) => b.addEventListener('click', () => this.bathe(album, b.dataset.light)));
    this.audio.dispatchEvent(new Event('trackchange'));
  }

  toggleLibrary(open = !document.body.classList.contains('library-open')) {
    document.body.classList.toggle('library-open', open);
    if (open) {
      document.exitPointerLock?.();
      if (!this.selected) setTimeout(() => this.search.focus(), 50);
    }
  }

  showInBasilica(album) {
    const page = this.exhibition.pageOf(album);
    if (page < 0) return;
    if (page !== this.exhibition.page) this.exhibition.showPage(page);
    const item = this.exhibition.itemFor(album);
    const v = this.exhibition.viewpoint(item);
    this.walker.teleport(v.x, v.z, v.yaw, 0.02);
    this.toggleLibrary(false);
    this.toast(t('light.onStand', { album: album.title, side: t(item.slot.side > 0 ? 'side.passion' : 'side.nativity') }));
    this.openAlbumLater = album;
    this.persist();
  }

  bathe(album, kind) {
    const note = $('#library .light-note');
    const item = this.exhibition.itemFor(album);
    if (!item) return;
    if (kind === 'home') {
      this.exhibition.returnFloating();
      note.textContent = '';
      return;
    }
    const sun = this.lighting.uniforms.uSunDir.value;
    const name = t('light.name.' + kind);
    if (sun.y < 0.03) {
      note.textContent = t('light.sunDown');
      return;
    }
    const spot = findLight(kind, sun, this.walker.position, (x, z) => this.walker.free(x, z));
    if (!spot) {
      note.textContent = t('light.none', { name, hint: t('light.hint.' + kind) });
      return;
    }
    this.exhibition.float(item, spot.x, spot.z);
    note.textContent = t('light.floating', { name, side: t(spot.x < 0 ? 'side.nativity' : 'side.passion') });
    this.toast(t('light.drifts', { name }));
  }

  // ------------------------------------------------------------------ exhibition

  buildExhibitionBar() {
    const bar = $('#exhibition');
    bar.innerHTML = `<button data-dir="-1" data-i18n-title="exh.prev">◀</button><span class="label"></span><button data-dir="1" data-i18n-title="exh.next">▶</button>`;
    bar.addEventListener('click', (e) => {
      const d = Number(e.target.closest('button')?.dataset.dir);
      if (d) this.turnPage(d);
    });
  }

  turnPage(d) {
    this.exhibition.showPage(this.exhibition.page + d);
    this.persist();
  }

  renderPage() {
    const e = this.exhibition;
    $('#exhibition .label').textContent = t('exh.label', { n: e.page + 1, total: e.pageCount });
  }

  // ------------------------------------------------------------------ input

  bindKeys() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') {
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          this.toggleLibrary(false);
          e.target.blur();
        }
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this.toggleLibrary();
      } else if (e.code === 'KeyP') {
        this.audio.toggle();
      } else if (e.key === '.') this.audio.next();
      else if (e.key === ',') this.audio.previous();
      else if (e.key === '[') this.turnPage(-1);
      else if (e.key === ']') this.turnPage(1);
      else if (e.code === 'KeyE' && !e.repeat) {
        // E: stand up from a pew; else play the cover in view; else sit down
        if (this.walker.seat) this.walker.leaveSeat();
        else if (this.hovered) this.audio.playAlbum(this.hovered.album, 0);
        else this.walker.sit();
      }
      else if (e.code === 'KeyH') document.body.classList.toggle('help-open');
      else if (e.code === 'KeyL' && this.hovered) this.openAlbum(this.hovered.album);
    });
    this.canvas.addEventListener('mousedown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('click', (e) => {
      const dragged = this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5;
      if (dragged) return;
      if (this.hovered) this.openAlbum(this.hovered.album);
      else if (document.pointerLockElement !== this.canvas && !document.body.classList.contains('library-open')) this.canvas.requestPointerLock?.();
    });
    addEventListener('mousemove', (e) => (this.mouse = { x: e.clientX, y: e.clientY }));
  }

  // Which cover is under the crosshair (or the mouse when not locked)?
  updateHover() {
    const locked = document.pointerLockElement === this.canvas;
    const ndc = locked || !this.mouse ? new THREE.Vector2(0, 0) : new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const item = this.exhibition.pick(this.raycaster);
    if (item !== this.hovered) {
      this.hovered = item;
      const tip = $('#hover');
      if (item) {
        tip.innerHTML = `<b>${esc(item.album.title)}</b><span>${esc(item.album.artist)}</span><em>Click for tracks · E to play</em>`;
        tip.hidden = false;
      } else tip.hidden = true;
      this.canvas.style.cursor = item && !locked ? 'pointer' : '';
    }
  }

  toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  persist(extra = {}) {
    this.lastSave = performance.now();
    const a = this.audio;
    const w = this.walker;
    saveState({
      ...loadState(),
      album: a.album?.id,
      index: a.index,
      position: a.el.currentTime || 0,
      volume: a.volume,
      page: this.exhibition.page,
      pose: { x: w.position.x, y: w.position.y, z: w.position.z, yaw: w.yaw, pitch: w.pitch },
      ...extra,
    });
  }
}
