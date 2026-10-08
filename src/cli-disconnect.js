'use strict';
// `Baton.exe --disconnect`: used by the Windows uninstaller to take Baton out of Claude Code (the "baton" tool,
// the skill and the two hooks). It never opens a window, never touches the saved account sign-ins, and never
// throws: whatever happens, the caller gets a one-line message and can exit 0 so an uninstaller is never blocked.

const connect = require('./core/connect');

const LIMIT_MS = 30000; // never hang an uninstaller, even if Claude Code does not answer

async function disconnect({ uninstall = connect.uninstall, limitMs = LIMIT_MS } = {}) {
  let timer;
  try {
    const st = await Promise.race([
      uninstall(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), limitMs); }),
    ]);
    const left = st && st.all === false && (st.hook || st.skill || st.mcp);
    return left ? 'Baton disconnect: finished, but some wiring is still in place.' : 'Baton disconnect: removed from Claude Code (saved sign-ins kept).';
  } catch (e) {
    return `Baton disconnect: could not finish (${(e && e.message) || e}).`;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { disconnect };
