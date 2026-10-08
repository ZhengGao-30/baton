'use strict';
// Per-account Claude config dirs. Each account gets its own dir (= its own login), but
// history, skills, plugins and settings are shared with the user's main ~/.claude so a
// session started under one account can be resumed under another.

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');

const SHARED_DIRS = ['projects', 'skills', 'plugins', 'agents', 'commands'];
const SHARED_FILES = ['settings.json', 'CLAUDE.md'];

const hubDir = () => process.env.BATON_HUB || path.join(os.homedir(), '.claude');
const accountDir = (name) => path.join(store.home(), 'accounts', name);

const exists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

function prepareConfigDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const hub = hubDir();
  fs.mkdirSync(path.join(hub, 'projects'), { recursive: true }); // the one dir that must exist to share
  for (const d of SHARED_DIRS) {
    const src = path.join(hub, d);
    const dst = path.join(dir, d);
    if (exists(src) && !exists(dst)) fs.symlinkSync(src, dst, 'junction'); // junction: no admin rights on Windows
  }
  syncSharedFiles(dir);
}

// Copy hub settings over when newer; cheap enough to call before every run.
function syncSharedFiles(dir) {
  for (const f of SHARED_FILES) {
    const src = path.join(hubDir(), f);
    const dst = path.join(dir, f);
    try {
      if (!exists(dst) || fs.statSync(src).mtimeMs > fs.statSync(dst).mtimeMs) fs.copyFileSync(src, dst);
    } catch { /* hub file absent: nothing to share */ }
  }
}

// Unlink the shared junctions first (removing the link, never its target), then the rest.
function removeConfigDir(dir) {
  if (!path.resolve(dir).startsWith(path.resolve(store.home(), 'accounts') + path.sep)) {
    throw new Error(`refusing to delete ${dir}: not inside the Baton accounts folder`);
  }
  for (const d of SHARED_DIRS) {
    const p = path.join(dir, d);
    try {
      if (fs.lstatSync(p).isSymbolicLink()) {
        try { fs.rmdirSync(p); } catch { fs.unlinkSync(p); }
      }
    } catch { /* not present */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

const sameFile = (a, b) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
};
const sessionCopy = (acct, sessionId, transcriptPath) =>
  path.join(acct.configDir, 'projects', path.basename(path.dirname(transcriptPath)), `${sessionId}.jsonl`);

// The session was started under another login (the desktop app's), so its transcript may not be
// inside this account's projects dir. Copy it in; a no-op when the dirs share `projects`.
function ensureSession(acct, { sessionId, transcriptPath }) {
  if (!sessionId || !transcriptPath || !fs.existsSync(transcriptPath)) return;
  const dest = sessionCopy(acct, sessionId, transcriptPath);
  if (sameFile(dest, transcriptPath)) return;
  if (!exists(dest) || fs.statSync(transcriptPath).mtimeMs > fs.statSync(dest).mtimeMs) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(transcriptPath, dest);
  }
}

// After a takeover ran under `acct`, hand the progress back to where the original UI reads it.
function syncSessionBack(acct, { sessionId, transcriptPath }) {
  if (!sessionId || !transcriptPath) return;
  const src = sessionCopy(acct, sessionId, transcriptPath);
  if (!exists(src) || sameFile(src, transcriptPath)) return;
  if (!exists(transcriptPath) || fs.statSync(src).mtimeMs > fs.statSync(transcriptPath).mtimeMs) fs.copyFileSync(src, transcriptPath);
}

module.exports = { prepareConfigDir, syncSharedFiles, removeConfigDir, accountDir, hubDir, ensureSession, syncSessionBack };
