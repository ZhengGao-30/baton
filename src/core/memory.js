'use strict';
// The memory that survives between worker runs. Workers are separate Claude sessions that cannot
// see the dispatcher's conversation, so continuity is built from four things, all kept outside
// the user's repo under ~/.baton/projects/<project>/:
//   threads.json  named worker sessions (resumed with --resume, even across accounts)
//   ledger.jsonl  what every worker did here: summary, files, open issues
//   lock.json     one worker per folder at a time (no two accounts editing the same files)
//   queue/        tickets of the jobs waiting for that folder, served first come, first served
//   runs/         live status for the Baton panel

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const fslock = require('./fslock');

function projectDir(cwd) {
  const abs = path.resolve(cwd);
  const key = crypto.createHash('sha1').update(abs.toLowerCase()).digest('hex').slice(0, 10);
  const slug = path.basename(abs).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return path.join(store.home(), 'projects', `${slug}-${key}`);
}
const file = (cwd, name) => path.join(projectDir(cwd), name);

function readJson(f, fallback) {
  try { return fslock.readJson(f, fallback); } catch { return fallback; }
}
const writeJson = (f, data) => fslock.writeJson(f, data);

// ---- threads ----
const listThreads = (cwd) => readJson(file(cwd, 'threads.json'), {});
const getThread = (cwd, name) => listThreads(cwd)[name] || null;
function putThread(cwd, name, data) {
  const f = file(cwd, 'threads.json');
  fslock.withFileLock(f, () => { // two windows finishing threads of the same project at once must not drop one
    const all = readJson(f, {});
    all[name] = { ...(all[name] || { createdAt: Date.now() }), ...data, updatedAt: Date.now() };
    writeJson(f, all);
  });
}

// ---- ledger ----
function appendLedger(cwd, entry) {
  fs.mkdirSync(projectDir(cwd), { recursive: true });
  fs.appendFileSync(file(cwd, 'ledger.jsonl'), `${JSON.stringify({ at: Date.now(), project: path.basename(path.resolve(cwd)), ...entry })}\n`);
}
function readLedger(cwd) {
  try {
    return fs.readFileSync(file(cwd, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
// The newest finished worker runs across every project, for the panel's "Recent" list. Only the tail of each
// ledger is read, so a long history stays cheap. Older entries carry no project name: it comes from the folder.
function recentRuns(limit = 6) {
  const root = path.join(store.home(), 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    let text = '';
    try {
      const f = path.join(root, d, 'ledger.jsonl');
      const size = fs.statSync(f).size;
      const n = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(n);
      const fd = fs.openSync(f, 'r');
      try { fs.readSync(fd, buf, 0, n, size - n); } finally { fs.closeSync(fd); }
      text = buf.toString('utf8');
      if (n < size) text = text.slice(text.indexOf('\n') + 1); // drop the cut-off first line
    } catch { continue; }
    for (const line of text.split('\n').filter(Boolean).slice(-limit)) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      out.push({
        project: e.project || d.replace(/-[0-9a-f]{10}$/, ''), thread: e.thread || '', title: e.title || '',
        account: e.account || '', ok: e.ok !== false, at: Number(e.at) || 0,
      });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// Markdown the next worker (or the dispatcher after its context was compacted) can read.
// `sinceMs` + `excludeThread` give a resumed worker only what the OTHER threads did meanwhile.
function ledgerText(cwd, { sinceMs = 0, excludeThread = '', maxChars = 6000 } = {}) {
  const blocks = readLedger(cwd)
    .filter((e) => e.at > sinceMs && (!excludeThread || e.thread !== excludeThread))
    .map((e) => [
      `### ${stamp(e.at)} · thread "${e.thread || '(one-off)'}" · ${e.account || 'worker'}${e.ok === false ? ' · NOT FINISHED' : ''}`,
      `Task: ${e.title}`,
      e.summary ? `Result: ${e.summary}` : '',
      e.files && e.files.length ? `Files touched: ${e.files.join(', ')}` : '',
      e.commands && e.commands.length ? `Commands run: ${e.commands.join(' | ')}` : '',
    ].filter(Boolean).join('\n'));
  let text = blocks.join('\n\n');
  if (text.length > maxChars) text = `…(older entries omitted)\n${text.slice(-maxChars)}`;
  return text;
}

// ---- one worker per folder ----
// The lock's pid is the long-lived Baton process of a whole Claude window, so "is the pid alive" alone would let a
// dead or stuck run inside a living window block the folder for hours. The owner therefore refreshes `beat` every
// few seconds while it holds the lock; a lock whose owner is gone or has stopped beating is free to take over.
const alive = fslock.alive;
const BEAT_MS = Number(process.env.BATON_LOCK_BEAT_MS) || 5000; // tests shorten it
const STALE_MS = 45000;
const heldLocks = new Map(); // token -> release(): every folder lock / queue ticket this process holds

function lockStale(cur) {
  if (!cur || typeof cur !== 'object') return false;
  if (cur.unreadable) return Date.now() - cur.at > STALE_MS;
  if (!cur.pid || !alive(cur.pid)) return true;
  if (cur.pid === process.pid && cur.token && !heldLocks.has(cur.token)) return true; // ours by pid, but no run of ours holds it
  return Date.now() - (Number(cur.beat || cur.at) || 0) > STALE_MS;
}

// null = no lock. Unreadable means "still being written" (exclusive create, then write) unless it stays that way.
function readLock(f) {
  let text;
  try {
    text = fslock.retrying(() => fs.readFileSync(f, 'utf8'), { tries: 10, codes: new Set(['EBUSY', 'EPERM', 'EACCES']) });
  } catch (e) {
    return e.code === 'ENOENT' ? null : { unreadable: true, at: Date.now() };
  }
  try { return JSON.parse(text); } catch { /* fall through */ }
  try { return { unreadable: true, at: fs.statSync(f).mtimeMs }; } catch { return null; }
}

let exitHooked = false;
function releaseAll() {
  for (const release of [...heldLocks.values()]) { try { release(); } catch { /* best effort on the way out */ } }
}
// A process that is going away must never leave a folder locked: release on exit and on Ctrl-C / termination.
// The signal handlers only exit by themselves when nobody else (src/mcp.js) handles the signal.
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', releaseAll);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.on(sig, () => { releaseAll(); if (process.listenerCount(sig) === 1) process.exit(code); });
  }
}

// This process now holds `f`: beat until released; release removes it only while it is still ours (pid + token).
function own(f, mine) {
  hookExit();
  const beat = setInterval(() => {
    try {
      fslock.withFileLock(f, () => {
        const cur = readLock(f);
        if (cur && cur.pid === process.pid && cur.token === mine.token) writeJson(f, { ...cur, beat: Date.now() });
        else clearInterval(beat); // taken over (we were judged stuck) or removed: stop pretending
      });
    } catch { /* a missed beat is harmless: the next one comes in a few seconds */ }
  }, BEAT_MS);
  beat.unref();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    heldLocks.delete(mine.token);
    try {
      fslock.withFileLock(f, () => {
        const cur = readLock(f);
        if (cur && cur.pid === process.pid && cur.token === mine.token) fslock.retrying(() => fs.rmSync(f, { force: true }));
      });
    } catch { /* not removable right now: its stopped heartbeat frees it within STALE_MS */ }
  };
  heldLocks.set(mine.token, release);
  return release;
}

// One attempt: { release } when this process now holds the folder, else { busy: <the current holder> }.
function acquireLock(cwd, info = {}) {
  const f = file(cwd, 'lock.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const now = Date.now();
  const mine = { pid: process.pid, token: fslock.token(), at: now, beat: now, thread: '', ...info };
  try {
    fs.writeFileSync(f, JSON.stringify(mine), { flag: 'wx' }); // exclusive create: exactly one creator wins
    return { release: own(f, mine) };
  } catch (e) {
    if (e.code !== 'EEXIST' && !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
  }
  // Someone holds it (or it is being deleted). Judging it stale and taking it over happens under a file lock, so
  // two processes never both take over the same stale lock, and its owner cannot release or beat halfway through.
  let busy = null;
  try {
    fslock.withFileLock(f, () => {
      const cur = readLock(f);
      if (!cur) {
        try { fs.writeFileSync(f, JSON.stringify(mine), { flag: 'wx' }); } catch { busy = { thread: '?' }; }
      } else if (lockStale(cur)) {
        writeJson(f, mine);
      } else {
        busy = cur;
      }
    });
  } catch {
    busy = busy || { thread: '?' };
  }
  return busy ? { busy } : { release: own(f, mine) };
}

// The current live holder of the folder, or null.
const lockHolder = (cwd) => { const cur = readLock(file(cwd, 'lock.json')); return cur && !lockStale(cur) ? cur : null; };

// ---- waiting for a folder: first come, first served ----
// Every job that finds the folder busy leaves a ticket in queue/, stamped with its arrival time. Only the oldest
// live ticket may try the lock, so jobs run in the order they arrived. Tickets beat like locks; one whose owner
// died or stopped beating is thrown away, so a crashed window never blocks the line.
const queueDir = (cwd) => path.join(projectDir(cwd), 'queue');

function joinQueue(cwd, info = {}) {
  const now = Date.now();
  const mine = { pid: process.pid, token: fslock.token(), at: now, beat: now, thread: info.thread || '' };
  const f = path.join(queueDir(cwd), `${String(now).padStart(15, '0')}-${process.pid}-${mine.token}.json`);
  writeJson(f, mine);
  return { token: mine.token, release: own(f, mine) };
}

// The live tickets in arrival order; dead ones are removed on the way.
function queue(cwd) {
  const dir = queueDir(cwd);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const f = path.join(dir, n);
    const t = readLock(f);
    if (!t) continue;
    if (lockStale(t)) {
      try {
        fslock.withFileLock(f, () => { if (lockStale(readLock(f))) fs.rmSync(f, { force: true }); });
      } catch { /* next round */ }
      continue;
    }
    if (!t.unreadable) out.push({ ...t, name: n });
  }
  return out.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : 1));
}

// ---- live runs, for the panel ----
const runsDir = () => path.join(store.home(), 'runs');
// The panel's live view must never take a job down: a status write that fails (another process reading the
// file at that instant, a full disk) is skipped, the next one comes a moment later.
function writeRun(id, data) {
  try { writeJson(path.join(runsDir(), `${id}.json`), { id, pid: process.pid, ...data }); } catch { /* next tick */ }
}
function removeRun(id) {
  try { fslock.retrying(() => fs.rmSync(path.join(runsDir(), `${id}.json`), { force: true }), { tries: 10 }); } catch { /* gone */ }
}
function listRuns() {
  let names = [];
  try { names = fs.readdirSync(runsDir()); } catch { return []; }
  const out = [];
  for (const n of names) {
    const f = path.join(runsDir(), n);
    const r = readJson(f, null);
    if (!r) continue;
    if (!alive(r.pid) && Date.now() - (r.updatedAt || 0) > 10000) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } continue; }
    out.push(r);
  }
  return out;
}

module.exports = {
  projectDir, listThreads, getThread, putThread, appendLedger, readLedger, recentRuns, ledgerText,
  acquireLock, lockHolder, joinQueue, queue, releaseAll, writeRun, removeRun, listRuns, STALE_MS,
};
