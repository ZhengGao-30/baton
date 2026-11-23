'use strict';
// "Start at login" on macOS: a per-user LaunchAgent, ~/Library/LaunchAgents/dev.baton.app.plist.
// Electron's app.setLoginItemSettings() cannot pass arguments on macOS, and Baton has to start with --hidden
// so it waits in the menu bar instead of opening its window at every login. Nothing outside that one file is touched.

const fs = require('fs');
const os = require('os');
const path = require('path');

const LABEL = 'dev.baton.app';
const plistPath = () => path.join(process.env.BATON_LAUNCH_AGENTS || path.join(os.homedir(), 'Library', 'LaunchAgents'), `${LABEL}.plist`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist(programArgs) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`;
}

const isOn = () => fs.existsSync(plistPath());

// programArgs: the full command line, e.g. ['/Applications/Baton.app/Contents/MacOS/Baton', '--hidden'].
function set(on, programArgs) {
  const file = plistPath();
  if (!on) {
    fs.rmSync(file, { force: true });
    return false;
  }
  const text = plist(programArgs);
  try { if (fs.readFileSync(file, 'utf8') === text) return true; } catch { /* missing: write it */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

module.exports = { set, isOn, plistPath, LABEL };
