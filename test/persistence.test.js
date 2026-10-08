'use strict';
// Saved sign-ins must survive restarts, a damaged file and one flaky reply, and the window's account must be
// recognised without the user doing anything. Everything runs in throw-away folders with a fake `claude`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAKE = path.join(__dirname, 'fake-claude.js');
const SRC = path.join(__dirname, '..', 'src');
const U1 = '11111111-aaaa-4bbb-8ccc-111111111111';
const U2 = '22222222-aaaa-4bbb-8ccc-222222222222';

function sandbox(accounts = [['w1', 'w1@x.com', {}]]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-test-'));
  Object.assign(process.env, {
    BATON_HOME: path.join(root, 'home'),
    BATON_HUB: path.join(root, 'hub'),
    BATON_DESKTOP_DIR: path.join(root, 'desktop-sessions'),
    BATON_DESKTOP_TTL: '0',
    FAKE_STATE: path.join(root, 'state'),
    FAKE_PLAN: '{}',
    BATON_CLAUDE_CMD: JSON.stringify([process.execPath, FAKE]),
  });
  delete process.env.BATON_TAKEOVER;
  fs.mkdirSync(process.env.FAKE_STATE, { recursive: true });
  fs.mkdirSync(process.env.BATON_HUB, { recursive: true });
  fs.mkdirSync(process.env.BATON_DESKTOP_DIR, { recursive: true });
  const store = require(`${SRC}/core/store`);
  store.save(accounts.map(([n, email, extra]) => ({ ...store.newAccount(n, path.join(root, 'home', 'accounts', n), email), ...extra })));
  return { store, root };
}

// A desktop-app session file for an account, last touched `ageSec` seconds ago.
function desktopSession(uuid, ageSec) {
  const dir = path.join(process.env.BATON_DESKTOP_DIR, uuid, '59f212a8-5045-4baa-ba70-df04b04233a5');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `local_${ageSec}.json`);
  fs.writeFileSync(f, '{}');
  const t = new Date(Date.now() - ageSec * 1000);
  fs.utimesSync(f, t, t);
}

test('the desktop app\'s active account is read from folder names and timestamps only', () => {
  sandbox();
  const desktop = require(`${SRC}/core/desktop`);
  assert.equal(desktop.activeAccount({ fresh: true }), null, 'no desktop app activity yet');
  desktopSession(U1, 3600);
  desktopSession(U2, 60);
  fs.mkdirSync(path.join(process.env.BATON_DESKTOP_DIR, 'not-a-uuid', 'x'), { recursive: true });
  fs.writeFileSync(path.join(process.env.BATON_DESKTOP_DIR, 'not-a-uuid', 'x', 'newer.json'), '{}');
  assert.equal(desktop.activeAccount({ fresh: true }).uuid, U2, 'the account with the most recent session wins; stray folders are ignored');
});

test('a session reports e-mail + account id once; afterwards the window\'s account is known without a session', () => {
  const { store } = sandbox();
  assert.equal(store.emailForUuid(U1), null);
  const first = store.observeLeader('Lead@X.com', U1);
  assert.equal(first.seenChanged, true);
  assert.equal(first.firstTime, true);
  assert.equal(first.outside, 'lead@x.com', 'not in the pool: recognised as the leader anyway');
  assert.equal(store.emailForUuid(U1), 'lead@x.com');
  assert.equal(store.getLeaderSeen().uuid, U1);
  assert.equal(store.observeLeader('lead@x.com', U1).seenChanged, false, 'the same report again changes nothing');
  assert.equal(store.observeLeader('lead@x.com', 'not-a-uuid').seenChanged, true);
  assert.equal(store.emailForUuid('not-a-uuid'), null, 'garbage ids are never stored');
});

test('a damaged accounts file falls back to the last good copy instead of losing the accounts', () => {
  const { store, root } = sandbox([['w1', 'w1@x.com', {}], ['w2', 'w2@x.com', {}]]);
  store.update('w1', { plan: 'max' }); // a second write: the first good copy becomes accounts.json.bak
  const file = path.join(root, 'home', 'accounts.json');
  assert.ok(fs.existsSync(`${file}.bak`));
  fs.writeFileSync(file, '{"half written'); // e.g. power cut mid-write
  assert.deepEqual(store.load().map((a) => a.name), ['w1', 'w2'], 'accounts are still there');
  assert.ok(fs.existsSync(`${file}.corrupt`), 'the broken file is kept for inspection, not silently deleted');
  store.update('w2', { plan: 'pro' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 2, 'and the file is healthy again');
});

test('on start-up: a sign-in folder the list lost is listed again, and a wrongly flagged account is cleared', async () => {
  const { store, root } = sandbox([['w1', 'w1@x.com', { needsLogin: true }]]);
  fs.mkdirSync(path.join(root, 'home', 'accounts', 'w1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'home', 'accounts', 'lost'), { recursive: true }); // on disk, not in accounts.json
  fs.mkdirSync(path.join(root, 'home', 'accounts', 'lost', 'projects'), { recursive: true });
  const { reconcile } = require(`${SRC}/core/reconcile`);
  const r = await reconcile();
  assert.deepEqual(r.adopted, ['lost']);
  assert.deepEqual(r.revived, ['w1'], 'the fake claude accepts its login, so the flag goes away');
  assert.equal(store.get('w1').needsLogin, false);
  assert.ok(store.get('lost'), 'adopted account is back on the list');
  assert.deepEqual((await reconcile()).adopted, [], 'nothing is adopted twice');
});

test('usage readings: one per account at a time, accounts read side by side, only stale ones re-read', async () => {
  sandbox([['a', 'a@x.com', {}], ['b', 'b@x.com', {}], ['c', 'c@x.com', { needsLogin: true }]]);
  const usage = require(`${SRC}/core/usage`);
  const first = usage.refresh('a');
  assert.equal(usage.refresh('a'), first, 'asking again while a reading is running joins it instead of starting another');
  assert.equal(usage.isBusy('a'), true);
  assert.deepEqual(usage.stale(0).sort(), ['a', 'b'], 'signed-out accounts are never read');
  await Promise.all([first, usage.refresh('b')]);
  assert.equal(usage.isBusy('a'), false);
  assert.deepEqual(usage.stale(60000), [], 'both were just read');
  assert.deepEqual(usage.stale(0, ['b']), ['b'], 'a manual refresh can name one account');
  const cache = usage.readCache();
  assert.equal(cache.a.data.session.pct, 12);
  assert.ok(cache.b.at >= cache.a.at - 5000, 'both readings landed in the same round');
});

test('panel API: "use my current login" says plainly why it cannot see a desktop-app-only sign-in', async () => {
  sandbox([]);
  process.env.FAKE_LOGGED_OUT = '1';
  const { createServer } = require(`${SRC}/server`);
  const srv = await createServer();
  try {
    const cookie = (await fetch(srv.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const post = (p) => fetch(`${srv.origin}${p}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    const res = await post('/api/accounts/import-current');
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.match(error, /desktop app keeps its own sign-in/);
    assert.match(error, /Add account/);
    const state = async () => (await fetch(`${srv.origin}/api/state`, { headers: { cookie } })).json();
    await state(); // starts the background probe of the command-line login; the panel's next refresh sees the answer
    await new Promise((r) => setTimeout(r, 700));
    const s = await state();
    assert.deepEqual([s.cli.checked, s.cli.loggedIn], [true, false], 'so the panel hides the button instead of offering a dead end');
  } finally {
    delete process.env.FAKE_LOGGED_OUT;
    srv.close();
  }
});

test('panel API: the window\'s account is recognised from the desktop app alone, and an account switch is noticed', async () => {
  const { store } = sandbox([['w1', 'w1@x.com', {}]]);
  const { createServer } = require(`${SRC}/server`);
  const srv = await createServer();
  try {
    const first = await fetch(srv.url, { redirect: 'manual' });
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const state = async () => (await fetch(`${srv.origin}/api/state`, { headers: { cookie } })).json();

    let s = await state();
    assert.equal(s.desktop.detected, false);
    assert.equal(s.leader, null);

    desktopSession(U1, 30); // the app is in use, but no session has told Baton the e-mail yet
    s = await state();
    assert.deepEqual([s.desktop.detected, s.desktop.pending, s.leader], [true, true, null]);

    store.rememberAccountUuid(U1, 'lead@x.com'); // a session reported it (or it was seen on an earlier day)
    s = await state();
    assert.equal(s.leader.email, 'lead@x.com');
    assert.equal(s.desktop.pending, false);

    desktopSession(U2, 5); // the user switched the window to an account Baton has never seen
    s = await state();
    assert.equal(s.leader, null, 'the old leader is not shown as current after a switch');
    assert.equal(s.desktop.pending, true);

    desktopSession(U1, 1); // ...and back
    assert.equal((await state()).leader.email, 'lead@x.com');

    assert.equal(s.cli.checked === true || s.cli.checked === false, true, 'the command-line login probe is reported');
  } finally {
    srv.close();
  }
});
