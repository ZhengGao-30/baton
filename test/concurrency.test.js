'use strict';
// Several Claude windows use Baton at the same time. None of them may be refused, stalled, lose its session or leave
// a lock behind because of the others. Every "window" is its own OS process sharing one Baton home folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FAKE = path.join(__dirname, 'fake-claude.js');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sandbox({ plan = {}, delay = 150, accounts = [['lead', { desktop: true }], ['w1', {}], ['w2', {}]] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-conc-'));
  const env = {
    BATON_HOME: path.join(root, 'home'), BATON_HUB: path.join(root, 'hub'), FAKE_STATE: path.join(root, 'state'),
    FAKE_PLAN: JSON.stringify(plan), FAKE_DELAY_MS: String(delay), BATON_CLAUDE_CMD: JSON.stringify([process.execPath, FAKE]),
    BATON_TICK: '0.05', BATON_SLACK: '0',
  };
  for (const d of [env.FAKE_STATE, env.BATON_HUB]) fs.mkdirSync(d, { recursive: true });
  Object.assign(process.env, env);
  delete process.env.BATON_TAKEOVER;
  const store = require('../src/core/store');
  store.save(accounts.map(([n, extra]) => ({ ...store.newAccount(n, path.join(root, 'home', 'accounts', n), `${n}@x.com`), ...extra })));
  const folder = (name) => { const d = path.join(root, name); fs.mkdirSync(d, { recursive: true }); return d; };
  const invocations = () => {
    const f = path.join(env.FAKE_STATE, 'invocations.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  return { root, env, store, folder, invocations };
}

// Start one "window" process; resolves with the JSON line it prints.
function windowProc(s, cfg) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'helpers', 'conc-run.js'), JSON.stringify({ env: s.env, ...cfg })], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', () => {
      const line = out.trim().split('\n').filter(Boolean).pop();
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, code: 'no_output', text: err.slice(-300) || out.slice(-300) }); }
    });
  });
}

test('many windows writing the account list at once: nobody throws, nobody loses an update', async () => {
  const s = sandbox();
  const K = 6, N = 25;
  const results = await Promise.all(Array.from({ length: K }, (_, k) => windowProc(s, { mode: 'store', account: 'w1', k, n: N })));
  assert.deepEqual(results.map((r) => r.ok), Array(K).fill(true), `every writer finished: ${JSON.stringify(results.filter((r) => !r.ok))}`);
  const w1 = s.store.get('w1');
  for (let k = 0; k < K; k++) assert.equal(w1[`p${k}`], N - 1, `writer ${k}'s last update survived`);
  assert.equal(s.store.load().length, 3, 'the account list is intact');
});

test('six windows start jobs at the same moment in six folders: all finish, the load is spread over the workers', async () => {
  const s = sandbox({ delay: 200 });
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => windowProc(s, { mode: 'run', task: `job ${i}`, cwd: s.folder(`proj${i}`), thread: `t${i}` })));
  assert.deepEqual(res.map((r) => r.code), Array(6).fill('done'), JSON.stringify(res.filter((r) => r.code !== 'done')));
  const used = new Set(s.invocations().map((i) => i.account));
  assert.deepEqual([...used].sort(), ['w1', 'w2'], 'both worker accounts took part, not just the first one in the list');
  assert.ok(!s.invocations().some((i) => i.account === 'lead'), 'the leader account is never used');
});

test('account 1 does A while account 2 starts B: A is not disturbed, both finish on their own accounts', async () => {
  const s = sandbox({ delay: 500 });
  const A = windowProc(s, { mode: 'run', task: 'job A', cwd: s.folder('projA'), thread: 'a', pin: 'w1' });
  await sleep(700); // A is in the middle of its work
  const noise = Array.from({ length: 4 }, (_, k) => windowProc(s, { mode: 'store', account: 'lead', k, n: 20 })); // other windows busy writing the account list
  const B = windowProc(s, { mode: 'run', task: 'job B', cwd: s.folder('projB'), thread: 'b', pin: 'w2' });
  const [a, b] = await Promise.all([A, B]);
  const writers = await Promise.all(noise);
  assert.equal(a.code, 'done', `A finished: ${JSON.stringify(a)}`);
  assert.equal(b.code, 'done', `B finished: ${JSON.stringify(b)}`);
  assert.match(a.account, /^w1@/, 'A ran on account 1');
  assert.match(b.account, /^w2@/, 'B ran on account 2');
  assert.deepEqual(writers.map((w) => w.ok), [true, true, true, true], 'the other windows were not hurt either');
});

test('windows working in the SAME folder are queued, not refused', async () => {
  const s = sandbox({ delay: 200 });
  const cwd = s.folder('shared');
  const t0 = Date.now();
  const res = await Promise.all(['a', 'b', 'c'].map((t) => windowProc(s, { mode: 'run', task: `job ${t}`, cwd, thread: t })));
  assert.deepEqual(res.map((r) => r.code), ['done', 'done', 'done'], `nobody gets BUSY: ${JSON.stringify(res)}`);
  assert.ok(Date.now() - t0 >= 3 * 3 * 200 * 0.8, 'they ran one after the other, not on top of each other');
  const projects = path.join(s.env.BATON_HOME, 'projects');
  const ledger = fs.readdirSync(projects).flatMap((d) => fs.readFileSync(path.join(projects, d, 'ledger.jsonl'), 'utf8').trim().split('\n'));
  assert.equal(ledger.length, 3, 'all three runs were recorded');
  const left = fs.readdirSync(projects).filter((d) => fs.existsSync(path.join(projects, d, 'lock.json')));
  assert.deepEqual(left, [], 'no lock is left behind');
});

test('a lock whose owner stopped reporting in is taken over even if its process id is still alive', async () => {
  const s = sandbox({ delay: 50 });
  const cwd = s.folder('stale');
  const memory = require('../src/core/memory');
  const dir = memory.projectDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const old = Date.now() - 10 * 60 * 1000;
  // a live pid (this test process) that has not sent a heartbeat for 10 minutes: its owner is stuck or gone
  fs.writeFileSync(path.join(dir, 'lock.json'), JSON.stringify({ pid: process.pid, at: old, beat: old, thread: 'ghost' }));
  const r = await windowProc(s, { mode: 'run', task: 'after the ghost', cwd, thread: 'real' });
  assert.equal(r.code, 'done', JSON.stringify(r));
});

test('a stopped job keeps its session: the same thread resumes it later', async () => {
  const s = sandbox({ plan: { w1: ['limit:3600', 'ok'] }, accounts: [['lead', { desktop: true }], ['w1', {}]] });
  const cwd = s.folder('resume');
  const first = await windowProc(s, { mode: 'run', task: 'big job', cwd, thread: 'big' });
  assert.equal(first.code, 'workers_limited', JSON.stringify(first));
  const memory = require('../src/core/memory');
  const th = memory.getThread(cwd, 'big');
  assert.ok(th && th.sessionId, 'the worker session was saved even though the run stopped');
  s.store.update('w1', { blockedUntil: 0, blockedReason: '' }); // the limit is over
  const second = await windowProc(s, { mode: 'run', task: 'continue the big job', cwd, thread: 'big' });
  assert.equal(second.code, 'done', JSON.stringify(second));
  const inv = s.invocations();
  assert.equal(inv[inv.length - 1].resume, th.sessionId, 'the second run resumed the saved session');
});

// ---- the Baton tool process that every Claude window starts (src/mcp.js) ----
function mcp(s) {
  const c = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp.js')], { cwd: ROOT, env: { ...process.env, ...s.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let buf = '';
  c.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch { /* not a response */ }
    }
  });
  let id = 0;
  const send = (m) => c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  const call = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); send({ id: i, method, params }); });
  return { c, send, call, lastId: () => id, close: () => { try { c.stdin.end(); } catch { /* gone */ } } };
}
const fakePids = (s) => { try { return fs.readdirSync(path.join(s.env.FAKE_STATE, 'pids')).map(Number); } catch { return []; } };
const lockFiles = (s) => { const root = path.join(s.env.BATON_HOME, 'projects'); try { return fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'lock.json'))); } catch { return []; } };
const killAll = (pids) => pids.forEach((p) => { try { process.kill(p); } catch { /* gone */ } });
const INIT = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } };

test('closing a Claude window stops its worker and releases its folder', async () => {
  const s = sandbox({ plan: { w1: ['hang'], w2: ['hang'] } });
  const cwd = s.folder('closing');
  const m = mcp(s);
  await m.call('initialize', INIT);
  m.call('tools/call', { name: 'baton_run', arguments: { task: 'hangs forever', cwd, thread: 'x' } });
  for (let i = 0; i < 60 && !fakePids(s).length; i++) await sleep(100);
  assert.ok(fakePids(s).length, 'the worker started');
  assert.equal(lockFiles(s).length, 1, 'the folder is locked while it runs');
  m.close(); // the window was closed
  for (let i = 0; i < 50 && (fakePids(s).some(alive) || lockFiles(s).length); i++) await sleep(100);
  const still = fakePids(s).filter(alive);
  const locks = lockFiles(s);
  killAll(still);
  assert.deepEqual(still, [], 'no worker process is left running');
  assert.deepEqual(locks, [], 'the folder lock is gone');
});

test('stopping a job from the window (cancel) stops its worker and frees the folder at once', async () => {
  const s = sandbox({ plan: { w1: ['hang'], w2: ['hang'] } });
  const cwd = s.folder('cancel');
  const m = mcp(s);
  await m.call('initialize', INIT);
  m.call('tools/call', { name: 'baton_run', arguments: { task: 'hangs forever', cwd, thread: 'y' } });
  const requestId = m.lastId();
  for (let i = 0; i < 60 && !fakePids(s).length; i++) await sleep(100);
  assert.ok(fakePids(s).length, 'the worker started');
  m.send({ method: 'notifications/cancelled', params: { requestId, reason: 'user pressed stop' } });
  for (let i = 0; i < 50 && (fakePids(s).some(alive) || lockFiles(s).length); i++) await sleep(100);
  const still = fakePids(s).filter(alive);
  const locks = lockFiles(s);
  m.close();
  killAll(still);
  assert.deepEqual(still, [], 'the worker was stopped');
  assert.deepEqual(locks, [], 'the folder lock is gone');
});

test('a stray error inside the Baton tool process does not take it down: the window stays connected', async () => {
  // This is what a status-file rename colliding with the panel's reader used to do: an uncaught exception ended the
  // process, the window showed Baton as "disconnected" and every job of that window died with it.
  const s = sandbox();
  const c = spawn(process.execPath, ['--require', path.join(__dirname, 'helpers', 'boom.js'), path.join(ROOT, 'src', 'mcp.js')], { cwd: ROOT, env: { ...process.env, ...s.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '', exited = null;
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (err += d));
  c.on('exit', (code) => { exited = code; });
  await sleep(900); // the stray exception and the stray rejection have both happened by now
  assert.equal(exited, null, `the tool process is still running (stderr: ${err.slice(-200)})`);
  c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`);
  for (let i = 0; i < 30 && !out.includes('"id":7'); i++) await sleep(100);
  c.stdin.end();
  assert.ok(out.includes('"id":7'), 'and it still answers the window');
  assert.match(err, /kept running/, 'the error was logged, not swallowed silently');
});
