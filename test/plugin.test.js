'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const FAKE = path.join(__dirname, 'fake-claude.js');
const ROOT_SRC = path.join(__dirname, '..', 'src');

function sandbox(plan, accounts) {
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
  delete process.env.BATON_TAKEOVER;
  fs.mkdirSync(process.env.FAKE_STATE, { recursive: true });
  fs.mkdirSync(path.join(root, 'project'), { recursive: true });
  fs.mkdirSync(process.env.BATON_HUB, { recursive: true });
  const store = require(`${ROOT_SRC}/core/store`);
  accounts = accounts || [['lead', 'lead@x.com', { desktop: true }], ['w1', 'w1@x.com', {}], ['w2', 'w2@x.com', {}]];
  store.save(accounts.map(([n, email, extra]) => ({ ...store.newAccount(n, path.join(root, 'home', 'accounts', n), email), ...extra })));
  const invocations = () => {
    const f = path.join(process.env.FAKE_STATE, 'invocations.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  return { store, root, project: path.join(root, 'project'), invocations };
}

test('the official /usage text becomes numbers and reset instants', () => {
  const { parseUsage, parseResetText } = require(`${ROOT_SRC}/core/usage`);
  const text = [
    'You are currently using your subscription', '',
    'Current session: 2% used · resets Oct 8, 5pm (Australia/Sydney)',
    'Current week (all models): 20% used · resets Oct 14, 4pm (Australia/Sydney)',
    'Current week (Fable): 0% used · resets Oct 14, 4pm (Australia/Sydney)',
  ].join('\n');
  const now = Date.UTC(2026, 9, 8, 1, 0, 0); // 8 Oct 2026 01:00 UTC = 12:00 in Sydney (UTC+11)
  const u = parseUsage(text, now);
  assert.equal(u.session.pct, 2);
  assert.equal(u.week.pct, 20);
  assert.equal(u.others[0].label, 'Current week (Fable)');
  assert.equal(u.session.resetsAt, Date.UTC(2026, 9, 8, 6, 0, 0) / 1000, '5pm Sydney (UTC+11) = 06:00 UTC');
  assert.equal(u.week.resetsAt, Date.UTC(2026, 9, 14, 5, 0, 0) / 1000, '4pm Sydney on the 14th = 05:00 UTC');
  assert.equal(parseUsage('Unknown skill: usage'), null);
  assert.equal(parseResetText('3am (UTC)', Date.UTC(2026, 0, 1, 12, 0, 0)), Date.UTC(2026, 0, 2, 3, 0, 0) / 1000, 'time without a date rolls to tomorrow');
});

test('a usage reading corrects the registry: full means parked, plenty left means unparked', () => {
  const { store } = sandbox({}, [['a', 'a@x.com', { blockedUntil: Date.now() / 1000 + 9999, blockedReason: 'five_hour' }]]);
  const usage = require(`${ROOT_SRC}/core/usage`);
  // simulate applyTruth through refresh() using the fake claude (12% used): the stale block is lifted
  return usage.refresh('a').then((entry) => {
    assert.equal(entry.data.session.pct, 12);
    assert.equal(store.get('a').blockedUntil, 0, 'a simulated or stale block is cleared by the official numbers');
  });
});

test('leader follows the e-mail of the window, and an outside account is remembered', () => {
  const { store } = sandbox({});
  assert.equal(store.observeLeader('LEAD@x.com').changed, false, 'already the leader (case-insensitive)');
  const r = store.observeLeader('w2@x.com');
  assert.equal(r.changed, true);
  assert.equal(store.load().find((a) => a.desktop).name, 'w2');
  const out = store.observeLeader('stranger@x.com');
  assert.equal(out.changed, true);
  assert.equal(out.outside, 'stranger@x.com');
  assert.equal(store.load().some((a) => a.desktop), false, 'nobody in the pool is the leader now');
  assert.equal(store.getLeaderSeen().registered, false);
});

test('worker runs: thread resumes the same session, ledger reaches other threads, leader is never used', async () => {
  const { project, invocations } = sandbox({ w1: ['ok', 'ok', 'ok'], w2: ['ok'], lead: ['ok'] });
  const { runWorker } = require(`${ROOT_SRC}/core/workers`);
  const memory = require(`${ROOT_SRC}/core/memory`);

  const a = await runWorker({ task: 'Refactor the parser', context: 'User wants two passes', cwd: project, thread: 'parser' });
  assert.equal(a.ok, true);
  assert.match(a.text, /thread "parser"/);
  assert.match(a.text, /Files touched: src\/parser\.ts/);
  const first = invocations()[0];
  assert.equal(first.account, 'w1', 'a worker, never the leader');
  assert.equal(first.resume, null);
  assert.match(first.prompt, /## Task\nRefactor the parser/);
  assert.match(first.prompt, /User wants two passes/);

  const b = await runWorker({ task: 'Now add tests', cwd: project, thread: 'parser' });
  assert.equal(b.ok, true);
  const second = invocations()[1];
  assert.equal(second.resume, a.sessionId, 'same thread = same worker session');
  assert.match(second.prompt, /^Follow-up from the dispatcher/);

  await runWorker({ task: 'Write the docs', cwd: project, thread: 'docs' });
  const third = invocations()[2];
  assert.equal(third.resume, null, 'a new thread is a fresh worker session');
  assert.match(third.prompt, /thread "parser"/, 'but it is told what the parser thread already did');
  assert.ok(invocations().every((i) => i.account !== 'lead'));
  assert.equal(memory.readLedger(project).length, 3);
  assert.deepEqual(Object.keys(memory.listThreads(project)).sort(), ['docs', 'parser']);
});

test('worker runs: no workers, all workers limited, and a busy folder all answer clearly', async () => {
  const s = sandbox({ w1: ['limit:3600'], w2: ['limit:3600'] });
  const { runWorker } = require(`${ROOT_SRC}/core/workers`);
  const memory = require(`${ROOT_SRC}/core/memory`);

  const limited = await runWorker({ task: 'big job', cwd: s.project });
  assert.equal(limited.ok, false);
  assert.equal(limited.code, 'workers_limited');
  assert.match(limited.text, /^NO_WORKER_AVAILABLE/);
  assert.deepEqual(s.invocations().map((i) => i.account), ['w1', 'w2'], 'it tried each worker once, then reported instead of waiting for hours');

  s.store.save(s.store.load().filter((a) => a.desktop));
  assert.equal((await runWorker({ task: 'x', cwd: s.project })).code, 'no_workers');

  s.store.save([{ ...s.store.newAccount('w9', path.join(s.root, 'home', 'accounts', 'w9'), 'w9@x.com') }]);
  const lock = memory.acquireLock(s.project, { thread: 'someone-else' });
  fs.writeFileSync(path.join(memory.projectDir(s.project), 'lock.json'), JSON.stringify({ pid: process.ppid, at: Date.now(), thread: 'someone-else' }));
  process.env.BATON_QUEUE_WAIT_SEC = '1'; // a busy folder is now waited for; answer BUSY only after the wait
  const busy = await runWorker({ task: 'x', cwd: s.project });
  delete process.env.BATON_QUEUE_WAIT_SEC;
  assert.equal(busy.code, 'busy');
  assert.match(busy.text, /^BUSY/);
  lock.release && lock.release();
});

function mcpSession(extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(ROOT_SRC, 'mcp.js')], { env: { ...process.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    }
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); });
  return { call, child, close: () => child.kill() };
}

test('MCP server speaks the protocol and exposes the three tools', async () => {
  const s = sandbox({ w1: ['ok'] });
  const m = mcpSession();
  try {
    const init = await m.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'baton');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    const list = await m.call('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ['baton_run', 'baton_status', 'baton_ledger']);
    assert.deepEqual(list.result.tools[0].inputSchema.required, ['task', 'cwd']);

    const status = await m.call('tools/call', { name: 'baton_status', arguments: { cwd: s.project } });
    assert.match(status.result.content[0].text, /lead@x\.com \[LEADER/);
    assert.match(status.result.content[0].text, /w1@x\.com \[worker\]/);

    const run = await m.call('tools/call', { name: 'baton_run', arguments: { task: 'do it', cwd: s.project, thread: 'demo' } });
    assert.equal(run.result.isError, false);
    assert.match(run.result.content[0].text, /worker w1@x\.com · model fake-model · thread "demo" finished/);

    const ledger = await m.call('tools/call', { name: 'baton_ledger', arguments: { cwd: s.project } });
    assert.match(ledger.result.content[0].text, /thread "demo"/);

    const bad = await m.call('tools/call', { name: 'baton_run', arguments: { task: 'x', cwd: 'relative/path' } });
    assert.match(bad.result.content[0].text, /existing absolute folder/);
    assert.equal((await m.call('nope', {})).error.code, -32601);
  } finally {
    m.close();
  }
});

test('connect: installs hooks, skill and tool; disconnect restores everything; remove deletes Baton data', async () => {
  const s = sandbox({});
  const connect = require(`${ROOT_SRC}/core/connect`);
  const settings = path.join(s.root, 'hub', 'settings.json');
  const before = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } };
  fs.writeFileSync(settings, JSON.stringify(before));

  const st = await connect.install();
  assert.deepEqual([st.hook, st.skill, st.mcp, st.all], [true, true, true, true]);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(after.model, 'opus');
  assert.ok(after.hooks.StopFailure[0].matcher === 'rate_limit');
  assert.ok(after.hooks.SessionStart.length === 1, 'SessionStart reports who is signed in');
  const mcp = JSON.parse(fs.readFileSync(path.join(s.root, 'hub', '.claude.json'), 'utf8')).mcpServers.baton;
  assert.match(mcp.args[0], /mcp\.js$/);
  assert.match(fs.readFileSync(path.join(s.root, 'hub', 'skills', 'baton', 'SKILL.md'), 'utf8'), /baton_run/);
  await connect.install(); // idempotent
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.SessionStart.length, 1);

  const gone = await connect.uninstall();
  assert.equal(gone.all, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), before, 'settings are exactly as the user left them');
  assert.equal(fs.existsSync(path.join(s.root, 'hub', 'skills', 'baton')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, 'hub', '.claude.json'), 'utf8')).mcpServers.baton, undefined);

  await connect.install();
  fs.mkdirSync(path.join(process.env.BATON_HOME, 'accounts', 'w1'), { recursive: true });
  await connect.removeAll({ logins: true });
  assert.equal(fs.existsSync(process.env.BATON_HOME), false, 'every Baton folder is gone');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), before);
  assert.equal(fs.existsSync(`${settings}.baton-backup`), false);
});

test('remove: by default the wiring goes but saved sign-ins stay; only an explicit request deletes them', async () => {
  const s = sandbox({});
  const connect = require(`${ROOT_SRC}/core/connect`);
  const settings = path.join(s.root, 'hub', 'settings.json');
  const before = { model: 'opus' };
  fs.writeFileSync(settings, JSON.stringify(before));
  await connect.install();
  const login = path.join(process.env.BATON_HOME, 'accounts', 'w1', '.credentials.json');
  fs.mkdirSync(path.dirname(login), { recursive: true });
  fs.writeFileSync(login, '{"stand-in":"for a saved sign-in"}');

  const r = await connect.removeAll();
  assert.equal(r.logins, false);
  assert.equal(connect.status().all, false, 'hooks, tool and skill are gone');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), before, 'the user\'s settings are back as they were');
  assert.ok(fs.existsSync(login), 'the saved sign-in survived');
  assert.equal(s.store.load().length, 3, 'the account list survived');
  assert.equal(fs.existsSync(path.join(process.env.BATON_HOME, 'connect.json')), false, 'only the wiring leftovers are cleared');

  await connect.install(); // setting Baton up again needs no new sign-in
  assert.ok(fs.existsSync(login));
  await connect.removeAll({ logins: true });
  assert.equal(fs.existsSync(process.env.BATON_HOME), false);
});

test('worker model: a request\'s model wins, else the account\'s own default, else none; odd names are refused', async () => {
  const s = sandbox({ w1: ['ok', 'ok', 'ok'] }, [['lead', 'lead@x.com', { desktop: true, model: 'opus' }], ['w1', 'w1@x.com', { model: 'haiku' }]]);
  const { runWorker } = require(`${ROOT_SRC}/core/workers`);
  const a = await runWorker({ task: 'a', cwd: s.project });
  assert.match(a.text, /model fake-model/, 'the report says which model actually ran');
  await runWorker({ task: 'b', cwd: s.project, model: 'claude-opus-5-5' });
  s.store.update('w1', { model: '' });
  await runWorker({ task: 'c', cwd: s.project });
  assert.deepEqual(s.invocations().map((i) => i.model), ['haiku', 'claude-opus-5-5', null], 'leader\'s model setting is never used for workers');
  const bad = await runWorker({ task: 'd', cwd: s.project, model: 'haiku; rm -rf /' });
  assert.equal(bad.code, 'bad_request');
  assert.equal(s.invocations().length, 3, 'nothing was started for the refused name');
  assert.equal(s.store.cleanModel('  claude-haiku-5-5 '), 'claude-haiku-5-5');
  assert.equal(s.store.cleanModel(''), '');
  assert.equal(s.store.cleanModel('a b'), null);
});

test('worker run in a git project reports files changed by a shell command, not only by Edit/Write', async () => {
  const { execFileSync } = require('child_process');
  const s = sandbox({ w1: ['ok'] });
  execFileSync('git', ['-C', s.project, 'init', '-q']);
  fs.writeFileSync(path.join(s.project, 'already-there.txt'), 'x');
  process.env.FAKE_WRITE = 'made-by-shell.txt';
  try {
    const { runWorker } = require(`${ROOT_SRC}/core/workers`);
    const r = await runWorker({ task: 'make a file', cwd: s.project });
    assert.equal(r.ok, true);
    assert.match(r.text, /Files touched:.*made-by-shell\.txt/);
    assert.doesNotMatch(r.text, /already-there/, 'files that were already untracked before the run are not blamed on the worker');
  } finally {
    delete process.env.FAKE_WRITE;
  }
});

test('workers start in a clean environment: no host variables leak in from the Claude session that called Baton', async () => {
  const s = sandbox({ w1: ['ok'] });
  const dump = path.join(s.root, 'env.txt');
  const leaked = { ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CODE_SIMPLE: '1', CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1', CLAUDE_CODE_USER_EMAIL: 'lead@x.com',
    CLAUDE_CODE_MESSAGING_TOKEN: 'secret', CLAUDECODE: '1', CLAUDE_AGENT_SDK_VERSION: '0', ANTHROPIC_BASE_URL: 'http://evil', CLAUDE_CODE_GIT_BASH_PATH: 'C:\Git\bash.exe' };
  Object.assign(process.env, leaked, { FAKE_ENV_DUMP: dump });
  try {
    const { runWorker } = require(`${ROOT_SRC}/core/workers`);
    assert.equal((await runWorker({ task: 'x', cwd: s.project })).ok, true);
    const names = new Set(fs.readFileSync(dump, 'utf8').split('\n').filter(Boolean));
    for (const k of Object.keys(leaked)) {
      if (k === 'CLAUDE_CODE_GIT_BASH_PATH') assert.ok(names.has(k), 'Git Bash location is kept: Claude Code needs it on Windows');
      else assert.ok(!names.has(k), `${k} must not reach the worker`);
    }
    assert.ok(names.has('CLAUDE_CONFIG_DIR'), 'the worker is pointed at its own login folder');
    assert.ok(names.has('BATON_TAKEOVER'), 'and marked so Baton\'s own hooks ignore it');
  } finally {
    for (const k of [...Object.keys(leaked), 'FAKE_ENV_DUMP']) delete process.env[k];
  }
});

test('baton_run lists title and model in its schema', async () => {
  sandbox({});
  const m = mcpSession();
  try {
    await m.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    const props = (await m.call('tools/list', {})).result.tools[0].inputSchema.properties;
    assert.equal(props.title.type, 'string');
    assert.equal(props.model.type, 'string');
    assert.match(props.title.description, /60 characters/);
  } finally {
    m.close();
  }
});

test('job title: the dispatcher\'s title wins, else one is derived from the task; it reaches the run file and the ledger', async () => {
  const s = sandbox({ w1: ['ok', 'ok'] });
  const memory = require(`${ROOT_SRC}/core/memory`);
  const { runWorker, deriveTitle } = require(`${ROOT_SRC}/core/workers`);
  assert.equal(deriveTitle('## Build a **promo** site for `Baton`. Then deploy it.\nMore detail'), 'Build a promo site for Baton.');
  assert.equal(deriveTitle('\n\n  Fix   the   parser  '), 'Fix the parser');
  const long = deriveTitle('x'.repeat(200));
  assert.equal(long.length, 64);
  assert.ok(long.endsWith('…'));

  const seen = [];
  const realWrite = memory.writeRun;
  memory.writeRun = (id, data) => { seen.push(data.title); return realWrite(id, data); };
  try {
    await runWorker({ task: 'Refactor the parser. Keep it small.', cwd: s.project, title: 'Parser refactor' });
    await runWorker({ task: 'Refactor the parser. Keep it small.', cwd: s.project });
  } finally {
    memory.writeRun = realWrite;
  }
  assert.ok(seen.includes('Parser refactor'), 'the given title is written to the run file');
  assert.ok(seen.includes('Refactor the parser.'), 'otherwise the first sentence of the task is used');
  const ledger = memory.readLedger(s.project);
  assert.equal(ledger[0].title, 'Parser refactor', 'an explicit title is the ledger title');
  assert.equal(ledger[1].title, 'Refactor the parser. Keep it small.', 'without one the ledger keeps the clipped task');
});
