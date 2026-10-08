'use strict';
// Turns a StopFailure(rate_limit) event from any Claude Code session into a background takeover:
// the session is resumed under the next ready account and run on until the work is done.
// Several sessions can hit the limit together (the desktop app runs parallel sessions), so each
// gets its own job; one job per session id.

const EventEmitter = require('events');
const path = require('path');
const store = require('./store');
const setup = require('./setup');
const { Engine } = require('./engine');
const { parseReset } = require('./parse');

const UNKNOWN_COOLDOWN = 20 * 60;
const KEEP_RECENT = 8;

function limitWindow(message) {
  const retry = /retry after (\d+) seconds?/i.exec(message);
  if (retry) return { until: store.nowSec() + Number(retry[1]) + 2, type: 'rate' };
  const type = /weekly|7-day|seven/i.test(message) ? 'seven_day' : 'five_hour';
  return { until: parseReset(message) || store.nowSec() + UNKNOWN_COOLDOWN, type };
}

class Takeovers extends EventEmitter {
  constructor({ makeEngine = () => new Engine() } = {}) {
    super();
    this.makeEngine = makeEngine;
    this.jobs = new Map(); // sessionId -> job
    this.recent = [];
  }

  snapshot() {
    return { active: [...this.jobs.values()].map(publicJob), recent: this.recent.map(publicJob) };
  }

  stop(sessionId) {
    this.jobs.get(sessionId)?.engine.stop();
  }

  // Returns a short reason when the event was ignored, otherwise the job.
  handleHook(payload, meta = {}) {
    if (payload.hook_event_name && payload.hook_event_name !== 'StopFailure') return { ignored: 'not a StopFailure event' };
    if (payload.error !== 'rate_limit') return { ignored: `error is ${payload.error}, not rate_limit` };
    if (meta.takeover) return { ignored: 'event from one of our own takeover runs' };
    const sessionId = payload.session_id;
    if (!sessionId || !payload.cwd) return { ignored: 'event has no session or folder' };
    if (this.jobs.has(sessionId)) return { ignored: 'already taking this session over' };

    const accounts = store.load();
    const origin =
      (meta.configDir && accounts.find((a) => path.resolve(a.configDir) === path.resolve(meta.configDir))) ||
      (meta.email && accounts.find((a) => a.email && a.email.toLowerCase() === meta.email.toLowerCase())) ||
      accounts.find((a) => a.desktop) ||
      null;
    if (origin) {
      const { until, type } = limitWindow(payload.error_message || '');
      store.markLimited(origin.name, until, type);
    }

    const engine = this.makeEngine();
    const ctx = { sessionId, transcriptPath: payload.transcript_path };
    engine.prepare = (acct) => setup.ensureSession(acct, ctx);

    const job = {
      id: sessionId, project: path.basename(payload.cwd) || payload.cwd, cwd: payload.cwd,
      title: `${path.basename(payload.cwd) || payload.cwd} (continuing after a limit)`,
      origin: origin?.name || null, status: 'running', account: null, waitingUntil: null,
      lastLine: '', startedAt: Date.now(), finishedAt: null, error: null, engine,
    };
    this.jobs.set(sessionId, job);

    engine.on('state', (s) => {
      job.account = s.account;
      job.waitingUntil = s.waitingUntil;
      job.status = s.status === 'waiting' ? 'waiting' : 'running';
      this._changed();
    });
    engine.on('item', (it) => {
      if (it.kind === 'tool') job.lastLine = `${it.name} ${it.summary}`;
      else if (it.kind === 'text') job.lastLine = it.text.replace(/\s+/g, ' ').slice(0, 140);
      this._changed();
    });
    engine.on('switch', (e) => this.emit('notify', { kind: 'switch', job: publicJob(job), from: e.from, to: e.to }));
    engine.on('needs-login', (name) => this.emit('notify', { kind: 'needs-login', job: publicJob(job), account: name }));

    this.emit('notify', { kind: 'start', job: publicJob(job), origin: origin?.name || null });
    this._changed();

    engine
      .takeover({ sessionId, cwd: payload.cwd, permissionMode: store.loadSettings().permissionMode, account: origin?.name || null })
      .then(() => {
        const used = engine.account && store.get(engine.account);
        if (used) setup.syncSessionBack(used, ctx);
        job.status = engine.stopped ? 'stopped' : engine.status === 'error' ? 'failed' : 'done';
        if (job.status === 'failed') job.error = engine.items.filter((i) => i.kind === 'notice').at(-1)?.text || 'Failed';
        this._finish(job);
      });
    return { job: publicJob(job) };
  }

  _finish(job) {
    job.finishedAt = Date.now();
    this.jobs.delete(job.id);
    this.recent.unshift(job);
    this.recent.length = Math.min(this.recent.length, KEEP_RECENT);
    this.emit('notify', { kind: job.status, job: publicJob(job) });
    this._changed();
  }

  _changed() {
    this.emit('update', this.snapshot());
  }
}

function publicJob(j) {
  const { engine, ...rest } = j;
  return rest;
}

module.exports = { Takeovers };
