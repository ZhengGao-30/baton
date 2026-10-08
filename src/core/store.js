'use strict';
// Account registry + app settings, persisted as small JSON files under BATON_HOME.
// Claude's own credentials are never read here: each account just points at a config dir
// that Claude Code manages itself.

const fs = require('fs');
const os = require('os');
const path = require('path');
const fslock = require('./fslock');

const home = () => process.env.BATON_HOME || path.join(os.homedir(), '.baton');
const accountsFile = () => path.join(home(), 'accounts.json');
const settingsFile = () => path.join(home(), 'settings.json');
const nowSec = () => Date.now() / 1000;

// Reading never throws on a damaged file: the broken copy is set aside as `.corrupt` and the last good copy
// (`.bak`, kept by writeJson) is used instead, so a bad write can never make saved accounts disappear.
// A file another process holds open for a moment (Windows: EBUSY/EPERM) is retried briefly first.
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES']);
function readJson(file, fallback) {
  try {
    return JSON.parse(fslock.retrying(() => fs.readFileSync(file, 'utf8'), { tries: 10, codes: BUSY }));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    if (e.code && e.code !== 'EISDIR') throw e; // a real I/O problem (EACCES, EBUSY...): do not pretend the file is empty
    try { fs.renameSync(file, `${file}.corrupt`); } catch { /* keep going with the backup */ }
    try {
      const good = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
      fs.copyFileSync(`${file}.bak`, file); // restore it, or the next read would find no file and see "empty"
      return good;
    } catch { return fallback; }
  }
}

// Unique temp file + rename with retries (see fslock.js), keeping the previous good copy as `.bak`.
const writeJson = (file, data) => fslock.writeJson(file, data, { backup: true });

// Every change is a read-modify-write under a cross-process lock, re-reading the file inside it: several Claude
// windows' Baton processes and the Baton app all change the same files, and none may lose another's update.
// `change` returns the new content, or undefined to leave the file as it is.
function mutate(file, fallback, change) {
  return fslock.withFileLock(file, () => {
    const next = change(readJson(file, fallback));
    if (next !== undefined) writeJson(file, next);
    return next;
  });
}

const load = () => readJson(accountsFile(), []);
const save = (accounts) => { mutate(accountsFile(), [], () => accounts); };
const get = (name) => load().find((a) => a.name === name) || null;
const changeAccounts = (fn) => mutate(accountsFile(), [], fn);

function upsert(acct) {
  changeAccounts((accounts) => {
    const i = accounts.findIndex((a) => a.name === acct.name);
    if (i >= 0) accounts[i] = acct;
    else accounts.push(acct);
    return accounts;
  });
}

const remove = (name) => { changeAccounts((accounts) => accounts.filter((a) => a.name !== name)); };

function update(name, fields) {
  changeAccounts((accounts) => accounts.map((a) => (a.name === name ? { ...a, ...fields } : a)));
}

const newAccount = (name, configDir, email = '') => ({
  name, configDir, email, plan: '', blockedUntil: 0, blockedReason: '', needsLogin: false, lastUsed: 0, desktop: false,
  model: '', // default model for this account's worker runs; '' = whatever Claude Code defaults to
});

// A model alias ("haiku") or id ("claude-haiku-5-5") goes to Claude Code's own --model flag; nothing else may pass.
// Returns the cleaned name ('' = no preference) or null when it is not a plausible model name.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;
const cleanModel = (m) => {
  const v = String(m == null ? '' : m).trim();
  return v === '' || MODEL_RE.test(v) ? v : null;
};

const isReady = (a, now = nowSec()) => !a.needsLogin && a.blockedUntil <= now;
const markLimited = (name, until, reason) => update(name, { blockedUntil: until, blockedReason: reason });
const markNeedsLogin = (name) => update(name, { needsLogin: true });
const markUsed = (name) => update(name, { lastUsed: nowSec() });
// Which account is the leader (the one this Claude window is signed in to) as last reported by a
// Claude Code session; the registry flag follows it, and an e-mail outside the pool is remembered too.
const leaderFile = () => path.join(home(), 'leader.json');
const getLeaderSeen = () => readJson(leaderFile(), null);

// The desktop app identifies an account by UUID in the places Baton can see without a session, and by e-mail
// inside a session. Whenever a session reports both, remember the pairing (neither is a secret).
const uuidFile = () => path.join(home(), 'account-uuids.json');
const cleanUuid = (u) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(u || '').trim()) ? String(u).trim().toLowerCase() : '');
function rememberAccountUuid(uuid, email) {
  const u = cleanUuid(uuid);
  const e = String(email || '').trim().toLowerCase();
  if (!u || !e) return;
  mutate(uuidFile(), {}, (map) => (map[u] !== e ? { ...map, [u]: e } : undefined));
}
const emailForUuid = (uuid) => readJson(uuidFile(), {})[cleanUuid(uuid)] || null;

function observeLeader(email, uuid = '') {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { changed: false, seenChanged: false };
  const u = cleanUuid(uuid);
  rememberAccountUuid(u, e);
  let out;
  changeAccounts((accounts) => {
    const match = accounts.find((a) => a.email && a.email.toLowerCase() === e) || null;
    const before = accounts.find((a) => a.desktop) || null;
    let prev = null;
    let seenChanged = false;
    mutate(leaderFile(), null, (p) => {
      prev = p;
      seenChanged = !prev || prev.email !== e || (prev.uuid || '') !== u;
      return seenChanged ? { email: e, uuid: u || null, registered: !!match, at: Date.now() } : undefined;
    });
    const base = { seenChanged, firstTime: !prev, leader: match, outside: !match ? e : null };
    if ((match ? match.name : null) === (before ? before.name : null)) { out = { ...base, changed: false }; return undefined; }
    out = { ...base, changed: true, from: before };
    return accounts.map((a) => ({ ...a, desktop: !!match && a.name === match.name }));
  });
  return out;
}

// Exactly one account is the one the Claude desktop app is signed in to.
const setDesktop = (name) => { changeAccounts((accounts) => accounts.map((a) => ({ ...a, desktop: a.name === name }))); };

// First ready account, scanning cyclically from the one after `after`. With no `after` the scan
// starts at the first registered account (primary preferred); after a failover it rotates onward
// instead of bouncing back to an account that just filled up.
function nextAvailable(after = null, now = nowSec(), filter = null) {
  const accounts = load().filter((a) => !filter || filter(a));
  if (!accounts.length) return null;
  let start = 0;
  if (after != null) {
    const i = accounts.findIndex((a) => a.name === after);
    if (i >= 0) start = i + 1;
  }
  for (let k = 0; k < accounts.length; k++) {
    const a = accounts[(start + k) % accounts.length];
    if (isReady(a, now)) return a;
  }
  return null;
}

// When the soonest limited (but still logged-in) account comes back, or null.
function earliestUnblock(now = nowSec(), filter = null) {
  const times = load().filter((a) => (!filter || filter(a)) && !a.needsLogin && a.blockedUntil > now).map((a) => a.blockedUntil);
  return times.length ? Math.min(...times) : null;
}

// startAtLogin defaults to on: the hooks and the tool can only reach a Baton that is running.
const DEFAULT_SETTINGS = { permissionMode: 'acceptEdits', extraArgs: '', claudePath: '', startAtLogin: true, language: 'en' };
const cleanLanguage = (l) => (l === 'zh' ? 'zh' : 'en');
const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson(settingsFile(), {}) });
const saveSettings = (patch) => mutate(settingsFile(), {}, (cur) => {
  const next = { ...DEFAULT_SETTINGS, ...cur, ...patch };
  next.language = cleanLanguage(next.language);
  return next;
});

module.exports = {
  home, load, save, get, upsert, remove, update, newAccount, isReady, cleanModel,
  markLimited, markNeedsLogin, markUsed, setDesktop, observeLeader, getLeaderSeen, rememberAccountUuid, emailForUuid, nextAvailable, earliestUnblock,
  loadSettings, saveSettings, nowSec,
};
