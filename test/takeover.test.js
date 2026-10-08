'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE = path.join(__dirname, 'fake-claude.js');

function sandbox(plan, accounts = [['a', { desktop: true }], ['b', {}]]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-test-'));
  Object.assign(process.env, {
    BATON_HOME: path.join(root, 'home'),
    BATON_HUB: path.join(root, 'hub'),
    FAKE_STATE: path.join(root, 'state'),
    FAKE_PLAN: JSON.stringify(plan),
    BATON_CLAUDE_CMD: JSON.stringify([process.execPath, FAKE]),
    BATON_TICK: '0.05',
    BATON_SLACK: '0',
  });
  fs.mkdirSync(process.env.FAKE_STATE, { recursive: true });
  fs.mkdirSync(path.join(root, 'project'), { recursive: true });
  fs.mkdirSync(process.env.BATON_HUB, { recursive: true });
  const store = require('../src/core/store');
  store.save(accounts.map(([n, extra]) => ({ ...store.newAccount(n, path.join(root, 'home', 'accounts', n)), ...extra })));
  const { Takeovers } = require('../src/core/takeover');
  const mgr = new Takeovers();
  const invocations = () => {
    const f = path.join(process.env.FAKE_STATE, 'invocations.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  const finished = () => new Promise((r) => (mgr.jobs.size ? mgr.once('notify', function w(e) { return ['done', 'failed', 'stopped'].includes(e.kind) ? r(e) : mgr.once('notify', w); }) : r()));
  const hook = (over = {}) => ({
    hook_event_name: 'StopFailure', error: 'rate_limit', session_id: 'sess-1', cwd: path.join(root, 'project'),
    error_message: "You've hit your session limit · resets 3pm", transcript_path: path.join(root, 'nowhere.jsonl'), ...over,
  });
  return { store, mgr, invocations, finished, hook, root };
}

test('rate_limit event from the desktop account: next account resumes the same session', async () => {
  const { store, mgr, invocations, finished, hook } = sandbox({ b: ['ok'] });
  const res = mgr.handleHook(hook());
  assert.ok(res.job, 'a takeover job starts');
  const end = await finished();
  assert.equal(end.kind, 'done');
  const [run] = invocations();
  assert.equal(run.account, 'b');
  assert.equal(run.resume, 'sess-1');
  assert.match(run.prompt, /Continue exactly where you left off/);
  assert.ok(store.get('a').blockedUntil > store.nowSec(), 'the account that hit its limit is parked');
  assert.equal(mgr.recent[0].status, 'done');
  assert.match(mgr.recent[0].lastLine, /parser|Edit|tests/i);
});

test('a takeover continues the window\'s session as it was: the worker account\'s default model is not applied', async () => {
  const { invocations, finished, hook, mgr } = sandbox({ b: ['ok'] }, [['a', { desktop: true }], ['b', { model: 'haiku' }]]);
  assert.ok(mgr.handleHook(hook()).job);
  await finished();
  assert.equal(invocations()[0].account, 'b');
  assert.equal(invocations()[0].model, null);
});

test('events that are not a plan limit, or come from our own runs, are ignored', () => {
  const { mgr, invocations, hook } = sandbox({ b: ['ok'] });
  assert.ok(mgr.handleHook(hook({ error: 'server_error' })).ignored);
  assert.ok(mgr.handleHook(hook(), { takeover: '1' }).ignored);
  assert.ok(mgr.handleHook(hook({ session_id: '' })).ignored);
  assert.equal(invocations().length, 0);
});

test('the same session reported twice is taken over once', async () => {
  const { mgr, invocations, finished, hook } = sandbox({ b: ['ok'] });
  assert.ok(mgr.handleHook(hook()).job);
  assert.match(mgr.handleHook(hook()).ignored, /already/);
  await finished();
  assert.equal(invocations().length, 1);
});

test('origin is found by CLAUDE_CONFIG_DIR when the event carries it', async () => {
  const { store, mgr, invocations, finished, hook, root } = sandbox({ a: ['ok'] }, [['a', {}], ['b', { desktop: true }]]);
  mgr.handleHook(hook(), { configDir: path.join(root, 'home', 'accounts', 'a') });
  await finished();
  assert.ok(store.get('a').blockedUntil > store.nowSec(), 'a (from the env) is the one parked');
  assert.equal(store.get('b').blockedUntil, 0, 'the desktop flag does not override the real origin');
  assert.equal(invocations()[0].account, 'b');
});

test('a transient "retry after N seconds" limit only parks the origin briefly', async () => {
  const { store, mgr, finished, hook } = sandbox({ b: ['ok'] });
  mgr.handleHook(hook({ error_message: 'Rate limit exceeded. Please retry after 30 seconds.' }));
  await finished();
  const left = store.get('a').blockedUntil - store.nowSec();
  assert.ok(left > 20 && left < 40, `parked for ~30s, got ${left}`);
});

test('the transcript is copied into the account that takes over, and progress copied back', async () => {
  const { mgr, finished, hook, root } = sandbox({ b: ['ok'] });
  const original = path.join(root, 'desktop-projects', 'proj-enc', 'sess-1.jsonl');
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.writeFileSync(original, '{"type":"user"}\n');
  fs.utimesSync(original, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  const setup = require('../src/core/setup');
  const store = require('../src/core/store');
  const b = store.get('b');
  const origPrepare = setup.ensureSession;
  mgr.handleHook(hook({ transcript_path: original }));
  await finished();
  const copy = path.join(b.configDir, 'projects', 'proj-enc', 'sess-1.jsonl');
  assert.ok(fs.existsSync(copy), 'transcript was copied into b');
  assert.equal(typeof origPrepare, 'function');
  // simulate b appending progress, then syncing back
  fs.appendFileSync(copy, '{"type":"assistant"}\n');
  setup.syncSessionBack(b, { sessionId: 'sess-1', transcriptPath: original });
  assert.match(fs.readFileSync(original, 'utf8'), /assistant/);
});

test('installing the hook merges with existing hooks, backs up, and uninstalls cleanly', () => {
  const { root } = sandbox({});
  const settings = path.join(root, 'hub', 'settings.json');
  const before = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }], StopFailure: [{ matcher: 'overloaded', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  fs.writeFileSync(settings, JSON.stringify(before));
  const hook = require('../src/core/hook');

  assert.equal(hook.status().installed, false);
  assert.equal(hook.install().installed, true);
  hook.install(); // idempotent
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(after.model, 'opus');
  assert.deepEqual(after.hooks.Stop, before.hooks.Stop);
  assert.equal(after.hooks.StopFailure.length, 2, 'ours is added next to the user\'s own entry, once');
  assert.equal(after.hooks.StopFailure.find((e) => e.matcher === 'rate_limit').hooks[0].type, 'command');
  assert.deepEqual(JSON.parse(fs.readFileSync(`${settings}.baton-backup`, 'utf8')), before);

  assert.equal(hook.uninstall().installed, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), before);
});

test('a settings.json that is not valid JSON is never overwritten', () => {
  const { root } = sandbox({});
  const settings = path.join(root, 'hub', 'settings.json');
  fs.writeFileSync(settings, '{ not json');
  assert.throws(() => require('../src/core/hook').install(), /not valid JSON/);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{ not json');
});
