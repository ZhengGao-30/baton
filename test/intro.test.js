'use strict';
// The launch intro plays once per process, the first time the window is actually seen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIntroGate } = require('../src/intro');

test('intro: shown at start-up, it plays with the first load and never on later shows', () => {
  const g = createIntroGate();
  assert.equal(g.onLoad(true), true);
  assert.equal(g.onShow(), false, 're-shown from the tray');
  assert.equal(g.onShow(), false);
  assert.equal(g.onLoad(true), false, 'a second load (reload) does not replay it');
});

test('intro: started hidden, it waits for the first time the window is opened, then only once', () => {
  const g = createIntroGate();
  assert.equal(g.onLoad(false), false, 'autostart (--hidden) loads the page without it');
  assert.equal(g.onShow(), true, 'first open from the tray');
  assert.equal(g.onShow(), false);
});
