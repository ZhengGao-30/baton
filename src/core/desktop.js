'use strict';
// Which account is the Claude desktop app signed in to, as far as Baton can tell from outside?
//
// The app keeps each Code session's metadata under  claude-code-sessions/<account-uuid>/<organisation-uuid>/,
// so the account folder holding the most recent session is the one that was last in use. Only folder names and
// timestamps are read: never a session's contents, and nothing from the app's own credential files.
// An account UUID is not an e-mail; store.rememberAccountUuid() maps it to one the first time a Claude Code
// session reports both (the desktop app puts the signed-in e-mail and the account UUID in every session).

const fs = require('fs');
const os = require('os');
const path = require('path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ttl = () => (process.env.BATON_DESKTOP_TTL !== undefined ? Number(process.env.BATON_DESKTOP_TTL) : 3000); // tests set 0

function roots() {
  if (process.env.BATON_DESKTOP_DIR) return [process.env.BATON_DESKTOP_DIR]; // tests
  const h = os.homedir();
  return [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Claude', 'claude-code-sessions'),
    path.join(h, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
    path.join(h, '.config', 'Claude', 'claude-code-sessions'),
  ].filter(Boolean);
}

const subdirs = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
};

// Newest modification time (ms) of any session file below one account folder; 0 when there are none.
function lastActivity(accountDir) {
  let newest = 0;
  for (const org of subdirs(accountDir)) {
    const orgDir = path.join(accountDir, org);
    let files = [];
    try { files = fs.readdirSync(orgDir); } catch { continue; }
    for (const f of files) {
      try { newest = Math.max(newest, fs.statSync(path.join(orgDir, f)).mtimeMs); } catch { /* removed meanwhile */ }
    }
  }
  return newest;
}

let cached = { at: 0, value: null };

// { uuid, at } for the account most recently used in the desktop app, or null when the app has not been used here.
function activeAccount({ fresh = false } = {}) {
  if (!fresh && Date.now() - cached.at < ttl()) return cached.value;
  let best = null;
  for (const root of roots()) {
    for (const uuid of subdirs(root)) {
      if (!UUID.test(uuid)) continue;
      const at = lastActivity(path.join(root, uuid));
      if (at && (!best || at > best.at)) best = { uuid: uuid.toLowerCase(), at };
    }
  }
  cached = { at: Date.now(), value: best };
  return best;
}

module.exports = { activeAccount };
