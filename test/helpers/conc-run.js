'use strict';
// One "Claude window" for the concurrency tests: a separate OS process that shares Baton's home folder with its
// siblings, exactly like the Baton tool process each Claude window starts. Prints one JSON line when done.
const cfg = JSON.parse(process.argv[2]);
Object.assign(process.env, cfg.env);

(async () => {
  try {
    if (cfg.mode === 'store') {
      const store = require('../../src/core/store');
      for (let i = 0; i < cfg.n; i++) store.update(cfg.account, { [`p${cfg.k}`]: i });
      console.log(JSON.stringify({ ok: true }));
    } else {
      const { runWorker } = require('../../src/core/workers');
      const r = await runWorker({ task: cfg.task, cwd: cfg.cwd, thread: cfg.thread || '', account: cfg.pin || '' });
      console.log(JSON.stringify({ ok: r.ok, code: r.code, account: r.account || null, text: String(r.text).slice(0, 240) }));
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, code: 'threw', text: String((e && e.message) || e) }));
  }
})();
