'use strict';
// The panel's "Recent" list comes from the project ledgers, newest first. Runs in a throw-away BATON_HOME.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-test-'));
  process.env.BATON_HOME = path.join(root, 'home');
  return { root, memory: require(`${SRC}/core/memory`) };
}

test('recentRuns: newest first across projects, limited, with project names', () => {
  const { root, memory } = sandbox();
  assert.deepEqual(memory.recentRuns(), [], 'no projects yet');
  const a = path.join(root, 'thesis-code');
  const b = path.join(root, 'Baton Site');
  memory.appendLedger(a, { at: 1000, thread: 'auth', account: 'w1@example.com', title: 'Refactor auth', ok: true });
  memory.appendLedger(b, { at: 3000, thread: '', account: 'w2@example.com', title: 'Build the site', ok: true });
  memory.appendLedger(a, { at: 2000, thread: 'tests', account: 'w2@example.com', title: 'Write tests', ok: false });
  const r = memory.recentRuns();
  assert.deepEqual(r.map((e) => e.title), ['Build the site', 'Write tests', 'Refactor auth']);
  assert.deepEqual(r[0], { project: 'Baton Site', thread: '', title: 'Build the site', account: 'w2@example.com', ok: true, at: 3000 });
  assert.equal(r[1].ok, false);
  assert.equal(memory.recentRuns(2).length, 2, 'limit');
});

test('recentRuns: an old entry without a project takes it from the folder; bad lines are skipped', () => {
  const { memory } = sandbox();
  const dir = path.join(process.env.BATON_HOME, 'projects', 'old-proj-0123456789');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), `${JSON.stringify({ at: 5, title: 'Old', account: 'x' })}\nnot json\n`);
  assert.deepEqual(memory.recentRuns(), [{ project: 'old-proj', thread: '', title: 'Old', account: 'x', ok: true, at: 5 }]);
});

test('recentRuns: only the tail of a long ledger is read', () => {
  const { root, memory } = sandbox();
  const p = path.join(root, 'big');
  const pad = 'x'.repeat(2000);
  for (let i = 0; i < 100; i++) memory.appendLedger(p, { at: i, title: `run ${i}`, summary: pad });
  const r = memory.recentRuns(3);
  assert.deepEqual(r.map((e) => e.title), ['run 99', 'run 98', 'run 97']);
});
