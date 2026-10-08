'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE = path.join(__dirname, 'fake-claude.js');
const SRC = path.join(__dirname, '..', 'src');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-test-'));
  Object.assign(process.env, {
    BATON_HOME: path.join(root, 'home'),
    BATON_HUB: path.join(root, 'hub'),
    FAKE_STATE: path.join(root, 'state'),
    FAKE_PLAN: '{}',
    BATON_CLAUDE_CMD: JSON.stringify([process.execPath, FAKE]),
  });
  fs.mkdirSync(process.env.FAKE_STATE, { recursive: true });
  fs.mkdirSync(process.env.BATON_HUB, { recursive: true });
  return root;
}

test('--disconnect: wiring is removed, the saved sign-in stays, and it never throws', async () => {
  const root = sandbox();
  const connect = require(`${SRC}/core/connect`);
  const { disconnect } = require(`${SRC}/cli-disconnect`);
  const settings = path.join(root, 'hub', 'settings.json');
  const before = { model: 'opus' };
  fs.writeFileSync(settings, JSON.stringify(before));
  await connect.install();
  assert.equal(connect.status().all, true);
  const login = path.join(process.env.BATON_HOME, 'accounts', 'w1', '.credentials.json');
  fs.mkdirSync(path.dirname(login), { recursive: true });
  fs.writeFileSync(login, '{"stand-in":"for a saved sign-in"}');

  const line = await disconnect();
  assert.match(line, /removed from Claude Code/);
  assert.doesNotMatch(line, /\n/, 'one line');
  const st = connect.status();
  assert.deepEqual([st.hook, st.skill, st.mcp], [false, false, false]);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), before);
  assert.ok(fs.existsSync(login), 'the saved sign-in survived');

  assert.match(await disconnect(), /removed from Claude Code/, 'running it again is harmless');
  assert.match(await disconnect({ uninstall: async () => { throw new Error('boom'); } }), /could not finish \(boom\)/);
  assert.match(await disconnect({ uninstall: () => new Promise(() => {}), limitMs: 20 }), /timed out/);
});
