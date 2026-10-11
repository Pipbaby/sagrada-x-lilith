// Tags in legacy code pages read as Latin-1 are repaired; Western names are not touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixMojibake } from '../tools/mojibake.mjs';

test('GBK, Windows-1251 and Windows-1253 tags are repaired', () => {
  assert.equal(fixMojibake('ÍõÈôÁÕ'), '王若琳');
  assert.equal(fixMojibake('¿Õ¤ÎÉ­'), '空の森');
  assert.equal(fixMojibake('Åëåíà Ôðîëîâà'), 'Елена Фролова');
  assert.equal(fixMojibake('Ñîëíöå âå÷åðà CD 1'), 'Солнце вечера CD 1');
  assert.equal(fixMojibake('×Üñçò êáé ÐÜíïò Êáôóéìß÷áò'), 'Χάρης και Πάνος Κατσιμίχας');
  // Shift-JIS kanji without kana must not be taken for GBK
  const sjis = String.fromCharCode(...[0x8d, 0xeb, 0x91, 0x83, 0x8e, 0x8d, 0x98, 0x59]);
  assert.equal(fixMojibake(sjis), '鷺巣詩郎');
  // legacy bytes followed by an English subtitle
  const mixed = String.fromCharCode(...[0xc2, 0xcc, 0xb8, 0xd6, 0xc7, 0xd9]) + '(In The Enchanted Garden)';
  assert.equal(fixMojibake(mixed), '绿个智(In The Enchanted Garden)'.replace('绿个智', new TextDecoder('gb18030').decode(new Uint8Array([0xc2, 0xcc, 0xb8, 0xd6, 0xc7, 0xd9]))));
});

test('traditional GBK and full-width forms', () => {
  const gbk = (bytes) => String.fromCharCode(...bytes);
  // 大倉山 in GBK uses the extension area (a trail byte below 0x80)
  const daikurayama = new TextDecoder('gb18030').decode(new Uint8Array([0xb4, 0xf3, 0x82, 0x7d, 0xc9, 0xbd]));
  assert.equal(fixMojibake(gbk([0xb4, 0xf3, 0x82, 0x7d, 0xc9, 0xbd]) + ' 2010'), daikurayama + ' 2010');
  assert.equal(fixMojibake(gbk([0xb4, 0xf3, 0x82, 0x7d, 0xc9, 0xbd, 0xd3, 0x9b, 0xc4, 0xee, 0xf0, 0x5e])), '大倉山記念館');
  assert.equal(fixMojibake(gbk([0xa3, 0xcc, 0xa3, 0xe9, 0xa3, 0xf4, 0xa3, 0xf4, 0xa3, 0xec, 0xa3, 0xe5])), 'Ｌｉｔｔｌｅ');
});

test('Western names with accents are left alone', () => {
  for (const s of ['Sigur Rós', 'Björk', 'Café Tacvba', 'Mötley Crüe', 'Ólafur Arnalds', 'Hélène Grimaud', 'Ensemble Ça ira', 'K-ON!', '南方']) assert.equal(fixMojibake(s), s);
});
