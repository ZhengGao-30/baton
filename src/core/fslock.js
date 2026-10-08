'use strict';
// Cross-process safety for the small JSON files every Baton process shares (each Claude window runs its own Baton
// tool process, plus the Baton app). Two things go wrong without it: two writers renaming over the same file at once
// fail on Windows (EPERM/EBUSY/ENOENT), and two read-modify-writes in parallel silently lose one of the updates.
//   withFileLock(path, fn)  runs fn while holding "<path>.lock" (exclusive create), for synchronous code only
//   writeFileAtomic / writeJson  unique temp file + rename with bounded retries; never leaves a temp file behind
//   readJson  retries briefly while another process has the file busy

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// A real sleep for synchronous code (the store API is synchronous): Atomics.wait blocks without burning CPU.
const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => { if (ms > 0) Atomics.wait(sleepBuf, 0, 0, ms); };
const token = () => crypto.randomBytes(8).toString('hex');
// EPERM from signal 0 means the process exists but belongs to someone else: it is alive.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Windows reports a file that another process has open, or that is being deleted, with these.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOENT', 'ENOTEMPTY']);

const held = new Map(); // lock file -> depth: a nested call for a lock this process already holds just runs

function readLockFile(lf) {
  let text = '';
  let mtime = 0;
  try { text = fs.readFileSync(lf, 'utf8'); mtime = fs.statSync(lf).mtimeMs; } catch { return null; }
  let info = null;
  try { info = JSON.parse(text); } catch { /* still being written, or damaged: judged by its age */ }
  return { info, mtime };
}

function isStale(cur, staleMs) {
  if (!cur) return false;
  const { info, mtime } = cur;
  if (info && info.pid && !alive(info.pid)) return true;
  const at = Number(info && info.at) || mtime;
  return Date.now() - at > staleMs;
}

// Breaking a stale lock must not race another breaker: if both saw the same stale lock, the slower one would
// delete the lock the faster one has just created. A tiny second lock serialises the breakers, and the stale
// lock is deleted only if it is still the very one that was judged stale.
function breakStale(lf, seen, staleMs) {
  const bf = `${lf}.break`;
  try {
    fs.writeFileSync(bf, String(process.pid), { flag: 'wx' });
  } catch {
    // held for microseconds in normal use; one left behind by a process that died right there is cleared
    try { if (Date.now() - fs.statSync(bf).mtimeMs > 2000) fs.rmSync(bf, { force: true }); } catch { /* gone */ }
    return;
  }
  try {
    const now = readLockFile(lf);
    const same = now && (seen.info && now.info ? now.info.token === seen.info.token : now.mtime === seen.mtime);
    if (same && isStale(now, staleMs)) fs.rmSync(lf, { force: true });
  } catch { /* someone else dealt with it */ } finally {
    try { fs.rmSync(bf, { force: true }); } catch { /* gone */ }
  }
}

function withFileLock(lockPath, fn, { timeoutMs = 10000, staleMs = 15000 } = {}) {
  const lf = `${lockPath}.lock`;
  if (held.has(lf)) {
    held.set(lf, held.get(lf) + 1);
    try { return fn(); } finally { held.set(lf, held.get(lf) - 1); }
  }
  fs.mkdirSync(path.dirname(lf), { recursive: true });
  const mine = token();
  const deadline = Date.now() + timeoutMs;
  let delay = 1;
  for (;;) {
    try {
      fs.writeFileSync(lf, JSON.stringify({ pid: process.pid, token: mine, at: Date.now() }), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && !TRANSIENT.has(e.code)) throw e;
      if (e.code === 'EEXIST') {
        const cur = readLockFile(lf);
        if (isStale(cur, staleMs)) { breakStale(lf, cur, staleMs); continue; }
      }
      if (Date.now() > deadline) throw Object.assign(new Error(`Timed out waiting for ${lf}`), { code: 'ELOCKTIMEOUT' });
      sleepSync(delay + Math.random() * delay);
      delay = Math.min(delay * 2, 25);
    }
  }
  held.set(lf, 1);
  try {
    return fn();
  } finally {
    held.delete(lf);
    // only remove it while it is still ours: if it was judged stale and taken over, it belongs to someone else now
    try {
      const cur = readLockFile(lf);
      if (cur && cur.info && cur.info.token === mine) fs.rmSync(lf, { force: true });
    } catch { /* gone */ }
  }
}

// Retries an fs operation that Windows may refuse for a moment while another process touches the same file.
function retrying(op, { tries = 30, codes = TRANSIENT } = {}) {
  let delay = 2;
  for (let i = 0; ; i++) {
    try { return op(); } catch (e) {
      if (i >= tries - 1 || !codes.has(e.code)) throw e;
      sleepSync(delay + Math.random() * delay);
      delay = Math.min(delay * 2, 100);
    }
  }
}

// Unique temp name per write (pid + random): two processes writing the same file never share a temp file.
function writeFileAtomic(file, text, { backup = false, mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${token()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, mode != null ? { mode } : undefined);
    if (backup) {
      try { // remember the previous good copy, but never let a damaged one overwrite the backup
        JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.copyFileSync(file, `${file}.bak`);
      } catch { /* first write, or nothing worth keeping */ }
    }
    retrying(() => fs.renameSync(tmp, file));
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* already renamed into place */ }
  }
}

const writeJson = (file, data, { space = 2, backup = false } = {}) => writeFileAtomic(file, JSON.stringify(data, null, space), { backup });

// Missing or unreadable as JSON: `fallback`. Busy for a moment: retried. Other errors are left to the caller.
function readJson(file, fallback) {
  let text;
  try {
    text = retrying(() => fs.readFileSync(file, 'utf8'), { tries: 10, codes: new Set(['EBUSY', 'EPERM', 'EACCES']) });
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
  try { return JSON.parse(text); } catch { return fallback; }
}

module.exports = { withFileLock, writeFileAtomic, writeJson, readJson, retrying, sleepSync, alive, token };
