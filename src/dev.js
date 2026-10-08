'use strict';
// Run Baton's panel in a normal browser, no Electron needed.
//   node src/dev.js          your real accounts
//   node src/dev.js --demo   throwaway accounts + a fake claude, to look at every state
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.argv.includes('--demo')) {
  const root = path.join(os.tmpdir(), `baton-demo-${process.pid}`); // fresh folder every run
  try { fs.rmSync(path.join(os.tmpdir(), 'baton-demo'), { recursive: true, force: true }); } catch { /* an old run still holds it */ }
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'project'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hub'), { recursive: true });
  Object.assign(process.env, {
    BATON_HOME: path.join(root, 'home'),
    BATON_HUB: path.join(root, 'hub'),
    FAKE_STATE: path.join(root, 'state'),
    FAKE_DELAY_MS: '1800',
    FAKE_LOGIN_MS: '8000',
    BATON_NO_BROWSER: '1',
    FAKE_PLAN: JSON.stringify({ 'alex': ['ok', 'limit:9000', 'ok'], lab: ['ok'] }),
    BATON_CLAUDE_CMD: JSON.stringify([process.execPath, path.join(__dirname, '..', 'test', 'fake-claude.js')]),
  });
  const store = require('./core/store');
  const mk = (name, email, plan, extra = {}) => ({ ...store.newAccount(name, path.join(root, 'home', 'accounts', name), email), plan, ...extra });
  store.save([
    mk('you', 'you@example.com', 'max', { desktop: true }),
    mk('alex', 'alex@example.com', 'max', { model: 'sonnet' }),
    mk('lab', 'lab@example.com', 'max', { model: 'haiku', blockedUntil: Date.now() / 1000 + 2.2 * 3600, blockedReason: 'five_hour' }),
    mk('work', 'work@example.com', 'pro', { needsLogin: true }),
  ]);
  // numbers the panel would have read from `claude -p /usage`, a running worker and who the leader is
  const now = Date.now() / 1000;
  const row = (label, pct, hrs) => ({ label, pct, resetsAt: now + hrs * 3600, resetsText: '' });
  fs.writeFileSync(path.join(root, 'home', 'usage.json'), JSON.stringify({
    you: { at: Date.now(), data: { session: row('Current session', 62, 3.1), week: row('Current week (all models)', 41, 150), others: [] } },
    'alex': { at: Date.now(), data: { session: row('Current session', 18, 4.2), week: row('Current week (all models)', 23, 150), others: [] } },
    lab: { at: Date.now(), data: { session: row('Current session', 100, 2.2), week: row('Current week (all models)', 74, 90), others: [] } },
  }));
  fs.writeFileSync(path.join(root, 'home', 'leader.json'), JSON.stringify({ email: 'you@example.com', registered: true, at: Date.now() }));
  fs.mkdirSync(path.join(root, 'home', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'home', 'runs', 'demo.json'), JSON.stringify({
    id: 'demo', pid: process.pid, updatedAt: Date.now() + 3600e3, kind: 'worker', status: 'running', project: 'thesis-code', cwd: path.join(root, 'project'),
    thread: 'auth-refactor', title: 'Refactor the session auth flow', account: 'alex', model: 'claude-sonnet-5-5', lastLine: 'Edit src/auth/session.ts',
  }));
  // finished worker runs, for the panel's "Recent" list
  const memory = require('./core/memory');
  const ago = (min) => Date.now() - min * 60e3;
  memory.appendLedger(path.join(root, 'thesis-code'), { at: ago(12), thread: 'tests', account: 'alex@example.com', title: 'Write unit tests for the token parser', summary: 'demo', ok: true });
  memory.appendLedger(path.join(root, 'baton-site'), { at: ago(47), thread: 'promo-site', account: 'lab@example.com', title: 'Build the promotional website', summary: 'demo', ok: true });
  memory.appendLedger(path.join(root, 'thesis-code'), { at: ago(190), thread: 'ci', account: 'alex@example.com', title: 'Fix the flaky CI job on Windows', summary: 'demo', ok: false });
  console.log(`demo project folder: ${path.join(root, 'project')}`);
}

require('./server').createServer().then((s) => console.log(`Baton panel: ${s.url}\nwith the launch intro: ${s.url}#boot=1`));
