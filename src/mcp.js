#!/usr/bin/env node
'use strict';
// Baton's MCP server (stdio). Claude Code starts one per session; it gives the window's Claude three
// tools so it can hand big jobs to worker accounts. Newline-delimited JSON-RPC 2.0, no dependencies.
// stdout carries protocol messages only: all logging goes to stderr.

const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const store = require('./core/store');
const memory = require('./core/memory');
const { runWorker, statusText } = require('./core/workers');

const VERSION = require('../package.json').version;

const TOOLS = [
  {
    name: 'baton_run',
    description:
      'Hand a substantial, self-contained job to a Baton worker account (a separate Claude login running the official Claude Code), so it uses that account\'s usage instead of this window\'s. ' +
      'The worker CANNOT see this conversation: put everything it needs in `task` and `context`. ' +
      'Use a stable `thread` name per line of work: calling again with the same thread continues it and the worker remembers everything. ' +
      'Returns the worker\'s final report. If it returns NO_WORKER_AVAILABLE or BUSY, tell the user and then decide whether to do the work yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Complete instructions: the goal, what "done" looks like, how to verify. Self-contained.' },
        cwd: { type: 'string', description: 'Absolute path of the project folder the worker should work in (normally this session\'s working directory).' },
        context: { type: 'string', description: 'Background from this conversation the worker needs: the user\'s goal in their words, decisions already made, constraints, relevant files, what has been tried.' },
        thread: { type: 'string', description: 'Short kebab-case name for this line of work, e.g. "auth-refactor". Reuse it to continue; omit for a one-off.' },
        read_only: { type: 'boolean', description: 'True for investigation or review that must not change any file.' },
        account: { type: 'string', description: 'Optional: run on this worker account (its e-mail or name as baton_status lists it), e.g. to run two jobs on two different accounts at the same time. Omit to let Baton pick the least busy worker.' },
        model: { type: 'string', description: 'Optional model for the worker, e.g. "haiku", "sonnet", "opus" or a full id such as "claude-haiku-5-5". Omit to use the worker account\'s default. Use a smaller model for mechanical work to save usage.' },
        title: { type: 'string', description: 'A 3-8 word label saying what this job is, shown in Baton\'s panel, e.g. "Build promo website". Max 60 characters.' },
      },
      required: ['task', 'cwd'],
    },
  },
  {
    name: 'baton_status',
    description: 'Show Baton\'s accounts (which one is this window\'s leader, which are workers, how much of their 5-hour and weekly usage is used, who is limited) and, if `cwd` is given, the worker threads in that project.',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string', description: 'Optional absolute project folder.' } } },
  },
  {
    name: 'baton_ledger',
    description: 'Read the project ledger: everything Baton workers have done in a project folder (summaries, files touched, open issues). Use it to re-orient after your own context was compacted or in a new conversation.',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string', description: 'Absolute project folder.' } }, required: ['cwd'] },
  },
];

const log = (...a) => process.stderr.write(`[baton-mcp] ${a.join(' ')}\n`);
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

// Tell the running Baton who this window is signed in as (the desktop app puts the e-mail, not a secret,
// in the session environment). That is how Baton notices the leader changed when you switch accounts.
function reportIdentity() {
  // An unexpanded "${VAR}" placeholder (the variable is not set outside the desktop app) is not an identity.
  const real = (v) => (v && !String(v).includes('${') ? String(v) : '');
  const email = real(process.env.CLAUDE_CODE_USER_EMAIL);
  if (!email || process.env.BATON_TAKEOVER) return;
  try {
    const { port, token } = JSON.parse(fs.readFileSync(path.join(store.home(), 'connect.json'), 'utf8'));
    const req = http.request({ host: '127.0.0.1', port, path: '/ident', method: 'POST', timeout: 3000, headers: { 'x-baton-token': token, 'content-type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify({ email, uuid: real(process.env.CLAUDE_CODE_ACCOUNT_UUID), entrypoint: real(process.env.CLAUDE_CODE_ENTRYPOINT) }));
  } catch { /* Baton is not running: nothing to tell */ }
}

// Jobs this window is running, by JSON-RPC request id: a cancel or the window closing stops exactly these.
const inflight = new Map(); // id -> { controller, done }

async function callTool(name, args, progressToken, signal) {
  reportIdentity();
  if (name === 'baton_status') return { text: statusText(args.cwd) };
  if (name === 'baton_ledger') {
    if (!args.cwd) return { text: 'cwd is required.', isError: true };
    const text = memory.ledgerText(args.cwd, { maxChars: 12000 });
    const threads = Object.keys(memory.listThreads(args.cwd));
    return { text: text ? `Threads: ${threads.join(', ') || '(none)'}\n\n${text}` : 'The ledger for this project is empty: no Baton worker has run here yet.' };
  }
  if (name === 'baton_run') {
    let last = 0;
    let n = 0;
    const out = await runWorker({
      task: args.task, cwd: args.cwd, context: args.context, thread: args.thread ? String(args.thread).trim() : '', readOnly: !!args.read_only, model: args.model ? String(args.model).trim() : '',
      title: args.title ? String(args.title) : '', account: args.account ? String(args.account).trim() : '',
      signal,
      onProgress: (line) => {
        if (progressToken == null || Date.now() - last < 1500) return;
        last = Date.now();
        send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: ++n, message: line } });
      },
    });
    return { text: out.text, isError: !out.ok && !['no_workers', 'workers_limited', 'busy', 'cancelled'].includes(out.code) };
  }
  return { text: `Unknown tool: ${name}`, isError: true };
}

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      reportIdentity();
      return reply({ protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'baton', version: VERSION } });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const controller = new AbortController();
      const job = { controller, done: null };
      if (id !== undefined) inflight.set(id, job);
      const work = (async () => {
        try {
          const r = await callTool(params.name, params.arguments || {}, params._meta?.progressToken, controller.signal);
          return reply({ content: [{ type: 'text', text: r.text }], isError: !!r.isError });
        } catch (e) {
          log('tool error:', e.stack || e.message);
          return reply({ content: [{ type: 'text', text: `Baton error: ${e.message}` }], isError: true });
        } finally {
          if (inflight.get(id) === job) inflight.delete(id);
        }
      })();
      job.done = work;
      return work;
    }
    case 'notifications/cancelled': {
      // The window stopped this call: stop its worker (the whole process tree), free its folder and run file.
      // runWorker answers the call itself with a short "Cancelled." once everything is cleaned up.
      const job = inflight.get(params.requestId);
      if (job) { log('cancelled request', params.requestId, params.reason || ''); job.controller.abort(); }
      return undefined;
    }
    default:
      if (method && method.startsWith('notifications/')) return undefined;
      return fail(-32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return log('ignoring unparseable line'); }
  handle(msg).catch((e) => log('handler crashed:', e.message));
});
// The window is closing (stdin ends) or this process is told to stop: stop every job it runs, wait briefly for
// their workers to be killed and their locks and run files to be released, then exit. Nothing may outlive the
// window: an orphan worker would keep running on an account and keep the folder locked.
let closing = false;
async function shutdown(code) {
  if (closing) return;
  closing = true;
  const jobs = [...inflight.values()];
  for (const j of jobs) j.controller.abort();
  const settle = Promise.allSettled(jobs.map((j) => j.done));
  await Promise.race([settle, new Promise((r) => setTimeout(r, 8000).unref())]);
  memory.releaseAll(); // whatever is still held (a job that did not finish cleaning up in time)
  process.exit(code);
}
rl.on('close', () => shutdown(0));
// The last safety net: a stray error (a status file another process held open, a progress message to a window
// that just closed, ...) is logged and the tool keeps serving. Dying here would drop every job this window runs
// and the window would show Baton as disconnected.
process.on('uncaughtException', (e) => log('uncaught exception (kept running):', (e && e.stack) || e));
process.on('unhandledRejection', (e) => log('unhandled rejection (kept running):', (e && e.stack) || e));
process.on('SIGTERM', () => shutdown(143));
process.on('SIGINT', () => shutdown(130));
// Last resort when the process ends some other way: abort what is left (kills worker trees) and free its locks.
process.on('exit', () => { for (const j of inflight.values()) j.controller.abort(); memory.releaseAll(); });
