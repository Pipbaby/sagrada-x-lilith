// Read-only scan of the music library into data/catalog.json.
//
// Albums are grouped by folder (disc subfolders fold into their parent),
// single-file images with a CUE sheet are split into virtual tracks, and
// cover art is converted to local WebP files. Nothing under the music root is
// ever written. Re-running reuses cached tags for unchanged files.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseFile } from 'music-metadata';
import ffmpeg from 'ffmpeg-static';
import { parseCue, cueTrackSpans, decodeCue } from './cue.mjs';
import { fixMojibake } from './mojibake.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_ARG = process.argv[2] || process.env.MUSIC_ROOT;
if (!ROOT_ARG) {
  console.error('Usage: npm run scan -- "<your music folder>"   (or set MUSIC_ROOT)');
  process.exit(1);
}
const MUSIC_ROOT = path.resolve(ROOT_ARG);
const DATA = path.join(PROJECT, 'data');
const COVERS = path.join(DATA, 'covers');

const AUDIO = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.wma', '.ape', '.aif', '.aiff', '.tta', '.tak', '.wv', '.aac', '.dsf']);
const IMAGE = /\.(jpe?g|png|webp|bmp|gif)$/i;
const DISC_FOLDER = /^(?:cd|disc|disk)[ ._-]*\d+\b/i;

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
// legacy code-page tags are repaired before NFKC (which would make them unrecoverable)
const clean = (value) => fixMojibake(String(value ?? '')).normalize('NFKC').replace(/\s+/g, ' ').trim();
const rel = (file) => path.relative(MUSIC_ROOT, file);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function pool(items, concurrency, work) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await work(items[index], index);
      }
    }),
  );
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
  });
}

// Placeholders rippers write when they know nothing: treat as missing.
const PLACEHOLDER = /^(unknown( artist| album| title)?|untitled|不明なアーティスト|不明なタイトル|不明なアルバム|未知艺术家|未知专辑|未知)$/i;

// Most common non-empty value, so one mistagged track doesn't rename an album.
function vote(values, fallback = null) {
  const counts = new Map();
  for (const value of values.map(clean).filter((v) => v && !PLACEHOLDER.test(v))) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

function imageRank(file) {
  const base = path.basename(file);
  if (/^(front|folder|cover|album)[ ._-]*\d*\./i.test(base)) return 0;
  if (/front|cover|folder/i.test(base)) return 1;
  if (/back|tray|disc|cd|booklet|inlay|inside/i.test(base)) return 4;
  return 2;
}

// ---------------------------------------------------------------- walk

const folders = new Map(); // dir -> files directly inside
const warnings = [];

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    warnings.push({ path: rel(dir), stage: 'folder', error: error.message });
    return;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('._') || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) files.push(full);
  }
  folders.set(dir, files);
}

await fs.mkdir(COVERS, { recursive: true });
console.log(`Scanning ${MUSIC_ROOT} (read only)…`);
await walk(MUSIC_ROOT);

const audioFiles = [...folders.values()]
  .flat()
  .filter((f) => AUDIO.has(path.extname(f).toLowerCase()))
  .sort(collator.compare);
console.log(`${audioFiles.length} audio files in ${folders.size} folders`);
console.log(`@progress tags 0 ${audioFiles.length}`);

// ---------------------------------------------------------------- tags

const tagCachePath = path.join(DATA, 'tag-cache.json');
const oldTags = await readJson(tagCachePath, {});
const tags = {};
const records = [];

await pool(audioFiles, 8, async (file, index) => {
  const key = rel(file);
  const stat = await fs.stat(file);
  let info = oldTags[key];
  if (!info || info.size !== stat.size || info.mtimeMs !== stat.mtimeMs) {
    try {
      const meta = await parseFile(file, { duration: true, skipCovers: true });
      const c = meta.common;
      info = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        title: c.title,
        album: c.album,
        artist: c.artist,
        albumartist: c.albumartist,
        year: c.year,
        genre: c.genre?.join(' / '),
        track: c.track?.no,
        disc: c.disk?.no,
        duration: meta.format.duration ?? null,
      };
    } catch (error) {
      info = { size: stat.size, mtimeMs: stat.mtimeMs, error: error.message, duration: null };
    }
  }
  tags[key] = info;
  if (info.error) warnings.push({ path: key, stage: 'tags', error: info.error });
  records.push({ file, key, dir: path.dirname(file), info });
  if ((index + 1) % 1000 === 0) console.log(`  tags ${index + 1}/${audioFiles.length}`);
  if ((index + 1) % 25 === 0 || index + 1 === audioFiles.length) console.log(`@progress tags ${index + 1} ${audioFiles.length}`);
});
await fs.writeFile(tagCachePath, JSON.stringify(tags));

// ---------------------------------------------------------------- CUE

const recordByPath = new Map(records.map((r) => [r.file.toLowerCase(), r]));
const cueSplits = new Map(); // audio file -> { tracks }

for (const [dir, files] of folders) {
  const audio = files.filter((f) => AUDIO.has(path.extname(f).toLowerCase()));
  if (!audio.length) continue;
  for (const cuePath of files.filter((f) => /\.cue$/i.test(f))) {
    try {
      const sheet = parseCue(decodeCue(await fs.readFile(cuePath)));
      for (const entry of sheet.files) {
        if (entry.tracks.length < 2) continue;
        const wanted = path.basename(entry.name.replaceAll('\\', '/')).toLowerCase();
        const stem = path.parse(wanted).name;
        const source =
          audio.find((f) => path.basename(f).toLowerCase() === wanted) ||
          audio.find((f) => path.parse(f).name.toLowerCase() === stem) ||
          (sheet.files.length === 1 && audio.length === 1 ? audio[0] : null);
        if (!source) {
          warnings.push({ path: rel(cuePath), stage: 'cue', error: `audio not found: ${entry.name}` });
          continue;
        }
        if (cueSplits.has(source)) continue;
        const record = recordByPath.get(source.toLowerCase());
        const tracks = cueTrackSpans(entry.tracks, record?.info.duration);
        if (tracks.length < 2) continue;
        cueSplits.set(source, { tracks });
        if (record) {
          record.info.album ||= sheet.title;
          record.info.albumartist ||= sheet.performer;
          record.info.artist ||= sheet.performer;
        }
      }
    } catch (error) {
      warnings.push({ path: rel(cuePath), stage: 'cue', error: error.message });
    }
  }
}

// ---------------------------------------------------------------- albums

const albumFolder = (dir) => (DISC_FOLDER.test(path.basename(dir)) && dir !== MUSIC_ROOT ? path.dirname(dir) : dir);
const groups = new Map();
for (const record of records) {
  const folder = albumFolder(record.dir);
  const id = hash('album:' + rel(folder).toLowerCase());
  if (!groups.has(id)) groups.set(id, { id, folder, records: [] });
  groups.get(id).records.push(record);
}

const trackPaths = {};
const albums = [];
for (const group of groups.values()) {
  group.records.sort((a, b) => collator.compare(a.file, b.file));
  const infos = group.records.map((r) => r.info);
  const artists = new Set(infos.map((i) => clean(i.artist)).filter(Boolean));
  const artist =
    vote(infos.map((i) => i.albumartist)) ||
    (artists.size > Math.max(2, infos.length / 2) ? 'Various Artists' : vote(infos.map((i) => i.artist), 'Unknown artist'));

  const tracks = [];
  group.records.forEach((r, n) => {
    const format = path.extname(r.file).slice(1).toUpperCase();
    const disc = r.info.disc || Number(/(?:cd|disc|disk)[ ._-]*(\d+)/i.exec(path.basename(r.dir))?.[1]) || 1;
    const split = cueSplits.get(r.file);
    if (split) {
      for (const t of split.tracks) {
        const id = hash(r.key + '#' + t.number);
        trackPaths[id] = { file: r.file, start: t.start, duration: t.duration };
        tracks.push({ id, title: clean(t.title) || `Track ${t.number}`, artist: clean(t.performer) || null, number: t.number, disc, duration: t.duration, format: `${format} · CUE` });
      }
      return;
    }
    const id = hash(r.key);
    trackPaths[id] = { file: r.file };
    const fileNumber = Number(/^(\d+)[\s_.-]/.exec(path.basename(r.file))?.[1]);
    tracks.push({
      id,
      title: clean(r.info.title) || path.basename(r.file, path.extname(r.file)).replace(/^\d+[\s_.-]+/, ''),
      artist: artists.size > 1 ? clean(r.info.artist) || null : null,
      number: r.info.track || fileNumber || n + 1,
      disc,
      duration: r.info.duration,
      format,
    });
  });
  tracks.sort((a, b) => a.disc - b.disc || a.number - b.number || collator.compare(a.title, b.title));

  albums.push({
    id: group.id,
    title: vote(infos.map((i) => i.album), clean(path.basename(group.folder))),
    artist,
    year: Number(vote(infos.map((i) => i.year))) || null,
    genre: vote(infos.map((i) => i.genre), null),
    cover: null,
    thumb: null,
    tracks,
    _group: group,
  });
}
albums.sort((a, b) => collator.compare(a.artist, b.artist) || (a.year || 0) - (b.year || 0) || collator.compare(a.title, b.title));

// ---------------------------------------------------------------- covers

console.log(`Covers for ${albums.length} albums (${cueSplits.size} CUE images split)…`);
await pool(albums, 4, async (album, index) => {
  const group = album._group;
  delete album._group;
  const full = path.join(COVERS, `${album.id}-full.webp`);
  const thumb = path.join(COVERS, `${album.id}-thumb.webp`);
  let embedded = null;
  try {
    const dirs = new Set([group.folder, ...group.records.map((r) => r.dir)]);
    for (const [dir] of folders) {
      if (path.dirname(dir) === group.folder && /scans?|covers?|artwork|booklet/i.test(path.basename(dir))) dirs.add(dir);
    }
    const images = [...dirs]
      .flatMap((d) => folders.get(d) || [])
      .filter((f) => IMAGE.test(f))
      .sort((a, b) => imageRank(a) - imageRank(b) || collator.compare(a, b));
    let source = images.find((f) => imageRank(f) <= 1) || null;
    if (!source) {
      for (const r of group.records.slice(0, 3)) {
        try {
          const meta = await parseFile(r.file, { duration: false, skipCovers: false });
          const pictures = meta.common.picture || [];
          const picture = pictures.find((p) => /front|cover/i.test(p.type || '')) || pictures[0];
          if (picture) {
            embedded = path.join(DATA, `${album.id}.cover-input`);
            await fs.writeFile(embedded, picture.data);
            source = embedded;
            break;
          }
        } catch {}
      }
    }
    source ??= images[0] ?? null;
    if (!source) return;

    let fresh = false;
    if (!embedded) {
      try {
        const [a, b, s] = await Promise.all([fs.stat(full), fs.stat(thumb), fs.stat(source)]);
        fresh = a.size > 0 && b.size > 0 && a.mtimeMs >= s.mtimeMs;
      } catch {}
    } else {
      try {
        fresh = (await fs.stat(full)).size > 0 && (await fs.stat(thumb)).size > 0;
      } catch {}
    }
    if (!fresh) {
      await runFfmpeg([
        '-i', source,
        '-filter_complex', "[0:v]split[a][b];[a]scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease[f];[b]scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease[t]",
        '-map', '[f]', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '86', '-y', full,
        '-map', '[t]', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '78', '-y', thumb,
      ]);
    }
    album.cover = `/covers/${album.id}-full.webp`;
    album.thumb = `/covers/${album.id}-thumb.webp`;
  } catch (error) {
    warnings.push({ album: album.title, stage: 'cover', error: error.message.slice(0, 300) });
  } finally {
    if (embedded) await fs.rm(embedded, { force: true });
    if ((index + 1) % 200 === 0) console.log(`  covers ${index + 1}/${albums.length}`);
    if ((index + 1) % 5 === 0 || index + 1 === albums.length) console.log(`@progress covers ${index + 1} ${albums.length}`);
  }
});

// ---------------------------------------------------------------- write

const summary = {
  audioFiles: audioFiles.length,
  albums: albums.length,
  tracks: albums.reduce((n, a) => n + a.tracks.length, 0),
  withCover: albums.filter((a) => a.cover).length,
  cueImages: cueSplits.size,
  warnings: warnings.length,
};
const generatedAt = new Date().toISOString();
await fs.writeFile(path.join(DATA, 'library-paths.json'), JSON.stringify({ root: MUSIC_ROOT, tracks: trackPaths }));
await fs.writeFile(path.join(DATA, 'catalog.json'), JSON.stringify({ generatedAt, summary, albums }));
await fs.writeFile(path.join(DATA, 'scan-warnings.json'), JSON.stringify({ generatedAt, warnings }, null, 2));
console.log(summary);
console.log('Done. The music folder was only read.');
