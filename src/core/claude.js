'use strict';
// Locating and spawning the user's own `claude` binary, scoped to one account's config dir.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');

// A worker must run exactly like a standalone Claude Code signed in as that one account. A process that
// Baton starts from inside a Claude session (the MCP tool does) would otherwise inherit the HOST's
// variables: API keys / tokens that would bill the wrong thing, "host handles auth", "simple mode",
// the host's session, e-mail and socket. Strip all of them; keep only what Claude Code genuinely needs.
const HOST_VARS = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PREVIEW_|USE_(LOCAL|STAGING)_OAUTH$|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_CONFIG_DIR$)/;
const KEEP = new Set(['CLAUDE_CODE_GIT_BASH_PATH']); // Windows: where Git Bash lives

function cleanEnv(base = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(base)) if (KEEP.has(k) || !HOST_VARS.test(k)) env[k] = v;
  return env;
}

// The Claude desktop app ships and updates its own Claude Code. Prefer the newest build found there:
// older builds do not know commands such as /usage and may not understand newer session files.
function bundledClaudes() {
  const h = os.homedir();
  const roots = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Claude', 'claude-code'),
    path.join(h, 'Library', 'Application Support', 'Claude', 'claude-code'),
    path.join(h, '.config', 'Claude', 'claude-code'),
  ].filter(Boolean);
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const found = [];
  for (const root of roots) {
    let versions = [];
    try { versions = fs.readdirSync(root); } catch { continue; }
    for (const v of versions) {
      let subs = [];
      try { subs = fs.readdirSync(path.join(root, v)); } catch { continue; }
      for (const sub of subs) {
        const p = path.join(root, v, sub, exe);
        try { if (fs.statSync(p).isFile()) found.push({ version: v, path: p }); } catch { /* not a build dir */ }
      }
    }
  }
  const num = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
  found.sort((a, b) => {
    const x = num(a.version), y = num(b.version);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  });
  return found;
}

function findClaude() {
  const bundled = bundledClaudes()[0];
  if (bundled) return bundled.path;
  const win = process.platform === 'win32';
  const exts = win ? (process.env.PATHEXT || '.EXE;.CMD').toLowerCase().split(';') : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const h = os.homedir();
  dirs.push(
    path.join(h, '.local', 'bin'),
    path.join(h, '.claude', 'local'),
    ...(win && process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  );
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, `claude${ext}`);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch { /* keep looking */ }
    }
  }
  throw new Error('Claude Code was not found. Install it from https://claude.com/claude-code, then reopen Baton.');
}

function claudeCmd() {
  const raw = process.env.BATON_CLAUDE_CMD; // test hook: JSON array or a single path
  if (raw) return raw.trim().startsWith('[') ? JSON.parse(raw) : [raw];
  const custom = store.loadSettings().claudePath;
  return [custom || findClaude()];
}

function accountEnv(acct, extra = {}) {
  return { ...cleanEnv(), CLAUDE_CONFIG_DIR: acct.configDir, ...extra };
}

function spawnClaude(args, opts = {}) {
  const [cmd, ...pre] = claudeCmd();
  const shell = /\.(cmd|bat)$/i.test(cmd); // npm-installed shims need a shell on Windows
  return spawn(cmd, [...pre, ...args], { windowsHide: true, shell, ...opts });
}

// `claude auth status` only inspects local credentials: a stale token can still say loggedIn.
function authStatus(acct, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawnClaude(['auth', 'status'], { env: accountEnv(acct), stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      return resolve({ loggedIn: false, error: e.message });
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ loggedIn: false, error: e.message }));
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ loggedIn: false, error: 'unreadable `claude auth status` output' });
      }
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

module.exports = { claudeCmd, accountEnv, cleanEnv, spawnClaude, authStatus, killTree, bundledClaudes };
