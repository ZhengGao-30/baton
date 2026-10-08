'use strict';
// The interface language is a setting: English unless the user picks Chinese. Runs in a throw-away BATON_HOME.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-test-'));
  Object.assign(process.env, {
    BATON_HOME: path.join(root, 'home'),
    BATON_HUB: path.join(root, 'hub'),
    BATON_DESKTOP_DIR: path.join(root, 'desktop-sessions'),
    BATON_DESKTOP_TTL: '0',
  });
  delete process.env.BATON_TAKEOVER;
  fs.mkdirSync(process.env.BATON_HUB, { recursive: true });
  fs.mkdirSync(process.env.BATON_DESKTOP_DIR, { recursive: true });
  return require(`${SRC}/core/store`);
}

test('language setting: English by default, anything but "zh" is coerced to "en"', () => {
  const store = sandbox();
  assert.equal(store.loadSettings().language, 'en');
  assert.equal(store.saveSettings({ language: 'fr' }).language, 'en');
  assert.equal(store.saveSettings({ language: 'zh' }).language, 'zh');
  assert.equal(store.loadSettings().language, 'zh', 'persisted');
  assert.equal(store.saveSettings({ startAtLogin: false }).language, 'zh', 'other settings do not reset it');
  assert.equal(store.saveSettings({ language: null }).language, 'en');
});

test('language setting: saved through POST /api/settings, and the shell hears about a change only', async () => {
  const store = sandbox();
  const changes = [];
  const { createServer } = require(`${SRC}/server`);
  const srv = await createServer({ shell: { onLanguage: (l) => changes.push(l) } });
  try {
    const cookie = (await fetch(srv.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const post = (body) => fetch(`${srv.origin}/api/settings`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await (await post({ language: 'zh' })).json()).language, 'zh');
    assert.equal(store.loadSettings().language, 'zh');
    await post({ language: 'zh' }); // unchanged: no second notification
    await post({ language: 'klingon' }); // invalid: falls back to English
    assert.equal(store.loadSettings().language, 'en');
    const state = await (await fetch(`${srv.origin}/api/state`, { headers: { cookie } })).json();
    assert.equal(state.settings.language, 'en');
    assert.deepEqual(changes, ['zh', 'en']);
  } finally {
    srv.close();
  }
});
