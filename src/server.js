'use strict';
// Local HTTP + SSE bridge between the panel UI, the Claude Code hook and the takeover manager.
// Loopback only. The UI is guarded by a random token cookie plus Host/Origin checks; the hook
// endpoint by a separate token from connect.json: this process can run Claude Code in the
// user's folders, so a random web page must not be able to drive it.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./core/store');
const setup = require('./core/setup');
const hook = require('./core/hook');
const connect = require('./core/connect');
const usage = require('./core/usage');
const memory = require('./core/memory');
const desktop = require('./core/desktop');
const { reconcile } = require('./core/reconcile');
const { startLogin, openLoginPage } = require('./core/login');
const { authStatus, claudeCmd } = require('./core/claude');
const { Takeovers } = require('./core/takeover');
const { PERMISSION_MODES } = require('./core/engine');

const UI_DIR = path.join(__dirname, '..', 'ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function slug(email) {
  const base = (email.split('@')[0] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const taken = new Set(store.load().map((a) => a.name));
  const stem = base || 'account';
  let name = stem;
  for (let i = 2; taken.has(name); i++) name = `${stem}-${i}`;
  return name;
}
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

// Every call from the Claude Code hook leaves a line here, so "did it fire?" is answerable later.
let removed = false;
function logEvent(entry) {
  if (removed) return;
  try {
    const file = path.join(store.home(), 'events.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 1e6) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}
`);
  } catch { /* logging must never break the hook */ }
}

function createServer({ shell = {}, takeovers = new Takeovers() } = {}) {
  const uiToken = crypto.randomBytes(24).toString('hex');
  const clients = new Set();
  let hookToken = '';
  let login = null; // what the UI shows about a sign-in in progress
  let loginHandle = null;
  let loginCancelled = false;
  let origin = '';

  const broadcast = (type, data = {}) => {
    const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`;
    for (const c of clients) c.write(msg);
  };

  const publicAccounts = () => {
    const cache = usage.readCache();
    const busy = new Set([...takeovers.snapshot().active, ...memory.listRuns()].filter((j) => j.status === 'running').map((j) => j.account));
    return store.load().map((a) => ({
      usage: cache[a.name]?.data || null,
      usageAt: cache[a.name]?.at || null,
      usageError: cache[a.name]?.error || null,
      usageBusy: usage.isBusy(a.name),
      name: a.name,
      label: a.email || a.name,
      plan: a.plan,
      desktop: !!a.desktop,
      model: a.model || '',
      status: a.needsLogin ? 'login' : a.blockedUntil > store.nowSec() ? 'limited' : 'ready',
      blockedUntil: a.blockedUntil,
      blockedReason: a.blockedReason,
      active: busy.has(a.name),
    }));
  };

  function claudeProblem() {
    try {
      claudeCmd();
      return null;
    } catch (e) {
      return e.message;
    }
  }

  // Whether the command-line Claude Code in ~/.claude is signed in. Only that login can be "adopted" with one click;
  // the desktop app keeps its own sign-in inside the app, which Baton neither can nor should read.
  let cli = { checkedAt: 0, loggedIn: false, email: '' };
  let cliProbing = false;
  function probeCli() {
    if (cliProbing || Date.now() - cli.checkedAt < 60000 || removed) return;
    cliProbing = true;
    authStatus(store.newAccount('main', setup.hubDir()))
      .then((info) => { cli = { checkedAt: Date.now(), loggedIn: !!info.loggedIn, email: info.email || '' }; })
      .catch(() => { cli = { ...cli, checkedAt: Date.now() }; })
      .finally(() => { cliProbing = false; });
  }

  // Who is the window's account? Best source is a session reporting its e-mail (leader.json). Without a session,
  // the desktop app's own folders tell which account it last used; that only names someone once a session has
  // reported the same account's e-mail before. A leader from before an account switch is not shown as current.
  function leaderView() {
    const seen = store.getLeaderSeen();
    const d = desktop.activeAccount();
    const known = !!d && !!store.emailForUuid(d.uuid);
    const stale = !!d && !known && !!seen && !!seen.uuid && seen.uuid !== d.uuid;
    return { leader: stale ? null : seen, desktop: { detected: !!d, pending: !!d && !known && (stale || !seen) } };
  }

  const fullState = () => {
    syncLeaderFromDesktop();
    probeCli();
    return {
      accounts: publicAccounts(),
      jobs: takeovers.snapshot(),
      connect: connect.status(),
      ...leaderView(),
      cli: { loggedIn: cli.loggedIn, email: cli.email, checked: cli.checkedAt > 0 },
      runs: memory.listRuns(),
      recent: memory.recentRuns(),
      settings: store.loadSettings(),
      login,
      claudeProblem: claudeProblem(),
      permissionModes: PERMISSION_MODES,
      canAutoStart: typeof shell.setAutoStart === 'function',
    };
  };

  const pushAccounts = () => broadcast('accounts', { accounts: publicAccounts(), ...leaderView() });

  // The desktop app puts the signed-in e-mail and account UUID in every session's environment; hooks and the MCP
  // tool forward them here, so Baton knows who the leader is, including right after you switch accounts.
  function observeIdentity(email, takeover, uuid = '') {
    if (!email || takeover || removed) return;
    const r = store.observeLeader(email, uuid);
    if (!r.changed && !r.seenChanged) return;
    pushAccounts();
    if (r.changed && !r.firstTime) {
      const n = { kind: 'leader', from: r.from ? r.from.name : null, to: r.leader ? r.leader.name : null, outside: r.outside || null };
      broadcast('notify', { notice: n });
      if (shell.notify) shell.notify(n, publicAccounts());
    }
  }

  // No session needed: if the desktop app's active account has been seen before, the e-mail is already known.
  function syncLeaderFromDesktop() {
    if (removed) return;
    const d = desktop.activeAccount();
    const email = d && store.emailForUuid(d.uuid);
    if (!email) return;
    const seen = store.getLeaderSeen();
    if (seen && seen.email === email && seen.uuid === d.uuid) return;
    observeIdentity(email, '', d.uuid);
  }
  // Read the plan usage of accounts whose last reading is older than maxAgeMs. The panel hears about it twice:
  // when the readings start (so it can say "reading…") and again as each one lands.
  function refreshUsage({ maxAgeMs = 0, names = null } = {}) {
    if (removed) return Promise.resolve();
    const todo = usage.stale(maxAgeMs, names);
    if (!todo.length) return Promise.resolve();
    const runs = todo.map((n) => usage.refresh(n));
    broadcast('usage', { accounts: publicAccounts() });
    return Promise.all(runs.map((p) => p.catch(() => {}).finally(() => broadcast('usage', { accounts: publicAccounts() }))));
  }
  takeovers.on('update', (jobs) => broadcast('jobs', { jobs, accounts: publicAccounts() }));
  takeovers.on('notify', (n) => {
    broadcast('notify', { notice: { ...n, accounts: undefined } });
    shell.notify?.(n, publicAccounts());
  });

  function setLogin(patch) {
    login = patch === null ? null : { ...login, ...patch };
    broadcast('login', { login });
  }

  function beginLogin(acct) {
    if (loginHandle) throw new Error('Another sign-in is already in progress.');
    loginCancelled = false;
    setLogin({ account: acct.name, label: acct.email || acct.name, status: 'starting', url: null, manual: false, message: '' });
    loginHandle = startLogin(acct, {
      onUrl: (url, { manual }) => {
        const how = openLoginPage(url, acct);
        setLogin({ status: manual ? 'need-code' : 'waiting', url, manual, opened: how.method });
      },
    });
    loginHandle.done.then(({ ok, output }) => {
      loginHandle = null;
      if (loginCancelled) {
        setLogin(null);
      } else if (ok) {
        setLogin({ status: 'done' });
        setTimeout(() => !loginHandle && setLogin(null), 2500);
        refreshUsage({ names: [acct.name] }); // a new account shows its usage right away, not at the next round
      } else {
        setLogin({ status: 'failed', message: output.trim().split('\n').slice(-3).join(' ').slice(0, 300) || 'Sign-in did not finish.' });
      }
      pushAccounts();
    });
  }

  const routes = {
    'GET /api/state': () => fullState(),

    'POST /api/settings': (body) => {
      const before = store.loadSettings().language;
      const next = store.saveSettings(pick(body, ['permissionMode', 'extraArgs', 'startAtLogin', 'language']));
      if ('startAtLogin' in body) shell.setAutoStart?.(!!next.startAtLogin);
      if (next.language !== before) shell.onLanguage?.(next.language);
      return next;
    },

    'POST /api/accounts': async (body) => {
      const email = String(body.email || '').trim();
      if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('That does not look like an email address.');
      if (email && store.load().some((a) => a.email.toLowerCase() === email.toLowerCase())) throw new Error('That account is already added.');
      const name = slug(email);
      const dir = setup.accountDir(name);
      setup.prepareConfigDir(dir);
      const acct = { ...store.newAccount(name, dir, email), needsLogin: true };
      store.upsert(acct);
      pushAccounts();
      beginLogin(acct);
      return { ok: true, name };
    },

    // One-click start for people who already use Claude Code: adopt the existing login.
    'POST /api/accounts/import-current': async () => {
      const hub = setup.hubDir();
      if (store.load().some((a) => a.configDir === hub)) throw new Error('Your current Claude Code login is already added.');
      const probe = store.newAccount('main', hub);
      const info = await authStatus(probe);
      if (!info.loggedIn) {
        throw new Error('No command-line Claude Code sign-in found. The Claude desktop app keeps its own sign-in inside the app, which Baton cannot see: it recognises that window by itself once you connect and start a session. Use “Add account” for your other accounts.');
      }
      store.upsert({ ...probe, name: slug(info.email || 'main'), email: info.email || '', plan: info.subscriptionType || '' });
      pushAccounts();
      return { ok: true };
    },

    'POST /api/accounts/login': (body) => {
      const acct = store.get(body.name);
      if (!acct) throw new Error('Unknown account.');
      beginLogin(acct);
      return { ok: true };
    },

    // The model this account's worker runs use by default ('' = Claude Code's own default).
    'POST /api/accounts/model': (body) => {
      if (!store.get(body.name)) throw new Error('Unknown account.');
      const model = store.cleanModel(body.model);
      if (model === null) throw new Error('That does not look like a model name. Use an alias such as “haiku” or an id such as “claude-haiku-5-5”.');
      store.update(body.name, { model });
      pushAccounts();
      return { ok: true, model };
    },

    'POST /api/accounts/desktop': (body) => {
      if (!store.get(body.name)) throw new Error('Unknown account.');
      store.setDesktop(body.name);
      pushAccounts();
      return { ok: true };
    },

    'POST /api/accounts/remove': (body) => {
      const acct = store.get(body.name);
      if (!acct) return { ok: true };
      if (takeovers.snapshot().active.some((j) => j.account === acct.name)) throw new Error('A takeover is using this account. Stop it first.');
      store.remove(acct.name);
      if (path.resolve(acct.configDir).startsWith(path.resolve(store.home(), 'accounts') + path.sep)) setup.removeConfigDir(acct.configDir);
      fs.rmSync(path.join(store.home(), 'browser', acct.name), { recursive: true, force: true });
      pushAccounts();
      return { ok: true };
    },

    'POST /api/login/cancel': () => {
      loginCancelled = true;
      loginHandle?.cancel();
      if (!loginHandle) setLogin(null);
      return { ok: true };
    },
    'POST /api/login/code': (body) => {
      if (!loginHandle) throw new Error('No sign-in in progress.');
      loginHandle.sendCode(body.code || '');
      return { ok: true };
    },
    'POST /api/login/reopen': () => {
      const acct = login && store.get(login.account);
      if (acct && login.url) openLoginPage(login.url, acct);
      return { ok: true };
    },

    'POST /api/connect': async () => { const c = await connect.install(); broadcast('connect', { connect: c }); return c; },
    'POST /api/disconnect': async () => { const c = await connect.uninstall(); broadcast('connect', { connect: c }); return c; },
    // Saved sign-ins are only deleted when the request says so (`logins: true`); the default keeps them.
    'POST /api/remove-all': async (body) => {
      if (takeovers.snapshot().active.length) throw new Error('Stop the running takeover first.');
      removed = true;
      const done = await connect.removeAll({ logins: body.logins === true });
      setTimeout(() => shell.quit && shell.quit(), 800);
      return { ok: true, logins: done.logins };
    },
    // Returns at once: a reading takes 13-20 s, the panel follows it through the 'usage' events instead of waiting.
    'POST /api/usage/refresh': (body) => {
      refreshUsage({ names: body.name ? [body.name] : null });
      return { ok: true };
    },

    'POST /api/takeover/stop': (body) => (takeovers.stop(body.id), { ok: true }),
  };

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 2e6) throw new Error('Request too large.');
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const port = () => new URL(origin).port;
  const hostOk = (req) => [`127.0.0.1:${port()}`, `localhost:${port()}`].includes(req.headers.host || ''); // DNS-rebinding guard

  function uiAuthorised(req, url) {
    const o = req.headers.origin;
    if (o && o !== origin && o !== `http://localhost:${port()}`) return false;
    const cookie = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('baton='));
    return cookie === `baton=${uiToken}` || url.searchParams.get('t') === uiToken;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin || 'http://127.0.0.1');
    const json = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (!hostOk(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('Forbidden');
    }

    // Claude Code hook -> takeover
    if (req.method === 'POST' && url.pathname === '/hook') {
      if (req.headers['x-baton-token'] !== hookToken) return json(403, { error: 'bad token' });
      try {
        const payload = JSON.parse((await readBody(req)).replace(/^﻿/, '')); // tolerate a UTF-8 BOM from the shell
        const meta = {
          configDir: decodeURIComponent(req.headers['x-baton-config-dir'] || ''),
          takeover: req.headers['x-baton-takeover'] || '',
          email: decodeURIComponent(req.headers['x-baton-email'] || ''),
          accountUuid: req.headers['x-baton-account-uuid'] || '',
          entrypoint: req.headers['x-baton-entrypoint'] || '',
        };
        observeIdentity(meta.email, meta.takeover, meta.accountUuid);
        if (payload.hook_event_name === 'SessionStart') {
          if (!meta.takeover) logEvent({ event: 'SessionStart', email: meta.email || null, entrypoint: meta.entrypoint || null, result: 'identity noted' }); // Baton's own runs would only fill the log
          return json(200, { identity: true });
        }
        const out = takeovers.handleHook(payload, meta);
        logEvent({ error: payload.error, session: payload.session_id, cwd: payload.cwd, configDir: meta.configDir || null, email: meta.email || null, result: out.ignored ? `ignored: ${out.ignored}` : 'takeover started' });
        return json(200, out.ignored ? { ignored: out.ignored } : { started: true });
      } catch (e) {
        logEvent({ result: `bad request: ${e.message}` });
        return json(400, { error: e.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/ident') {
      if (req.headers['x-baton-token'] !== hookToken) return json(403, { error: 'bad token' });
      try {
        const body = JSON.parse((await readBody(req)).replace(/^\uFEFF/, ''));
        observeIdentity(String(body.email || ''), '', String(body.uuid || ''));
        return json(200, { ok: true });
      } catch (e) {
        return json(400, { error: e.message });
      }
    }

    if (!uiAuthorised(req, url)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('Open Baton from its window.');
    }
    if (url.searchParams.get('t') === uiToken) {
      res.writeHead(302, { 'set-cookie': `baton=${uiToken}; Path=/; HttpOnly; SameSite=Strict`, location: url.pathname });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      refreshUsage({ maxAgeMs: 20000 }); // the panel was just opened: show fresh numbers
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(keepAlive); clients.delete(res); });
      return;
    }

    const route = routes[`${req.method} ${url.pathname}`];
    if (route) {
      try {
        const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
        return json(200, await route(body));
      } catch (e) {
        return json(400, { error: e.message });
      }
    }

    // static UI files
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(UI_DIR, rel);
    if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      hookToken = hook.writeConnect(server.address().port);

      // After a restart or reboot: list again any sign-in found on disk, and re-test accounts flagged "sign in
      // needed" (a flag set by one bad reply must not outlive a login that still works), then read usage.
      const settle = async () => {
        if (removed) return;
        try {
          const r = await reconcile();
          if (r.adopted.length || r.revived.length) pushAccounts();
        } catch { /* the next round tries again */ }
      };
      setTimeout(() => settle().then(() => refreshUsage()), 1500).unref();
      // Live while someone is looking (panel visible): re-read anything older than 25 s every 30 s.
      // Otherwise stay quiet: every account is only re-read when its last reading is 4 minutes old.
      const watching = () => (shell.isPanelVisible ? !!shell.isPanelVisible() : clients.size > 0);
      setInterval(() => refreshUsage({ maxAgeMs: watching() ? 25 * 1000 : 4 * 60 * 1000 }), 30 * 1000).unref();
      setInterval(settle, 30 * 60 * 1000).unref();
      setInterval(syncLeaderFromDesktop, 10 * 1000).unref();
      setTimeout(syncLeaderFromDesktop, 500).unref();
      setTimeout(probeCli, 800).unref();

      let runsSig = '';
      setInterval(() => {
        if (removed) return;
        const runs = memory.listRuns();
        const sig = JSON.stringify(runs.map((r) => [r.id, r.status, r.account, r.lastLine]));
        if (sig !== runsSig) { runsSig = sig; broadcast('runs', { runs, recent: memory.recentRuns(), accounts: publicAccounts() }); }
      }, 2000).unref();

      resolve({ url: `${origin}/?t=${uiToken}`, origin, takeovers, refreshUsage, close: () => server.close() });
    });
  });
}

module.exports = { createServer };
