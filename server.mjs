// Sagrada × Lilith — local-only server: the basilica, its assets, your music catalog and audio
// streaming. Run `npm start`, then open http://127.0.0.1:8770/
// Browser-playable files are streamed as-is; APE/WMA/etc. and CUE-split
// tracks are converted once to AAC into data/audio-cache. The music folder
// is only ever read.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8770);
const DATA = path.join(ROOT, 'data');
const AUDIO_CACHE = path.join(DATA, 'audio-cache');
await fsp.mkdir(AUDIO_CACHE, { recursive: true });

// URL prefix -> directory. Anything outside these is 404.
const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three')],
  ['/covers/', path.join(DATA, 'covers')],
  ['/assets/', path.join(ROOT, 'assets')],
  ['/bake/', path.join(ROOT, 'bake')],
  ['/', path.join(ROOT, 'web')],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.rgbe': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
};
const DIRECT_AUDIO = new Set(['.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a']);

// The built-in music: Beethoven's Ode to Joy in a 1923 recording (public domain), always first,
// looping; your own library (npm run scan) follows it.
const BUILT_IN = {
  id: 'builtin-ode-to-joy-1923',
  title: 'Symphony No. 9 — Ode to Joy (1923 recording)',
  artist: 'Ludwig van Beethoven',
  year: 1923,
  genre: 'classical',
  cover: '/assets/music/ode-to-joy-1923.webp',
  thumb: '/assets/music/ode-to-joy-1923.webp',
  builtIn: true,
  loop: true,
  tracks: [{ id: 'builtin-ode-1923', title: 'IV. Finale, "Freude, schöner Götterfunken" (excerpt)', artist: null, number: 1, disc: 1, duration: 52.45, format: 'Opus' }],
};
const BUILT_IN_FILES = { 'builtin-ode-1923': path.join(ROOT, 'assets', 'music', 'ode-to-joy-1923.opus') };

let catalogText = JSON.stringify({ albums: [BUILT_IN], summary: {} });
let library = { root: null, tracks: {} };
async function loadCatalog() {
  try {
    const [text, paths] = await Promise.all([
      fsp.readFile(path.join(DATA, 'catalog.json'), 'utf8'),
      fsp.readFile(path.join(DATA, 'library-paths.json'), 'utf8'),
    ]);
    const catalog = JSON.parse(text);
    catalog.albums = [BUILT_IN, ...catalog.albums];
    catalogText = JSON.stringify(catalog);
    library = JSON.parse(paths);
  } catch {
    console.log('No music library scanned yet: playing the built-in recording. To add your own: npm run scan -- "<music folder>"');
  }
}
await loadCatalog();

const fail = (status, message) => Object.assign(new Error(message), { status });

function insideRoot(root, file) {
  const r = path.relative(root, file);
  return r && !r.startsWith('..') && !path.isAbsolute(r);
}

// ---------------------------------------------------------------- audio

const conversions = new Map();
let running = 0;
const waiting = [];
async function withSlot(job) {
  if (running >= 2) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// Resolves on 'close', not 'exit': 'exit' can fire while stdout still holds
// unread data, and finishing the file then truncated the conversion.
function runFfmpeg(args, onData) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-2000)));
    if (onData) child.stdout.on('data', onData);
    else child.stdout.resume();
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg: ' + stderr))));
  });
}

// → { file } when the track can be sent as a file now, or { convert } when it
// must be converted first (APE, WMA, CUE-split tracks, ...).
async function resolveAudio(id) {
  if (BUILT_IN_FILES[id]) return { file: BUILT_IN_FILES[id] };
  const spec = library.tracks[id];
  if (!spec) throw fail(404, 'Unknown track');
  const musicRoot = path.resolve(library.root);
  const file = await fsp.realpath(path.resolve(spec.file));
  if (!insideRoot(musicRoot, file)) throw fail(403, 'Outside the music folder');
  const split = spec.start != null || spec.duration != null;
  if (!split && DIRECT_AUDIO.has(path.extname(file).toLowerCase())) return { file };
  const stat = await fsp.stat(file);
  const key = crypto.createHash('sha256').update(JSON.stringify([file, stat.size, stat.mtimeMs, spec.start, spec.duration])).digest('hex').slice(0, 24);
  const target = path.join(AUDIO_CACHE, key + '.m4a');
  if (fs.existsSync(target)) return { file: target };
  return { convert: { key, source: file, spec, target } };
}

// Convert once. The first listener hears it as it is encoded (fragmented MP4
// streamed straight from ffmpeg); meanwhile it is written to the cache and
// then rewritten with an index so later plays can seek.
function convert({ key, source, spec, target }, listener) {
  if (conversions.has(key)) return conversions.get(key);
  const job = withSlot(async () => {
    const partial = path.join(AUDIO_CACHE, key + '.partial.mp4');
    const indexed = path.join(AUDIO_CACHE, key + '.indexing.m4a');
    const out = fs.createWriteStream(partial);
    let writeError = null;
    out.on('error', (e) => (writeError = e));
    const args = [];
    if (spec.start) args.push('-ss', String(spec.start));
    args.push('-i', source);
    if (spec.duration) args.push('-t', String(spec.duration));
    args.push('-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '256k', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000', '-f', 'mp4', 'pipe:1');
    const tell = (chunk) => {
      try {
        listener?.(chunk);
      } catch {
        /* a listener that went away must not break the conversion */
      }
    };
    try {
      await runFfmpeg(args, (chunk) => {
        if (!writeError) out.write(chunk);
        tell(chunk);
      });
      await new Promise((resolve, reject) => {
        out.once('error', reject);
        out.end(resolve);
      });
      if (writeError) throw writeError;
      tell(null);
      await runFfmpeg(['-i', partial, '-c', 'copy', '-movflags', '+faststart', '-y', indexed]);
      await fsp.rename(indexed, target);
      return target;
    } catch (error) {
      tell(null);
      out.destroy();
      throw error;
    } finally {
      await fsp.rm(partial, { force: true }).catch(() => {});
      await fsp.rm(indexed, { force: true }).catch(() => {});
    }
  }).finally(() => conversions.delete(key));
  conversions.set(key, job);
  return job;
}

async function sendAudio(req, res, id) {
  const r = await resolveAudio(id);
  if (r.file) return sendFile(req, res, r.file);
  const range = /^bytes=(\d+)-/.exec(req.headers.range || '');
  // a seek, or someone else already converting: wait for the cached file
  if ((range && Number(range[1]) > 0) || conversions.has(r.convert.key)) {
    return sendFile(req, res, await convert(r.convert));
  }
  res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  let open = true;
  res.on('close', () => (open = false));
  res.on('error', () => (open = false));
  convert(r.convert, (chunk) => {
    if (!open) return;
    if (chunk) res.write(chunk);
    else res.end();
  }).catch((error) => {
    console.error(error.message);
    if (open) res.destroy();
  });
}

// ---------------------------------------------------------------- files

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) return false;
  let start;
  let end;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start >= 0 && start < size && end >= start ? { start, end } : false;
}

async function sendFile(req, res, file, cache = 'no-cache') {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw fail(404, 'Not found');
  const range = parseRange(req.headers.range, stat.size);
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', cache);
  if (range === false) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  res.setHeader('Content-Length', end - start + 1);
  if (range) res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
  else res.writeHead(200);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ---------------------------------------------------------------- music folder

// The system's own folder dialog, opened by the server (it runs on the same computer as the
// browser). Returns the chosen path, null when cancelled, or undefined when no dialog is available.
function run(cmd, args) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: false });
    } catch {
      return resolve({ missing: true });
    }
    child.stdout.on('data', (d) => (out += d));
    child.once('error', () => resolve({ missing: true }));
    child.once('close', (code) => resolve({ code, out: out.trim() }));
  });
}
async function pickFolder() {
  const prompt = 'Choose your music folder (it is only read)';
  let r;
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $o = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}; ` +
      `$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${prompt}'; $d.ShowNewFolderButton = $false; ` +
      `if ($d.ShowDialog($o) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }`;
    r = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', ps]);
  } else if (process.platform === 'darwin') {
    r = await run('osascript', ['-e', `POSIX path of (choose folder with prompt "${prompt}")`]);
  } else {
    r = await run('zenity', ['--file-selection', '--directory', `--title=${prompt}`]);
    if (r.missing) r = await run('kdialog', ['--getexistingdirectory', process.env.HOME || '/', '--title', prompt]);
  }
  if (r.missing) return undefined;
  return r.code === 0 && r.out ? r.out.split(/\r?\n/).pop() : null;
}

// one scan at a time, in its own process (tools/scan-library.mjs); the page polls GET /api/library
const scan = { running: false, root: null, stage: null, done: 0, total: 0, error: null, finished: null };
async function startScan(root) {
  if (scan.running) throw fail(409, 'A scan is already running');
  const folder = path.resolve(String(root || ''));
  const stat = await fsp.stat(folder).catch(() => null);
  if (!stat?.isDirectory()) throw fail(400, 'Not a folder: ' + folder);
  Object.assign(scan, { running: true, root: folder, stage: 'files', done: 0, total: 0, error: null, finished: null });
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'scan-library.mjs'), folder], { cwd: ROOT, windowsHide: true });
  let tail = '';
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const m = /^@progress (\w+) (\d+) (\d+)/.exec(line);
      if (m) Object.assign(scan, { stage: m[1], done: Number(m[2]), total: Number(m[3]) });
    }
  });
  child.stderr.on('data', (d) => (tail = (tail + d).slice(-600)));
  child.once('close', async (code) => {
    scan.running = false;
    scan.finished = new Date().toISOString();
    if (code === 0) await loadCatalog();
    else scan.error = tail.trim() || `The scan stopped (code ${code})`;
  });
}

// ---------------------------------------------------------------- routes

const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!hosts.has(req.headers.host)) throw fail(403, 'Local access only');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const name = decodeURIComponent(url.pathname);

    // Review captures: the page posts a PNG of the canvas, saved under data/captures.
    if (req.method === 'POST' && name === '/api/capture') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail(403, 'Cross-origin');
      const label = (url.searchParams.get('name') || 'capture').replace(/[^\w.-]+/g, '_').slice(0, 80);
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 40e6) throw fail(413, 'Too large');
        chunks.push(chunk);
      }
      const dir = path.join(DATA, 'captures');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, label + '.png'), Buffer.concat(chunks));
      res.writeHead(204);
      return res.end();
    }
    // Bake export (app → Blender): binary geometry and its manifest, saved
    // under data/bake/in. Local only, same-origin only, size-capped.
    if (req.method === 'POST' && name === '/api/bake-upload') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail(403, 'Cross-origin');
      const file = (url.searchParams.get('file') || '').replace(/[^\w.-]+/g, '_');
      if (!/^[\w-]+\.(bin|json|png)$/.test(file)) throw fail(400, 'Bad file name');
      const dir = path.join(DATA, 'bake', 'in');
      await fsp.mkdir(dir, { recursive: true });
      const out = fs.createWriteStream(path.join(dir, file));
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1.5e9) {
          out.destroy();
          throw fail(413, 'Too large');
        }
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((r) => out.end(r));
      res.writeHead(204);
      return res.end();
    }
    // Identity for launchers: proves this port is the Sagrada player, not just anything listening.
    if (name === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ app: 'sagrada-x-lilith', catalog: fs.existsSync(path.join(DATA, 'catalog.json')) }));
    }
    // The music folder: what is scanned now, and the scan's progress.
    if (name === '/api/library' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ root: library.root, scan }));
    }
    if (name.startsWith('/api/library/') && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail(403, 'Cross-origin');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (name === '/api/library/pick') {
        const folder = await pickFolder();
        return res.end(JSON.stringify(folder === undefined ? { unsupported: true } : { folder }));
      }
      if (name === '/api/library/scan') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 10000) throw fail(413, 'Too large');
        }
        await startScan(JSON.parse(body || '{}').folder);
        return res.end(JSON.stringify({ started: true }));
      }
      throw fail(404, 'Not found');
    }
    if (name === '/api/catalog') {
      if (url.searchParams.has('reload')) await loadCatalog();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(catalogText);
    }
    if (name.startsWith('/api/audio/')) {
      return await sendAudio(req, res, name.slice('/api/audio/'.length));
    }
    for (const [prefix, dir] of STATIC) {
      if (!name.startsWith(prefix)) continue;
      const file = path.resolve(dir, '.' + name.slice(prefix.length - 1) + (name.endsWith('/') ? 'index.html' : ''));
      if (!insideRoot(dir, file) || !MIME[path.extname(file).toLowerCase()]) throw fail(404, 'Not found');
      const immutable = prefix === '/covers/' || prefix === '/vendor/three/' ? 'max-age=86400' : 'no-cache';
      return await sendFile(req, res, file, immutable);
    }
    throw fail(404, 'Not found');
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
    if (status >= 500) console.error(error.message);
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error.message);
    } else res.destroy();
  }
});

process.on('uncaughtException', (error) => console.error('Uncaught:', error));
process.on('unhandledRejection', (error) => console.error('Unhandled:', error));

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`Already running at http://127.0.0.1:${PORT}/`);
    if (process.argv.includes('--open')) {
      const url = `http://127.0.0.1:${PORT}/`;
      const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
    setTimeout(() => process.exit(0), 500);
  }
  throw error;
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Sagrada × Lilith: ${url}  (close this window or press Ctrl+C to stop)`);
  // --open (the starters): open it in the default browser
  if (process.argv.includes('--open')) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
});
