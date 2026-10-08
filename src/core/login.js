'use strict';
// Guided sign-in. We run the real `claude auth login` for the account's config dir and
// intercept the browser launch (via $BROWSER) so the login page opens in a dedicated browser
// profile for that account: its claude.ai cookies persist there, accounts never contaminate
// each other, and a later re-login is one click instead of another emailed code.
// We never touch the email code or the tokens; the user completes sign-in in the browser.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const fslock = require('./fslock');
const { spawnClaude, accountEnv, authStatus } = require('./claude');

// Claude Code starts $BROWSER through cmd.exe with the OAuth URL caret-escaped inside the command
// line, which a batch file cannot read intact (its parameter parser splits at '=' and '&').
// So on Windows the launcher is a tiny PowerShell script that reads the URL out of its parent
// cmd.exe's raw command line instead of out of %1.
const PS_LAUNCHER = String.raw`# Reads the login URL Claude Code passed to its browser launcher and hands it to Baton.
try {
  $me = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
  $line = (Get-CimInstance Win32_Process -Filter "ProcessId=$($me.ParentProcessId)").CommandLine -replace '\^', ''
  if ($line -match 'https?://[^"\\\s]+') { [IO.File]::WriteAllText($env:BATON_URL_FILE, $Matches[0]) }
} catch { }
`;

// cmd.exe breaks on spaces in an unquoted launcher path (e.g. "C:\Users\John Smith"); use the 8.3 name.
function spaceFree(p) {
  if (!/\s/.test(p)) return p;
  try {
    const out = require('child_process').execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFile($env:BATON_LONG).ShortPath'],
      { encoding: 'utf8', env: { ...process.env, BATON_LONG: p } },
    ).trim();
    return out && !/\s/.test(out) ? out : p;
  } catch {
    return p;
  }
}

// The launcher files are shared by every Baton process and one may be running a launcher right now (Windows then
// refuses to overwrite it): write only when the content differs, atomically, and never fail a sign-in over it.
function putLauncher(file, text, mode) {
  try { if (fs.readFileSync(file, 'utf8') === text) return; } catch { /* missing: write it */ }
  try { fslock.writeFileAtomic(file, text, { mode }); } catch { /* the existing copy keeps working */ }
}

function ensureLauncher() {
  const dir = path.join(store.home(), 'bin');
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    putLauncher(path.join(dir, 'open-url.ps1'), PS_LAUNCHER);
    const cmd = path.join(dir, 'open-url.cmd');
    putLauncher(cmd, '@echo off\r\npowershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0open-url.ps1"\r\nexit /b 0\r\n');
    return spaceFree(cmd);
  }
  const file = path.join(dir, 'open-url.sh');
  putLauncher(file, '#!/bin/sh\nprintf \'%s\n\' "$1" > "$BATON_URL_FILE"\n', 0o755);
  return file;
}

// Only ever open genuine sign-in pages, whatever ends up in the URL file.
const LOGIN_HOSTS = /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/;
function cleanLoginUrl(raw) {
  try {
    const u = new URL(String(raw).trim().replace(/^[\\"']+|[\\"']+$/g, ''));
    return u.protocol === 'https:' && LOGIN_HOSTS.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

function chromiumCandidates() {
  const e = process.env;
  if (process.platform === 'win32') {
    const rel = [
      ['Google', 'Chrome', 'Application', 'chrome.exe'],
      ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
      ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    ];
    return [e.PROGRAMFILES, e['PROGRAMFILES(X86)'], e.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap((base) => rel.map((r) => path.join(base, ...r)));
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  const names = ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
  return (e.PATH || '').split(path.delimiter).flatMap((d) => names.map((n) => path.join(d, n)));
}

const findChromium = () => chromiumCandidates().find((p) => fs.existsSync(p)) || null;

// Open `url` in this account's own browser profile; fall back to the system default browser.
function openLoginPage(url, acct) {
  if (process.env.BATON_NO_BROWSER) return { method: 'none' };
  const browser = findChromium();
  if (browser) {
    const profile = path.join(store.home(), 'browser', acct.name);
    fs.mkdirSync(profile, { recursive: true });
    spawn(browser, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', url], {
      detached: true, stdio: 'ignore',
    }).unref();
    return { method: 'profile', browser: path.basename(browser) };
  }
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  return { method: 'default' };
}

// Returns { cancel(), sendCode(code), done: Promise<{ ok, info, output }> }.
// onUrl(url, { manual }) fires once. `manual` means the CLI only gave us the copy-the-code
// flow, so the UI should show a box for pasting the code back.
function startLogin(acct, { onUrl = () => {}, timeoutMs = 10 * 60 * 1000 } = {}) {
  const tmp = path.join(store.home(), 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const urlFile = path.join(tmp, `login-${acct.name}.url`);
  fs.rmSync(urlFile, { force: true });

  const args = ['auth', 'login', ...(acct.email ? ['--email', acct.email] : [])];
  const child = spawnClaude(args, {
    env: accountEnv(acct, { BROWSER: ensureLauncher(), BATON_URL_FILE: urlFile }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let urlSent = false;
  let output = '';
  const emit = (raw, manual) => {
    const url = cleanLoginUrl(raw);
    if (urlSent || !url) return;
    urlSent = true;
    onUrl(url, { manual });
  };
  const poll = setInterval(() => {
    try { emit(fs.readFileSync(urlFile, 'utf8').trim(), false); } catch { /* not written yet */ }
  }, 250);
  const fallback = setTimeout(() => {
    const m = /visit:\s*(https?:\/\/\S+)/.exec(output);
    if (m) emit(m[1], true);
  }, 4000);
  const deadline = setTimeout(() => child.kill(), timeoutMs);
  const collect = (d) => { output += d; };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  const done = new Promise((resolve) => {
    const finish = async (code) => {
      clearInterval(poll); clearTimeout(fallback); clearTimeout(deadline);
      fs.rmSync(urlFile, { force: true });
      const info = await authStatus(acct);
      const ok = code === 0 && !!info.loggedIn;
      if (ok) store.update(acct.name, { needsLogin: false, email: info.email || acct.email, plan: info.subscriptionType || '' });
      resolve({ ok, info, output });
    };
    child.on('error', () => finish(-1));
    child.on('close', finish);
  });

  return {
    done,
    cancel: () => child.kill(),
    sendCode: (code) => child.stdin.write(`${String(code).trim()}\n`),
  };
}

module.exports = { startLogin, openLoginPage, ensureLauncher };
