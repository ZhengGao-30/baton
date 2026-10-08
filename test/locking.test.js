'use strict';
// The pieces under the concurrency guarantees: the cross-process file lock, folder locks with heartbeats, the
// first-come-first-served queue, and cancelling a job (queued or running) without leaving anything behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FAKE = path.join(__dirname, 'fake-claude.js');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid; // a process that has already exited

process.env.BATON_LOCK_BEAT_MS = '200'; // read when memory.js loads: watch heartbeats without waiting 5 s

function sandbox({ plan = {}, delay = 150, accounts = [['lead', { desktop: true }], ['w1', {}], ['w2', {}]] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-lock-'));
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

const runFiles = (s) => { try { return fs.readdirSync(path.join(s.env.BATON_HOME, 'runs')); } catch { return []; } };
const tickets = (memory, cwd) => { try { return fs.readdirSync(path.join(memory.projectDir(cwd), 'queue')); } catch { return []; } };

// ---- fslock ----

test('fslock: four processes incrementing one counter 50 times each lose no update', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-fslock-'));
  const file = path.join(root, 'counter');
  fs.writeFileSync(file, '0');
  const procs = Array.from({ length: 4 }, () => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'helpers', 'counter.js'), file, '50'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => resolve({ code, out }));
  }));
  const res = await Promise.all(procs);
  assert.deepEqual(res.map((r) => r.code), [0, 0, 0, 0], JSON.stringify(res));
  assert.equal(Number(fs.readFileSync(file, 'utf8')), 200, 'every increment survived');
  assert.ok(!fs.existsSync(`${file}.lock`), 'the lock is gone afterwards');
});

test('fslock: a lock left by a dead process is broken, and an exception never leaves the lock behind', () => {
  const { withFileLock } = require('../src/core/fslock');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-fslock-'));
  const file = path.join(root, 'thing');
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: deadPid(), token: 'x', at: Date.now() }));
  const t0 = Date.now();
  assert.equal(withFileLock(file, () => 42, { timeoutMs: 3000 }), 42);
  assert.ok(Date.now() - t0 < 2000, 'it did not wait for the time-out');
  assert.throws(() => withFileLock(file, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(`${file}.lock`), 'released after the exception');
  // a live owner that is too old is stale as well
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: process.ppid, token: 'y', at: Date.now() - 60000 }));
  assert.equal(withFileLock(file, () => 'taken', { timeoutMs: 3000, staleMs: 15000 }), 'taken');
  // nested use of the same lock in one call stack does not deadlock
  assert.equal(withFileLock(file, () => withFileLock(file, () => 'inner')), 'inner');
});

test('store and memory writes leave no temp or lock files behind', () => {
  const s = sandbox();
  for (let i = 0; i < 5; i++) s.store.update('w1', { n: i });
  const memory = require('../src/core/memory');
  const cwd = s.folder('tidy');
  memory.putThread(cwd, 't', { title: 'x' });
  const leftovers = (dir) => fs.readdirSync(dir).filter((n) => /\.tmp$|\.lock$/.test(n));
  assert.deepEqual(leftovers(s.env.BATON_HOME), []);
  assert.deepEqual(leftovers(memory.projectDir(cwd)), []);
  assert.equal(s.store.get('w1').n, 4);
});

// ---- folder locks ----

test('folder lock: the owner keeps beating, a silent or dead owner loses it, release only removes your own', async () => {
  const s = sandbox();
  const memory = require('../src/core/memory');
  const cwd = s.folder('beat');
  const f = path.join(memory.projectDir(cwd), 'lock.json');

  const a = memory.acquireLock(cwd, { thread: 'a' });
  assert.ok(a.release, 'free folder: taken');
  const first = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(first.pid, process.pid);
  for (const k of ['token', 'at', 'beat', 'thread']) assert.ok(k in first, `lock has ${k}`);
  await sleep(700);
  const later = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(later.beat > first.beat, 'the heartbeat moved on');
  assert.equal(later.token, first.token);
  assert.ok(memory.acquireLock(cwd, { thread: 'b' }).busy, 'a beating owner keeps the folder, even in the same process');
  a.release();
  assert.ok(!fs.existsSync(f), 'released');

  // someone else's live lock with a fresh beat is respected; with a beat older than 45 s it is taken over
  fs.writeFileSync(f, JSON.stringify({ pid: process.ppid, token: 'other', at: Date.now(), beat: Date.now(), thread: 'other' }));
  assert.equal(memory.acquireLock(cwd, { thread: 'c' }).busy.thread, 'other');
  fs.writeFileSync(f, JSON.stringify({ pid: process.ppid, token: 'other', at: Date.now() - 600000, beat: Date.now() - 50000, thread: 'other' }));
  const c = memory.acquireLock(cwd, { thread: 'c' });
  assert.ok(c.release, 'a silent owner lost the folder');
  // ... and the stuck owner's heartbeat or release cannot take it back: it is no longer theirs
  fs.writeFileSync(f, JSON.stringify({ pid: deadPid(), token: 'dead', at: Date.now(), beat: Date.now(), thread: 'dead' }));
  c.release();
  assert.ok(fs.existsSync(f), 'release does not remove a lock that is not ours');
  const d = memory.acquireLock(cwd, { thread: 'd' });
  assert.ok(d.release, 'a dead owner lost the folder at once');
  d.release();
  assert.ok(!fs.existsSync(f));
});

test('folder lock: only one of many simultaneous takers wins a stale lock', async () => {
  const s = sandbox();
  const memory = require('../src/core/memory');
  const cwd = s.folder('race');
  const f = path.join(memory.projectDir(cwd), 'lock.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ pid: deadPid(), token: 'dead', at: Date.now(), beat: Date.now(), thread: 'dead' }));
  const code = `
    Object.assign(process.env, ${JSON.stringify(s.env)});
    const memory = require(${JSON.stringify(path.join(ROOT, 'src', 'core', 'memory.js'))});
    const r = memory.acquireLock(${JSON.stringify(cwd)}, { thread: 'p' + process.pid });
    console.log(r.release ? 'won' : 'lost');
    setTimeout(() => { if (r.release) r.release(); }, 1500);`;
  const outs = await Promise.all(Array.from({ length: 5 }, () => new Promise((resolve) => {
    const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (x) => (out += x));
    c.stderr.on('data', (x) => (out += x));
    c.on('close', () => resolve(out.trim()));
  })));
  assert.equal(outs.filter((o) => o === 'won').length, 1, JSON.stringify(outs));
  assert.ok(!fs.existsSync(f), 'the winner released it on the way out');
});

// ---- the queue ----

test('queue: jobs in one folder run in the order they arrived', async () => {
  const s = sandbox({ delay: 150 });
  const memory = require('../src/core/memory');
  const cwd = s.folder('fifo');
  const lockFile = path.join(memory.projectDir(cwd), 'lock.json');
  const start = (t) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'helpers', 'conc-run.js'), JSON.stringify({ env: s.env, mode: 'run', task: `job ${t}`, cwd, thread: t })], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { resolve({ code: 'no_output', text: out }); } });
  });
  const order = ['a', 'b', 'c', 'd'];
  const jobs = [start('a')];
  for (let i = 0; i < 60 && !fs.existsSync(lockFile); i++) await sleep(100); // a holds the folder
  for (const [k, t] of order.slice(1).entries()) {
    jobs.push(start(t));
    for (let i = 0; i < 60 && tickets(memory, cwd).length < k + 1; i++) await sleep(50); // t is in line before the next arrives
  }
  const res = await Promise.all(jobs);
  assert.deepEqual(res.map((r) => r.code), ['done', 'done', 'done', 'done'], JSON.stringify(res));
  const ran = s.invocations().map((i) => (/job (\w)/.exec(i.prompt) || [])[1]);
  assert.deepEqual(ran, order, 'first come, first served');
  assert.deepEqual(tickets(memory, cwd), [], 'no ticket left behind');
});

test('queue: a waiting job shows that it waits, can be cancelled, and gives up with BUSY only after the wait limit', async () => {
  const s = sandbox();
  const memory = require('../src/core/memory');
  const { runWorker } = require('../src/core/workers');
  const cwd = s.folder('waiting');
  const held = memory.acquireLock(cwd, { thread: 'holder' });
  assert.ok(held.release);

  const ctl = new AbortController();
  const progress = [];
  const p = runWorker({ task: 'queued job', cwd, thread: 'q', signal: ctl.signal, onProgress: (l) => progress.push(l) });
  let run = null;
  for (let i = 0; i < 40 && !run; i++) {
    await sleep(100);
    run = memory.listRuns().find((r) => r.thread === 'q' && r.status === 'waiting') || null;
  }
  assert.ok(run, 'the run file says it is waiting');
  assert.match(run.lastLine, /Waiting for another worker in this folder \(thread holder\)/);
  assert.match(progress[0] || '', /Waiting for another worker/, 'the dispatcher hears it too');
  assert.equal(tickets(memory, cwd).length, 1, 'it holds a place in line');
  ctl.abort();
  const r = await p;
  assert.equal(r.code, 'cancelled');
  assert.deepEqual(tickets(memory, cwd), [], 'its ticket is gone');
  assert.deepEqual(runFiles(s), [], 'its run file is gone');
  assert.equal(s.invocations().length, 0, 'no worker was started');

  process.env.BATON_QUEUE_WAIT_SEC = '1';
  const t0 = Date.now();
  const busy = await runWorker({ task: 'another', cwd, thread: 'q2' });
  delete process.env.BATON_QUEUE_WAIT_SEC;
  assert.equal(busy.code, 'busy');
  assert.match(busy.text, /^BUSY: .*thread "holder"/);
  assert.ok(Date.now() - t0 >= 900, 'it waited first');
  assert.deepEqual(tickets(memory, cwd), []);
  held.release();
});

// ---- cancel ----

test('cancel: a running job is stopped, its folder and run file freed, and its session kept for the thread', async () => {
  const s = sandbox({ plan: { w1: ['hang'], w2: ['hang'] } });
  const memory = require('../src/core/memory');
  const { runWorker } = require('../src/core/workers');
  const cwd = s.folder('cancel-run');
  const ctl = new AbortController();
  const p = runWorker({ task: 'hangs', cwd, thread: 'h', signal: ctl.signal });
  const pidsDir = path.join(s.env.FAKE_STATE, 'pids');
  const pids = () => { try { return fs.readdirSync(pidsDir).map(Number); } catch { return []; } };
  for (let i = 0; i < 60 && !pids().length; i++) await sleep(100);
  assert.equal(pids().length, 1, 'the worker started');
  await sleep(200); // let it report its session
  ctl.abort();
  const r = await p;
  assert.equal(r.code, 'cancelled');
  for (let i = 0; i < 30 && pids().some(alive); i++) await sleep(100);
  const still = pids().filter(alive);
  still.forEach((x) => { try { process.kill(x); } catch { /* gone */ } });
  assert.deepEqual(still, [], 'the worker process is gone');
  assert.ok(!fs.existsSync(path.join(memory.projectDir(cwd), 'lock.json')), 'the folder is free');
  assert.deepEqual(runFiles(s), [], 'no run file is left');
  const th = memory.getThread(cwd, 'h');
  assert.ok(th && th.sessionId && th.stopped, 'the session is kept for the same thread');
  const last = memory.readLedger(cwd).pop();
  assert.equal(last.ok, false);
  assert.match(last.summary, /CANCELLED/);
});

test('picking: simultaneous jobs go to the least busy worker, an explicit account still wins', () => {
  const s = sandbox({ accounts: [['lead', { desktop: true }], ['w1', {}], ['w2', {}], ['w3', {}]] });
  const memory = require('../src/core/memory');
  const { Engine } = require('../src/core/engine');
  // another window's run is on w1
  memory.writeRun('other', { pid: process.ppid, account: 'w1', status: 'running', updatedAt: Date.now() });
  const e1 = new Engine(); e1.filter = (a) => !a.desktop;
  const e2 = new Engine(); e2.filter = (a) => !a.desktop;
  const picked = [e1._pick(null).name, e2._pick(null).name];
  assert.deepEqual(picked.sort(), ['w2', 'w3'], 'w1 is busy elsewhere, and the two new jobs do not pile onto one account');
  const e3 = new Engine(); e3.filter = (a) => !a.desktop;
  assert.equal(e3._pick('w2').name, 'w2', 'an explicitly chosen ready account is honoured');
  memory.removeRun('other');
});
