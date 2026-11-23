'use strict';
// macOS specifics: the desktop app's bundled Claude Code lives inside a claude.app bundle, start-at-login is a
// LaunchAgent, and an app started from Finder must borrow the login shell's PATH. Runs on every platform
// (it only builds files in a temp dir), except the PATH check, which needs a POSIX shell.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('mac: the newest Claude Code inside the desktop app\'s claude.app bundle is found', { skip: process.platform === 'win32' }, () => {
  const home = tmp('baton-home-');
  const root = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
  for (const [v, build] of [['2.1.9', 'aaa'], ['2.1.30', 'bbb']]) {
    const dir = path.join(root, v, build, 'claude.app', 'Contents', 'MacOS');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude'), '');
  }
  // os.homedir() is read in a fresh process so HOME takes effect
  const out = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./src/core/claude").bundledClaudes()))'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, HOME: home, APPDATA: '' }, encoding: 'utf8',
  });
  const found = JSON.parse(out);
  assert.equal(found.length, 2);
  assert.equal(found[0].version, '2.1.30', 'newest first');
  assert.ok(found[0].path.endsWith(path.join('bbb', 'claude.app', 'Contents', 'MacOS', 'claude')));
});

test('mac: start at login writes a valid LaunchAgent that starts Baton hidden, and removes it again', () => {
  process.env.BATON_LAUNCH_AGENTS = tmp('baton-la-');
  const autostart = require('../src/core/autostart');
  assert.equal(autostart.isOn(), false);
  autostart.set(true, ['/Applications/Baton & Co.app/Contents/MacOS/Baton', '--hidden']);
  assert.equal(autostart.isOn(), true);
  const xml = fs.readFileSync(autostart.plistPath(), 'utf8');
  assert.match(xml, /<string>dev\.baton\.app<\/string>/);
  assert.match(xml, /<string>\/Applications\/Baton &amp; Co\.app\/Contents\/MacOS\/Baton<\/string>/, 'escaped for XML');
  assert.match(xml, /<string>--hidden<\/string>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  if (process.platform === 'darwin') execFileSync('plutil', ['-lint', autostart.plistPath()]);
  autostart.set(false);
  assert.equal(autostart.isOn(), false);
  delete process.env.BATON_LAUNCH_AGENTS;
});

test('mac: a bare Finder PATH is extended with the login shell\'s PATH', { skip: process.platform === 'win32' }, () => {
  const bin = tmp('baton-shellbin-');
  const rc = tmp('baton-rc-');
  // a stand-in login shell whose PATH contains `bin`
  const sh = path.join(rc, 'fake-shell');
  fs.writeFileSync(sh, `#!/bin/sh\nPATH="${bin}:$PATH"\nexport PATH\nexec /bin/sh -c "$2"\n`, { mode: 0o755 });
  const out = execFileSync(process.execPath, ['-e', 'require("./src/core/shellpath").fixPath(); console.log(process.env.PATH)'], {
    cwd: path.join(__dirname, '..'), env: { HOME: os.homedir(), SHELL: sh, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  const parts = out.trim().split(path.delimiter);
  assert.equal(parts[0], bin, 'the shell\'s PATH comes first');
  assert.ok(parts.includes('/usr/bin') && parts.includes('/opt/homebrew/bin'));
  assert.equal(new Set(parts).size, parts.length, 'no duplicates');
});
