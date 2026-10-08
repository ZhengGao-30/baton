'use strict';
// Runs one task as a headless `claude -p` process under some account. If that
// account runs out of quota mid-task, it is parked until its reset time and the same session
// (`--resume <id>`) continues on the next ready account. If every account is limited, wait for
// the earliest reset and carry on. Nothing for the user to do.

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const store = require('./store');
const memory = require('./memory');
const { withFileLock } = require('./fslock');
const setup = require('./setup');
const { spawnClaude, accountEnv, killTree } = require('./claude');
const { looksLikeLimit, looksLikeAuthError, parseReset } = require('./parse');

const CONTINUE_PROMPT =
  'The previous account hit its usage limit in the middle of this task, so the session was moved to ' +
  'another account. Continue exactly where you left off. Do not redo steps that are already finished; ' +
  'if the last tool call was interrupted, check its effect first. If everything was already finished, just say so in one sentence.';

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto', 'dontAsk'];
const UNKNOWN_RESET_COOLDOWN = 20 * 60; // no reset time in the message: re-probe later, a failed probe is cheap
const MAX_ITEMS = 3000;

// Engines of this process that are using an account right now (engine -> account name), for the least-busy choice.
const activeHere = new Map();

const hhmm = (sec) => new Date(sec * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function splitArgs(str) {
  return (str.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((s) => s.replace(/^(["'])(.*)\1$/, '$2'));
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done);
  });
}

function toolSummary(input = {}) {
  const v = input.command || input.file_path || input.path || input.pattern || input.url || input.description || '';
  return String(v || JSON.stringify(input)).slice(0, 160);
}

// Raw stream-json event -> the few transcript items the UI cares about.
function toItems(ev, acct) {
  const account = acct.name;
  if (ev.type === 'system' && ev.subtype === 'init') return [{ kind: 'init', account, model: ev.model }];
  if (ev.type === 'assistant') {
    return (ev.message?.content || []).flatMap((b) => {
      if (b.type === 'text' && b.text?.trim()) return [{ kind: 'text', account, text: b.text }];
      if (b.type === 'tool_use') return [{ kind: 'tool', account, name: b.name, summary: toolSummary(b.input) }];
      return [];
    });
  }
  if (ev.type === 'rate_limit_event' && ev.rate_limit_info?.status === 'allowed_warning') {
    const i = ev.rate_limit_info;
    const pct = i.utilization != null ? ` (${Math.round(i.utilization * 100)}% used)` : '';
    return [{ kind: 'notice', level: 'info', code: 'near_limit', params: { account, pct: i.utilization != null ? Math.round(i.utilization * 100) : null }, text: `${account} is close to its ${i.rateLimitType || 'usage'} limit${pct}` }];
  }
  if (ev.type === 'result') {
    return [{ kind: 'result', account, ok: !ev.is_error, durationMs: ev.duration_ms, turns: ev.num_turns }];
  }
  return [];
}

function runOnce(acct, { prompt, cwd, sessionId, extraArgs, permissionMode, model }, onEvent, setChild) {
  return new Promise((resolve, reject) => {
    setup.syncSharedFiles(acct.configDir);
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (permissionMode) args.push('--permission-mode', permissionMode);
    if (model) args.push('--model', model);
    if (sessionId) args.push('--resume', sessionId);
    args.push(...extraArgs);

    let child;
    try {
      child = spawnClaude(args, { cwd: cwd || undefined, env: accountEnv(acct, { BATON_TAKEOVER: '1' }), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    setChild(child);
    child.stdin.on('error', () => {});
    child.stdin.end(prompt); // via stdin: no command-line length or quoting problems

    let sid = sessionId;
    let result = null;
    let rejected = null;
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      onEvent(ev);
      if (ev.type === 'system' && ev.subtype === 'init') sid = ev.session_id || sid;
      else if (ev.type === 'rate_limit_event' && ev.rate_limit_info?.status === 'rejected') rejected = ev.rate_limit_info;
      else if (ev.type === 'result') result = ev;
    });
    child.on('close', (code) => {
      const text = (result && result.result) || stderr.trim();
      if (result && !result.is_error) return resolve({ kind: 'done', sid, result });
      if (rejected || looksLikeLimit(text || '')) {
        return resolve({ kind: 'limited', sid, resetAt: rejected?.resetsAt || parseReset(text || ''), limitType: rejected?.rateLimitType, text });
      }
      if (looksLikeAuthError(text || '')) return resolve({ kind: 'auth', sid, text });
      resolve({ kind: 'error', sid, text: text || `claude exited with code ${code}` });
    });
  });
}

class Engine extends EventEmitter {
  constructor() {
    super();
    this.tick = Number(process.env.BATON_TICK || 30) * 1000;
    this.slack = Number(process.env.BATON_SLACK || 5) * 1000;
    this.newChat(true);
  }

  newChat(force = false) {
    if (this.running && !force) throw new Error('A task is still running');
    this.running = false;
    this.status = 'idle'; // idle | running | waiting | error
    this.items = [];
    this.sessionId = null;
    this.account = null;
    this.waitingUntil = null;
    this.stopped = false;
    this.child = null;
    this.prepare = this.prepare || null;
    this.filter = this.filter || null; // restrict which accounts may be used (e.g. workers only)
    this.maxWait = this.maxWait ?? null; // seconds; refuse to wait for a reset longer than this
    this.lastError = null;
    this.abort = new AbortController();
    this.emit('reset');
    this.emit('state', this.snapshot());
  }

  snapshot() {
    return { status: this.status, running: this.running, account: this.account, sessionId: this.sessionId, waitingUntil: this.waitingUntil };
  }

  _push(item) {
    item.t = Date.now();
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    this.emit('item', item);
  }

  _state(status, patch = {}) {
    this.status = status;
    Object.assign(this, patch);
    this.emit('state', this.snapshot());
  }

  stop() {
    if (!this.running) return;
    this.stopped = true;
    killTree(this.child);
    this.abort.abort();
  }

  // Continue a session that was started elsewhere (e.g. in the desktop app) and stopped on a limit.
  // `account` is the one it was running under; it is skipped while it is limited.
  takeover({ sessionId, cwd, permissionMode, account = null }) {
    this.sessionId = sessionId;
    this.account = account;
    return this.send({ prompt: CONTINUE_PROMPT, cwd, permissionMode, hidden: true });
  }

  // The account for the next attempt: the preferred one (an explicit choice, or the account a resumed session
  // lives on) while it is ready; otherwise the ready account with the fewest Baton runs on it right now, then the
  // least recently used, then registry order. Several windows start jobs at the same moment, so choosing and
  // reserving (lastUsed + this run's account in its run file, via onReserve) happen under one cross-process lock:
  // the next window to choose already sees this reservation.
  _pick(preferred) {
    return withFileLock(path.join(store.home(), 'pick'), () => {
      activeHere.delete(this); // a failover: the account this run leaves must not count against the others
      const now = store.nowSec();
      const accounts = store.load().filter((x) => !this.filter || this.filter(x));
      let a = preferred && accounts.find((x) => x.name === preferred);
      if (!(a && store.isReady(a, now))) {
        const load = activeRuns();
        const ready = accounts.map((x, i) => ({ x, i })).filter(({ x }) => store.isReady(x, now));
        ready.sort((p, q) => (load.get(p.x.name) || 0) - (load.get(q.x.name) || 0) || (p.x.lastUsed || 0) - (q.x.lastUsed || 0) || p.i - q.i);
        a = ready.length ? ready[0].x : null;
      }
      if (!a) return null;
      store.markUsed(a.name);
      this.account = a.name;
      activeHere.set(this, a.name);
      if (this.onReserve) { try { this.onReserve(a); } catch { /* reporting must not stop the run */ } }
      return a;
    });
  }

  async send({ prompt, cwd, permissionMode, extraArgs = '', hidden = false }) {
    if (this.running) throw new Error('A task is already running');
    if (cwd && !fs.existsSync(cwd)) throw new Error(`Folder not found: ${cwd}`);
    if (permissionMode && !PERMISSION_MODES.includes(permissionMode)) throw new Error(`Unknown permission mode: ${permissionMode}`);

    this.running = true;
    this.stopped = false;
    this.abort = new AbortController();
    if (!hidden) this._push({ kind: 'user', text: prompt });
    this._state('running');
    try {
      await this._loop({ prompt, cwd, permissionMode, extraArgs: splitArgs(extraArgs) });
      activeHere.delete(this);
      this.running = false;
      if (this.stopped) this._push({ kind: 'notice', level: 'info', code: 'stopped', text: 'Stopped.' });
      this._state('idle', { waitingUntil: null });
      if (!this.stopped) this.emit('done', this.snapshot());
    } catch (e) {
      activeHere.delete(this);
      this.running = false;
      if (this.stopped) {
        this._push({ kind: 'notice', level: 'info', code: 'stopped', text: 'Stopped.' });
        this._state('idle', { waitingUntil: null });
      } else {
        this.lastError = e;
        this._push({ kind: 'notice', level: 'error', code: e.code, text: e.message });
        this._state('error', { waitingUntil: null });
        this.emit('failed', e);
      }
    }
  }

  async _loop({ prompt, cwd, permissionMode, extraArgs }) {
    let next = prompt;
    let preferred = this.account;
    for (let attempt = 0; attempt < 200 && !this.stopped; attempt++) {
      const acct = this._pick(preferred);
      if (!acct) {
        const wake = store.earliestUnblock(store.nowSec(), this.filter);
        if (wake == null) throw Object.assign(new Error('No usable account. Add one, or sign in again from the Accounts panel.'), { code: 'no_account' });
        if (this.maxWait != null && wake - store.nowSec() > this.maxWait) throw Object.assign(new Error('Every worker account has reached its limit.'), { code: 'workers_limited', until: wake });
        this._push({ kind: 'notice', level: 'warn', code: 'all_limited', params: { until: wake }, text: `Every account has hit its limit. Resuming automatically at ${hhmm(wake)}.` });
        this._state('waiting', { waitingUntil: wake });
        while (!this.stopped && Date.now() < wake * 1000 + this.slack) {
          await sleep(Math.min(this.tick, Math.max(wake * 1000 + this.slack - Date.now(), 10)), this.abort.signal);
        }
        this._state('running', { waitingUntil: null });
        continue;
      }

      if (preferred && acct.name !== preferred) {
        this._push({ kind: 'notice', level: 'switch', code: 'switch', params: { from: preferred, to: acct.name }, text: `Switched account: ${preferred} → ${acct.name}. Continuing the same session.` });
        this.emit('switch', { from: preferred, to: acct.name });
      }
      preferred = acct.name;
      this.account = acct.name; // _pick already marked it used, under the pick lock
      this.emit('state', this.snapshot());

      if (this.prepare) await this.prepare(acct, this.sessionId);
      // Which model: the one asked for explicitly, else (worker runs only) the account's own default, else
      // whatever Claude Code defaults to. A takeover never applies a worker's default: it continues someone
      // else's session and should not silently switch its model.
      const out = await runOnce(
        acct,
        { prompt: next, cwd, sessionId: this.sessionId, extraArgs, permissionMode, model: this.model || (this.useAccountModel ? acct.model : '') || '' },
        (ev) => {
          // known from the first event on, so a run stopped halfway (cancel, window closed) can still be resumed
          if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) this.sessionId = ev.session_id;
          toItems(ev, acct).forEach((it) => this._push(it));
        },
        (c) => (this.child = c),
      );
      this.sessionId = out.sid || this.sessionId;
      if (this.stopped) return;

      if (out.kind === 'done') return;
      if (out.kind === 'limited') {
        const until = out.resetAt || store.nowSec() + UNKNOWN_RESET_COOLDOWN;
        store.markLimited(acct.name, until, out.limitType || 'usage');
        this._push({ kind: 'notice', level: 'warn', code: 'limited', params: { account: acct.name, type: out.limitType || 'usage', until }, text: `${acct.name} reached its ${out.limitType || 'usage'} limit (resets ${hhmm(until)}).` });
        if (this.sessionId) next = CONTINUE_PROMPT;
        this.emit('state', this.snapshot());
      } else if (out.kind === 'auth') {
        store.markNeedsLogin(acct.name);
        this._push({ kind: 'notice', level: 'warn', code: 'needs_login', params: { account: acct.name }, text: `${acct.name} needs to sign in again. Trying another account.` });
        this.emit('needs-login', acct.name);
      } else {
        throw new Error(out.text);
      }
    }
    if (!this.stopped) throw new Error('Gave up after too many account switches.');
  }
}

// How many Baton runs use each account right now: the live run files of every process (each Claude window's Baton
// tool writes one per job) plus this process's own engines (counted once: its own run files are skipped).
function activeRuns() {
  const count = new Map();
  const add = (name) => name && count.set(name, (count.get(name) || 0) + 1);
  for (const r of memory.listRuns()) if (r.pid !== process.pid) add(r.account);
  for (const name of activeHere.values()) add(name);
  return count;
}

module.exports = { Engine, splitArgs, PERMISSION_MODES, CONTINUE_PROMPT };
