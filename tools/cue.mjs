// CUE sheet parsing. A sheet can reference several FILEs (multi-disc images),
// and INDEX 01 marks the audible start of each track within its file.

const FRAMES_PER_SECOND = 75;

export function parseCue(text) {
  const sheet = { title: null, performer: null, files: [] };
  let file = null;
  let track = null;
  for (const line of text.split(/\r?\n/)) {
    const fileMatch = /^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+(\S+)/i.exec(line);
    if (fileMatch) {
      file = { name: fileMatch[1] || fileMatch[2], tracks: [] };
      sheet.files.push(file);
      track = null;
      continue;
    }
    const trackMatch = /^\s*TRACK\s+(\d+)\s+AUDIO/i.exec(line);
    if (trackMatch) {
      if (!file) {
        file = { name: '', tracks: [] };
        sheet.files.push(file);
      }
      track = { number: Number(trackMatch[1]), title: null, performer: null, start: null };
      file.tracks.push(track);
      continue;
    }
    const title = /^\s*TITLE\s+"(.*)"/i.exec(line);
    if (title) (track || sheet).title = title[1];
    const performer = /^\s*PERFORMER\s+"(.*)"/i.exec(line);
    if (performer) (track || sheet).performer = performer[1];
    const index = /^\s*INDEX\s+01\s+(\d+):(\d+):(\d+)/i.exec(line);
    if (index && track) {
      track.start = Number(index[1]) * 60 + Number(index[2]) + Number(index[3]) / FRAMES_PER_SECOND;
    }
  }
  return sheet;
}

// Resolve each track's duration from the next track's start, or the file length.
export function cueTrackSpans(tracks, fileDuration) {
  return tracks
    .filter((t) => Number.isFinite(t.start))
    .map((t, i, all) => {
      const end = all[i + 1]?.start ?? fileDuration;
      return { ...t, duration: Number.isFinite(end) ? end - t.start : null };
    })
    .filter((t) => t.duration === null || t.duration > 0);
}

// CUE files in the wild are UTF-8, GBK or Shift-JIS. Prefer UTF-8 when it
// decodes cleanly; otherwise pick whichever legacy decoding yields fewer
// replacement characters.
export function decodeCue(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  // GB18030 decodes almost any byte sequence without errors, so "fewest
  // replacement characters" alone mistakes Japanese for Chinese. Shift-JIS
  // that decodes cleanly and contains kana is almost certainly Japanese.
  const sjis = new TextDecoder('shift_jis').decode(bytes);
  const kana = (sjis.match(/[぀-ヿ]/g) || []).length;
  if (!sjis.includes('�') && kana >= 2) return sjis;
  const candidates = ['gb18030', 'big5', 'shift_jis', 'windows-1252'].map((encoding) => {
    const text = new TextDecoder(encoding).decode(bytes);
    return { text, bad: (text.match(/�/g) || []).length };
  });
  candidates.sort((a, b) => a.bad - b.bad);
  return candidates[0].text;
}
