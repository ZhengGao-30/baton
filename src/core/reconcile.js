'use strict';
// Run when Baton starts (and now and then after): make what the panel shows match what is really on disk,
// so saved sign-ins survive restarts, shutdowns and a damaged accounts file.
//
//  1. adoptOrphans: a login folder under ~/.baton/accounts that the registry does not list (accounts.json lost,
//     damaged beyond its backup, or edited by hand) is checked with Claude Code itself and listed again.
//  2. recheckSignedOut: an account flagged "sign in needed" is tried again. If Claude Code still accepts its
//     login (the usage reading works), the flag is cleared; nobody has to sign in again for nothing.
// Neither reads or copies any credential: both only ask Claude Code about a login folder.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const usage = require('./usage');
const { authStatus } = require('./claude');

async function adoptOrphans() {
  const root = path.join(store.home(), 'accounts');
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const known = new Set(store.load().map((a) => path.resolve(a.configDir).toLowerCase()));
  const adopted = [];
  for (const name of dirs) {
    const dir = path.join(root, name);
    if (known.has(path.resolve(dir).toLowerCase())) continue;
    const probe = store.newAccount(name, dir);
    const info = await authStatus(probe);
    if (!info.loggedIn) continue; // a half-made folder, not a sign-in worth listing
    store.upsert({ ...probe, email: info.email || '', plan: info.subscriptionType || '' });
    adopted.push(name);
  }
  return adopted;
}

async function recheckSignedOut() {
  const revived = [];
  for (const a of store.load().filter((x) => x.needsLogin)) {
    const info = await authStatus(a);
    if (!info.loggedIn) continue; // really signed out (no credentials in its folder)
    await usage.refresh(a.name, { recheck: true });
    const now = store.get(a.name);
    if (now && !now.needsLogin) {
      store.update(a.name, { email: info.email || now.email, plan: info.subscriptionType || now.plan });
      revived.push(a.name);
    }
  }
  return revived;
}

async function reconcile() {
  const adopted = await adoptOrphans();
  const revived = await recheckSignedOut();
  return { adopted, revived };
}

module.exports = { reconcile, adoptOrphans, recheckSignedOut };
