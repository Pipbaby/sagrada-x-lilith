// Repair tags written in a legacy code page but read as Latin-1 (old ID3v1 /
// ID3v2.3 tags from Chinese, Japanese, Greek and Russian rippers): "×îÃÀ"
// is GBK "最美". A string is only touched when it is pure Latin-1 and mostly
// high-range characters — a few accents in a Western name are left alone.

const DECODERS = ['utf-8', 'gb18030', 'big5', 'shift_jis', 'windows-1251', 'windows-1253'];
const vowels = {
  cyrillic: /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/g,
  greek: /[αεηιουωάέήίόύώϊϋΐΰΑΕΗΙΟΥΩΆΈΉΊΌΎΏ]/g,
};

function letters(text) {
  return [...text].filter((c) => /\p{L}/u.test(c));
}

function looksBroken(text) {
  if (!text || /[^\u0000-ÿ]/.test(text)) return false;
  const ls = letters(text);
  const high = ls.filter((c) => c.charCodeAt(0) >= 0xc0).length;
  // plus the symbol-range bytes (¤ ¥ ¶ · etc.) that only appear in mojibake
  const symbols = [...text].filter((c) => { const k = c.charCodeAt(0); return k >= 0x80 && k < 0xc0; }).length;
  if (high + symbols < 2) return false;
  // mostly high-range, or three in a row (Western words rarely have that)
  return (high + symbols) / Math.max(1, ls.length + symbols) >= 0.5 || /[-ÿ]{3}/.test(text.replace(/\s/g, ''));
}

// How much a byte string looks like everyday GB2312 Chinese. Shift-JIS kanji
// mostly land in GBK's extension, Cyrillic and Greek in GB2312 level 2.
function gb2312Share(bytes) {
  let pairs = 0;
  let proper = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x81) continue;
    pairs++;
    // level 1 (common hanzi) and the symbol/kana rows count fully,
    // level 2 (rarer hanzi) half — Cyrillic and Greek bytes land there
    // GBK's extension (traditional forms, e.g. 倉) gets partial credit
    proper += bytes[i] >= 0xa1 && bytes[i + 1] >= 0xa1 ? (bytes[i] <= 0xd7 ? 1 : 0.5) : 0.4;
    i++;
  }
  return pairs ? proper / pairs : 0;
}

function score(text, encoding, bytes) {
  if (text.includes('�')) return -1;
  // ASCII decodes the same in every candidate: judge only the rest
  const chars = [...text].filter((c) => c.charCodeAt(0) >= 0x80 && !/\s|\p{P}|\p{N}/u.test(c));
  if (!chars.length) return -1;
  const count = (re) => chars.filter((c) => re.test(c)).length / chars.length;
  if (encoding === 'utf-8') return 2; // valid UTF-8 from high bytes is never an accident
  if (encoding === 'shift_jis') return count(/[぀-ヿ]/) > 0.15 ? 1.5 : count(/[一-鿿]/) * 0.8;
  if (encoding === 'gb18030' || encoding === 'big5') {
    // common ideographs vs. rare ones and stray Latin
    // (GBK also carries the Japanese kana, so they count as valid there)
    // (and full-width Latin, which old Chinese tags used for English)
    const valid = encoding === 'gb18030' ? /[一-龥぀-ヿ！-～　]/ : /[一-龥]/;
    const share = encoding === 'gb18030' ? gb2312Share(bytes) : 1;
    return count(valid) * share - count(/[㐀-䶿豈-﫿À-ɏ]/) - (encoding === 'big5' ? 0.01 : 0);
  }
  const script = encoding === 'windows-1251' ? 'cyrillic' : 'greek';
  // core alphabets only (no ґ, Ѕ, Ϟ …), over every non-ASCII character
  // including stray punctuation (‚ › from the C1 range mean a wrong guess)
  const all = [...text].filter((c) => c.charCodeAt(0) >= 0x80 && !/\s/.test(c));
  const core = script === 'cyrillic' ? /[А-яЁё]/ : /[Α-ωάέήίόύώϊϋΐΰΆΈΉΊΌΎΏ]/;
  const inScript = all.filter((c) => core.test(c)).length / all.length;
  const v = (text.match(vowels[script]) || []).length / chars.length;
  // real words are ~35–50 % vowels; the wrong code page gives far fewer
  return inScript * Math.min(1, v / 0.35);
}

export function fixMojibake(text) {
  if (!looksBroken(text)) return text;
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
  let best = { text, score: 0.5 };
  for (const encoding of DECODERS) {
    let decoded;
    try {
      decoded = new TextDecoder(encoding, { fatal: encoding === 'utf-8' }).decode(bytes);
    } catch {
      continue;
    }
    const s = score(decoded, encoding, bytes);
    if (s > best.score) best = { text: decoded, score: s };
  }
  return best.text;
}
