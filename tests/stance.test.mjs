// C key: a tap toggles crouch, a hold steps once to the next stance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StanceGesture } from '../web/src/player/controls.js';

test('tap C: stand -> crouch -> stand, prone -> crouch', () => {
  const g = new StanceGesture();
  g.down(0);
  assert.equal(g.update(0.2, 'stand'), null);
  assert.equal(g.up('stand'), 'crouch');
  g.down(1);
  assert.equal(g.up('crouch'), 'stand');
  g.down(2);
  assert.equal(g.up('prone'), 'crouch');
});

test('hold C: one step along stand -> crouch -> prone -> stand per hold', () => {
  const g = new StanceGesture();
  for (const [from, to] of [['stand', 'crouch'], ['crouch', 'prone'], ['prone', 'stand']]) {
    g.down(0);
    assert.equal(g.update(0.59, from), null);
    assert.equal(g.update(0.61, from), to);
    assert.equal(g.update(2, to), null); // only once per hold
    assert.equal(g.up(to), null); // releasing after a hold changes nothing
  }
});
