'use strict';
// Connects Baton to Claude Code: adds a `StopFailure` hook to the user's ~/.claude/settings.json.
// Claude Code (CLI, VS Code and the desktop app's Code tab all read that file) then calls the
// hook script whenever a turn ends on an API error; the script forwards it to the running Baton.
// The hook is observational only: it cannot make Claude continue, which is why Baton takes over.
//
// We only ever touch our own hook entry, back the file up first, and refuse to edit a
// settings.json we cannot parse.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const setup = require('./setup');
const fslock = require('./fslock');

const MARK = 'baton-hook';
const settingsPath = () => path.join(setup.hubDir(), 'settings.json');
const binDir = () => path.join(store.home(), 'bin');
const connectFile = () => path.join(store.home(), 'connect.json');
const fwd = (p) => p.replace(/\\/g, '/');

const PS1 = `# Forwards a Claude Code StopFailure event to the running Baton. Never blocks or fails Claude.
try {
  $conn = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '..\\connect.json') | ConvertFrom-Json
  $in = [Console]::OpenStandardInput(); $ms = New-Object IO.MemoryStream; $in.CopyTo($ms)
  $h = @{
    'x-baton-token' = [string]$conn.token
    'x-baton-config-dir' = [uri]::EscapeDataString([string]$env:CLAUDE_CONFIG_DIR)
    'x-baton-takeover' = [string]$env:BATON_TAKEOVER
    'x-baton-email' = [uri]::EscapeDataString([string]$env:CLAUDE_CODE_USER_EMAIL)
    'x-baton-account-uuid' = [string]$env:CLAUDE_CODE_ACCOUNT_UUID
    'x-baton-entrypoint' = [string]$env:CLAUDE_CODE_ENTRYPOINT
  }
  Invoke-RestMethod -Uri ("http://127.0.0.1:" + $conn.port + "/hook") -Method Post -Headers $h -ContentType 'application/json' -Body $ms.ToArray() -TimeoutSec 5 | Out-Null
} catch { }
exit 0
`;

const SH = `#!/bin/sh
# Forwards a Claude Code StopFailure event to the running Baton. Never blocks or fails Claude.
dir="$(cd "$(dirname "$0")/.." && pwd)"
port=$(sed -n 's/.*"port": *\\([0-9]*\\).*/\\1/p' "$dir/connect.json")
token=$(sed -n 's/.*"token": *"\\([^"]*\\)".*/\\1/p' "$dir/connect.json")
curl -s -m 5 -X POST -H "x-baton-token: $token" -H "x-baton-config-dir: $CLAUDE_CONFIG_DIR" \\
  -H "x-baton-takeover: $BATON_TAKEOVER" -H "x-baton-email: $CLAUDE_CODE_USER_EMAIL" -H "x-baton-account-uuid: $CLAUDE_CODE_ACCOUNT_UUID" \\
  -H "x-baton-entrypoint: $CLAUDE_CODE_ENTRYPOINT" -H 'content-type: application/json' --data-binary @- \\
  "http://127.0.0.1:$port/hook" >/dev/null 2>&1
exit 0
`;

function hookCommand() {
  fs.mkdirSync(binDir(), { recursive: true });
  if (process.platform === 'win32') {
    const script = path.join(binDir(), `${MARK}.ps1`);
    fs.writeFileSync(script, PS1);
    return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${fwd(script)}"`;
  }
  const script = path.join(binDir(), `${MARK}.sh`);
  fs.writeFileSync(script, SH, { mode: 0o755 });
  return `sh "${script}"`;
}

function readSettings() {
  const file = settingsPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${e.message}). Fix it first; Baton will not touch it.`);
  }
}

function writeSettings(obj) {
  const file = settingsPath();
  fslock.writeFileAtomic(file, `${JSON.stringify(obj, null, 2)}\n`); // unique temp name + retried rename
}

const isOurs = (entry) => (entry.hooks || []).some((h) => String(h.command || '').includes(MARK));

const EVENTS = ['StopFailure', 'SessionStart'];

function status() {
  let installed = false;
  try {
    const hooks = readSettings().hooks || {};
    installed = EVENTS.every((ev) => (hooks[ev] || []).some(isOurs));
  } catch { /* unreadable settings: report as not installed */ }
  return { installed, settingsPath: settingsPath() };
}

function install() {
  const settings = readSettings();
  const file = settingsPath();
  const backup = `${file}.baton-backup`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);

  const command = hookCommand();
  settings.hooks = settings.hooks || {};
  for (const ev of EVENTS) {
    const rest = (settings.hooks[ev] || []).filter((e) => !isOurs(e));
    // StopFailure only for plan limits; SessionStart (every session) just reports who is signed in.
    rest.push({ ...(ev === 'StopFailure' ? { matcher: 'rate_limit' } : {}), hooks: [{ type: 'command', command, timeout: 10 }] });
    settings.hooks[ev] = rest;
  }
  writeSettings(settings);
  return status();
}

function uninstall() {
  const settings = readSettings();
  if (settings.hooks) {
    for (const ev of EVENTS) {
      if (!settings.hooks[ev]) continue;
      const rest = settings.hooks[ev].filter((e) => !isOurs(e));
      if (rest.length) settings.hooks[ev] = rest;
      else delete settings.hooks[ev];
    }
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
    writeSettings(settings);
  }
  return status();
}

// Called by the server on startup: tells the hook script where Baton is listening.
function writeConnect(port) {
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(store.home(), { recursive: true });
  fs.writeFileSync(connectFile(), JSON.stringify({ port, token }), { mode: 0o600 });
  return token;
}

module.exports = { install, uninstall, status, writeConnect, settingsPath };
