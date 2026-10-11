// Every method and property the interface calls on the player must exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const defines = (src, name, kind = '(?:async |get |set )?') => new RegExp(String.raw`^\s*${kind}${name}\s*\(`, 'm').test(src);

test('AudioPlayer implements everything ui.js and main.js use', async () => {
  const src = await read('../web/src/player/audio.js');
  const users = (await read('../web/src/player/ui.js')) + (await read('../web/src/main.js'));
  const used = new Set([...users.matchAll(/\baudio\.(\w+)\s*[(=]/g)].map((m) => m[1]));
  for (const name of ['el', 'addEventListener', 'dispatchEvent', 'graph']) used.delete(name);
  for (const name of used) assert.ok(defines(src, name), `missing AudioPlayer.${name}`);
  for (const name of ['play', 'pause', 'toggle', 'next', 'previous', 'seek', 'playAlbum', 'setReverb']) {
    assert.ok(defines(src, name), `missing AudioPlayer.${name}`);
  }
  assert.ok(defines(src, 'volume', 'set '), 'missing volume setter');
});
