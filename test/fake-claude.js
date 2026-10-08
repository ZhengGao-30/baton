'use strict';
// Stand-in for `claude -p --output-format stream-json`, driven by a per-account script so the
// failover logic can be tested without burning real quota.
//   FAKE_STATE : dir for counters + invocation log
//   FAKE_PLAN  : JSON { "<accountDirName>": ["ok", "limit:3600", ...] }  (one entry per invocation)
// Behaviours: ok | limit:<secs> | limit-text:<secs> | context-limit | auth | hang | crash

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args[0] === 'auth') {
  if (args[1] === 'login') {
    // pretend the browser sign-in takes a few seconds
    if (process.env.BATON_URL_FILE) fs.writeFileSync(process.env.BATON_URL_FILE, 'https://claude.ai/oauth/authorize?demo=1\n');
    setTimeout(() => process.exit(0), Number(process.env.FAKE_LOGIN_MS || 3000));
  } else {
    console.log(JSON.stringify(process.env.FAKE_LOGGED_OUT
      ? { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' } // a computer where only the desktop app is signed in
      : { loggedIn: true, email: 'fake@example.com', subscriptionType: 'max' }));
    process.exit(0);
  }
  return;
}

if (args.includes('/usage')) { // the official usage panel, as printed by a recent Claude Code
  const lines = [
    'You are currently using your subscription', '',
    'Current session: 12% used · resets Oct 8, 5pm (Australia/Sydney)',
    'Current week (all models): 20% used · resets Oct 14, 4pm (Australia/Sydney)',
    'Current week (Fable): 0% used · resets Oct 14, 4pm (Australia/Sydney)',
  ];
  console.log(JSON.stringify({ result: lines.join('\n') }));
  process.exit(0);
}
if (args[0] === 'mcp') { // `claude mcp add|remove|get ...` writes into <config dir>/.claude.json
  const cfg = path.join(process.env.CLAUDE_CONFIG_DIR || '.', '.claude.json');
  const j = fs.existsSync(cfg) ? JSON.parse(fs.readFileSync(cfg, 'utf8')) : {};
  j.mcpServers = j.mcpServers || {};
  if (args[1] === 'add') {
    const name = args.find((a, i) => i > 1 && !a.startsWith('-') && args[i - 1] !== '--scope' && args[i - 1] !== '-s');
    const dash = args.indexOf('--');
    j.mcpServers[name] = { type: 'stdio', command: args[dash + 1], args: args.slice(dash + 2), env: args.includes('-e') ? { raw: args[args.indexOf('-e') + 1] } : {} };
  } else if (args[1] === 'remove') {
    delete j.mcpServers[args.find((a, i) => i > 1 && !a.startsWith('-') && args[i - 1] !== '--scope' && args[i - 1] !== '-s')];
  }
  fs.writeFileSync(cfg, JSON.stringify(j));
  process.exit(0);
}

if (process.env.FAKE_ENV_DUMP) fs.appendFileSync(process.env.FAKE_ENV_DUMP, `${Object.keys(process.env).join('\n')}\n`);

const account = path.basename(process.env.CLAUDE_CONFIG_DIR || 'unknown');
const state = process.env.FAKE_STATE;
try { fs.mkdirSync(path.join(state, 'pids'), { recursive: true }); fs.writeFileSync(path.join(state, 'pids', String(process.pid)), ''); } catch { /* lets tests see which fake workers are still alive */ }
const plan = JSON.parse(process.env.FAKE_PLAN || '{}')[account] || ['ok'];
const counter = path.join(state, `${account}.n`);
const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(n + 1));
const behaviour = plan[Math.min(n, plan.length - 1)];

let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.FAKE_DELAY_MS || 0);
process.stdin.on('end', async () => {
  const ri = args.indexOf('--resume');
  const resume = ri >= 0 ? args[ri + 1] : null;
  const sid = resume || `sess-${Math.random().toString(36).slice(2, 8)}`;
  const mi = args.indexOf('--model');
  fs.appendFileSync(path.join(state, 'invocations.jsonl'), `${JSON.stringify({ account, behaviour, resume, prompt, model: mi >= 0 ? args[mi + 1] : null })}\n`);

  const out = (o) => console.log(JSON.stringify({ session_id: sid, ...o }));
  out({ type: 'system', subtype: 'init', model: 'fake-model' });
  await sleep(DELAY);
  const [kind, arg] = behaviour.split(':');
  const result = (is_error, text) => out({ type: 'result', subtype: 'success', is_error, result: text, duration_ms: 5, num_turns: 1 });

  if (kind === 'ok') {
    if (process.env.FAKE_WRITE) fs.writeFileSync(path.join(process.cwd(), process.env.FAKE_WRITE), 'written by the fake worker');
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/parser.ts' } }] } });
    await sleep(DELAY);
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `Picked up where the last account stopped. I split **parseExpr** into two passes and updated \`src/parser.ts\`.

Next I will run the tests.` }, { type: 'tool_use', name: 'Edit', input: { file_path: 'src/parser.ts' } }] } });
    await sleep(DELAY);
    result(false, `done by ${account}`);
  } else if (kind === 'limit') {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Date.now() / 1000 + Number(arg), rateLimitType: 'five_hour' } });
    result(true, "You've hit your session limit · resets 3pm");
    process.exit(1);
  } else if (kind === 'limit-text') {
    result(true, `Claude AI usage limit reached|${Math.floor(Date.now() / 1000) + Number(arg)}`);
    process.exit(1);
  } else if (kind === 'context-limit') {
    result(true, 'Context limit reached · /compact or /clear to continue');
    process.exit(1);
  } else if (kind === 'auth') {
    result(true, 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."}}');
    process.exit(1);
  } else if (kind === 'hang') {
    setInterval(() => {}, 1000);
  } else if (kind === 'crash') {
    process.exit(3);
  }
});
