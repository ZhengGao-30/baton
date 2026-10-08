'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE = path.join(__dirname, 'fake-claude.js');

function sandbox(plan, accountNames = ['a', 'b']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-test-'));
  process.env.BATON_HOME = path.join(root, 'home');
  process.env.BATON_HUB = path.join(root, 'hub');
  process.env.FAKE_STATE = path.join(root, 'state');
  process.env.FAKE_PLAN = JSON.stringify(plan);
  process.env.BATON_CLAUDE_CMD = JSON.stringify([process.execPath, FAKE]);
  process.env.BATON_TICK = '0.05';
  process.env.BATON_SLACK = '0';
  fs.mkdirSync(process.env.FAKE_STATE, { recursive: true });
  fs.mkdirSync(process.env.BATON_HUB, { recursive: true });
  const store = require('../src/core/store');
  store.save(accountNames.map((n) => store.newAccount(n, path.join(root, 'home', 'accounts', n))));
  const { Engine } = require('../src/core/engine');
  const invocations = () =>
    fs.readFileSync(path.join(process.env.FAKE_STATE, 'invocations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { store, engine: new Engine(), invocations, root };
}

test('limit on the first account: same session continues on the next one', async () => {
  const { store, engine, invocations } = sandbox({ a: ['limit:3600'], b: ['ok'] });
  await engine.send({ prompt: 'refactor the parser' });
  const [first, second] = invocations();
  assert.equal(first.account, 'a');
  assert.equal(first.resume, null);
  assert.equal(first.prompt, 'refactor the parser');
  assert.equal(second.account, 'b');
  assert.ok(second.resume, 'second attempt must resume the first one\'s session');
  assert.match(second.prompt, /Continue exactly where you left off/);
  const a = store.get('a');
  assert.ok(a.blockedUntil > store.nowSec() + 3500, 'a is parked until its reset time');
  assert.equal(a.blockedReason, 'five_hour');
  assert.equal(engine.status, 'idle');
  assert.equal(engine.account, 'b');
  assert.ok(engine.items.some((i) => i.kind === 'notice' && i.level === 'switch'));
});

test('limit message without a structured event (legacy text) is still recognised', async () => {
  const { store, engine, invocations } = sandbox({ a: ['limit-text:3600'], b: ['ok'] });
  await engine.send({ prompt: 'go' });
  assert.deepEqual(invocations().map((i) => i.account), ['a', 'b']);
  assert.ok(store.get('a').blockedUntil > store.nowSec() + 3500);
});

test('every account limited: waits for the earliest reset, then resumes on it', async () => {
  const { engine, invocations } = sandbox({ a: ['limit:2', 'ok'], b: ['limit:4'] });
  const t0 = Date.now();
  await engine.send({ prompt: 'long job' });
  assert.deepEqual(invocations().map((i) => i.account), ['a', 'b', 'a']);
  assert.ok(Date.now() - t0 >= 1000, 'it really waited for a to reset');
  assert.equal(invocations()[2].resume, invocations()[1].resume);
  assert.equal(engine.status, 'idle');
});

test('expired login on one account: marked needs-login, next account takes over', async () => {
  const { store, engine, invocations } = sandbox({ a: ['auth'], b: ['ok'] });
  await engine.send({ prompt: 'x' });
  assert.equal(store.get('a').needsLogin, true);
  assert.deepEqual(invocations().map((i) => i.account), ['a', 'b']);
});

test('a context-length error is not mistaken for an account limit', async () => {
  const { store, engine, invocations } = sandbox({ a: ['context-limit'], b: ['ok'] });
  await engine.send({ prompt: 'x' });
  assert.equal(invocations().length, 1);
  assert.equal(engine.status, 'error');
  assert.equal(store.get('a').blockedUntil, 0);
});

test('follow-up message sticks to the account that is working', async () => {
  const { engine, invocations } = sandbox({ a: ['limit:3600'], b: ['ok', 'ok'] });
  await engine.send({ prompt: 'one' });
  await engine.send({ prompt: 'two' });
  assert.deepEqual(invocations().map((i) => i.account), ['a', 'b', 'b']);
  assert.equal(invocations()[2].prompt, 'two');
  assert.equal(invocations()[2].resume, invocations()[1].resume);
});

test('no usable account is a clear error, not a hang', async () => {
  const { engine } = sandbox({}, []);
  await engine.send({ prompt: 'x' });
  assert.equal(engine.status, 'error');
  assert.match(engine.items.at(-1).text, /No usable account/);
});

test('stop() kills a running attempt', async () => {
  const { engine } = sandbox({ a: ['hang'] });
  const p = engine.send({ prompt: 'x' });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(engine.running, true);
  engine.stop();
  await p;
  assert.equal(engine.status, 'idle');
  assert.equal(engine.running, false);
  assert.ok(engine.items.some((i) => i.text === 'Stopped.'));
});

test('parseReset handles the formats Claude Code prints', () => {
  const { parseReset, looksLikeLimit } = require('../src/core/parse');
  const now = new Date(2026, 9, 8, 10, 0, 0).getTime() / 1000; // Thu 8 Oct 2026 10:00 local
  assert.equal(parseReset('Claude AI usage limit reached|1760000000', now), 1760000000);
  const at = (s) => new Date(parseReset(s, now) * 1000);
  assert.equal(at("You've hit your session limit · resets 3pm").getHours(), 15);
  assert.equal(at("You've hit your session limit · resets 3pm").getDate(), 8);
  assert.equal(at('5-hour limit reached ∙ resets 9:30am').getDate(), 9); // 9:30am already passed today
  assert.equal(at('limit reached ∙ resets Oct 12, 4am').getDate(), 12);
  assert.equal(parseReset('no time in here', now), null);
  assert.ok(looksLikeLimit("You've hit your weekly limit"));
  assert.ok(!looksLikeLimit('Context limit reached · /compact'));
});
