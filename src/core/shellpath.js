'use strict';
// macOS (and Linux desktops) start an app from Finder, the Dock or a login item with a bare PATH
// (/usr/bin:/bin:/usr/sbin:/sbin). Everything Baton starts inherits it: the `claude` npm shim needs `node`,
// and a worker's Claude Code needs the user's git, node, python, Homebrew tools... So, once at start-up,
// ask the user's login shell for its PATH and put it in front of ours. Nothing else from the shell is taken.

const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const MARK = '__BATON_PATH__';

function loginShellPath() {
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  try {
    const out = execFileSync(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' },
    });
    const m = new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(out);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function fixPath() {
  if (process.platform === 'win32') return process.env.PATH;
  const h = os.homedir();
  const fromShell = loginShellPath().split(path.delimiter);
  const current = (process.env.PATH || '').split(path.delimiter);
  const fallback = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', path.join(h, '.local', 'bin')];
  const merged = [...new Set([...fromShell, ...current, ...fallback].filter(Boolean))];
  process.env.PATH = merged.join(path.delimiter);
  return process.env.PATH;
}

module.exports = { fixPath, loginShellPath };
