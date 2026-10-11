// Playback: an album queue on one <audio> element, with an optional
// "nave" reverb — a convolution with a synthetic impulse whose decay matches a
// very large stone interior (RT60 ≈ 7 s), mixed in gently.

export class AudioPlayer extends EventTarget {
  constructor() {
    super();
    this.el = new Audio();
    this.el.preload = 'auto';
    this.album = null;
    this.index = -1;
    this.reverb = 0;
    this.graph = null;
    for (const type of ['play', 'pause', 'timeupdate', 'ended', 'loadedmetadata', 'waiting', 'playing', 'error']) {
      this.el.addEventListener(type, () => this.dispatchEvent(new Event(type === 'ended' ? 'trackended' : type)));
    }
    this.el.addEventListener('ended', () => this.next(true));
    this.el.addEventListener('error', () => {
      // formats that need conversion arrive a little later; try once more
      if (this.track && !this.retried) {
        this.retried = true;
        setTimeout(() => this.load(this.index, true), 1500);
      }
    });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.play());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    }
  }

  get track() {
    return this.album?.tracks[this.index] ?? null;
  }
  get playing() {
    return !this.el.paused;
  }

  playAlbum(album, index = 0, startAt = 0, autoplay = true) {
    this.album = album;
    this.load(index, autoplay, startAt);
    this.dispatchEvent(new Event('albumchange'));
  }

  load(index, autoplay = true, startAt = 0) {
    if (!this.album || index < 0 || index >= this.album.tracks.length) return;
    this.index = index;
    this.retried = false;
    const t = this.track;
    this.el.src = `/api/audio/${t.id}`;
    if (startAt) this.el.addEventListener('loadedmetadata', () => (this.el.currentTime = startAt), { once: true });
    if (autoplay) this.play();
    this.dispatchEvent(new Event('trackchange'));
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || this.album.artist,
        album: this.album.title,
        artwork: this.album.cover ? [{ src: this.album.cover, sizes: '1024x1024', type: 'image/webp' }] : [],
      });
    }
  }

  async play() {
    // Set up the reverb path first, while the click's activation is fresh,
    // so the audio path never switches in the middle of a song.
    await this.connectGraph();
    try {
      await this.el.play();
    } catch {
      /* autoplay blocked until a gesture; the UI shows the play button */
    }
  }
  pause() {
    this.el.pause();
  }
  toggle() {
    if (this.el.paused) this.play();
    else this.pause();
  }
  next(auto = false) {
    if (!this.album) return;
    if (this.index + 1 < this.album.tracks.length) this.load(this.index + 1);
    else if (!auto || this.album.loop) this.load(0);
    else this.dispatchEvent(new Event('albumended'));
  }
  previous() {
    if (this.el.currentTime > 3) this.el.currentTime = 0;
    else this.load(Math.max(0, this.index - 1));
  }
  seek(seconds) {
    if (Number.isFinite(seconds)) this.el.currentTime = seconds;
  }
  set volume(v) {
    this.el.volume = Math.min(1, Math.max(0, v));
  }
  get volume() {
    return this.el.volume;
  }

  setReverb(amount) {
    this.reverb = amount;
    if (this.graph) this.applyReverb();
    else if (amount > 0 && navigator.userActivation?.isActive) this.connectGraph();
  }
  applyReverb() {
    const t = this.graph.ctx.currentTime;
    this.graph.wet.gain.setTargetAtTime(this.reverb * 0.55, t, 0.2);
    this.graph.dry.gain.setTargetAtTime(1 - this.reverb * 0.25, t, 0.2);
  }

  // Routing the element through Web Audio is irreversible, and a suspended
  // context silences it while it keeps "playing". So: only during a user
  // gesture, only once the context is confirmed running, and only if reverb
  // is actually wanted. Otherwise the element plays straight to the speakers.
  async connectGraph() {
    if (this.reverb <= 0) return;
    if (this.graph) {
      if (this.graph.ctx.state !== 'running') await this.graph.ctx.resume().catch(() => {});
      return;
    }
    if (this.connecting) return;
    this.connecting = true;
    try {
      // 48 kHz regardless of the output device (some run at 192 kHz, making
      // the convolution four times heavier); Chrome resamples on output.
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
      if (ctx.state !== 'running') {
        ctx.close();
        return;
      }
      const source = ctx.createMediaElementSource(this.el);
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const convolver = ctx.createConvolver();
      convolver.buffer = naveImpulse(ctx);
      // tame the low end of the tail so bass doesn't smear
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180;
      source.connect(dry).connect(ctx.destination);
      source.connect(hp).connect(convolver).connect(wet).connect(ctx.destination);
      ctx.addEventListener('statechange', () => this.dispatchEvent(new Event('audiostate')));
      this.graph = { ctx, dry, wet };
      this.applyReverb();
    } finally {
      this.connecting = false;
    }
  }

  // True when the element plays but nothing can reach the speakers.
  get silentReason() {
    if (this.el.paused) return null;
    if (this.el.muted) return 'muted';
    if (this.el.volume === 0) return 'volume';
    if (this.graph && this.graph.ctx.state !== 'running') return 'suspended';
    return null;
  }
}

// Exponentially decaying stereo noise with early reflections and air
// absorption (high frequencies die first).
function naveImpulse(ctx, seconds = 4.5) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const decay = Math.pow(10, (-3 * t) / 6.8); // −60 dB at RT60
      const cutoff = Math.max(0.04, 0.6 * Math.exp(-t / 1.6));
      lp += cutoff * ((Math.random() * 2 - 1) - lp);
      data[i] = lp * decay * (t < 0.02 ? t / 0.02 : 1);
    }
    // a few discrete early reflections off columns and walls
    for (const [delay, gain] of [[0.031, 0.5], [0.047, 0.35], [0.083, 0.3], [0.121, 0.22], [0.167, 0.18]]) {
      const k = Math.floor((delay + ch * 0.004) * rate);
      if (k < length) data[k] += gain;
    }
  }
  return buffer;
}
