import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openJournal, LIMITS } from './local-journal.mjs';
import { createTask, reviewPackageHash } from './envelope.mjs';

const moduleURL = new URL('./local-journal.mjs', import.meta.url).href;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raad-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'journal');
  const task = createTask({ taskId: 'synthetic-task', traceId: 'synthetic-trace', agent: 'al-haris',
    input: { title: '../never-a-path', body: 'SYNTHETIC complete evidence' },
    revision: { id: 'r1', parentId: null, number: 1, revisionRounds: 0 },
    policy: { id: 'local', version: '1', hash: 'a'.repeat(64), freshnessSeconds: 3600 } });
  const result = { ...structuredClone(task), kind: 'result', status: 'completed', output: { report: 'synthetic review' } };
  return { root, dir, task, result, log: path.join(dir, 'audit.jsonl') };
}
function child(code, cwd, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; p.stdout.on('data', b => { output += b; }); p.stderr.on('data', b => { output += b; });
    p.on('error', reject); p.on('close', code => resolve({ code, output }));
  });
}
test('durable full snapshots, content-free audit, reopen and idempotent retry', t => {
  const f = fixture(t), j = openJournal(f.dir), td = j.recordTask(f.task), rd = j.recordResult(f.result, f.task);
  assert.equal(j.recordTask(f.task), td); assert.equal(j.recordResult(f.result, f.task), rd);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'snapshots', `${rd}.json`))), f.result);
  assert.equal(openJournal(f.dir).verify(), true); assert.equal(j.readAudit().length, 2);
  assert.ok(!fs.readFileSync(f.log, 'utf8').includes('SYNTHETIC complete evidence'));
  assert.throws(() => j.recordResult({ ...f.result, output: { report: 'different' } }, f.task));
});
test('explicit path required and stale locks never removed', t => {
  const f = fixture(t); assert.throws(() => openJournal()); assert.throws(() => openJournal('relative'));
  const j = openJournal(f.dir), lock = path.join(f.dir, 'journal.lock'); fs.writeFileSync(lock, 'stale');
  assert.throws(() => j.recordTask(f.task)); assert.throws(() => openJournal(f.dir));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'stale');
});
test('unrecorded tasks, secret results and context mismatches rejected before writing', t => {
  const f = fixture(t), j = openJournal(f.dir); assert.throws(() => j.recordResult(f.result, f.task));
  j.recordTask(f.task); const before = fs.readFileSync(f.log);
  for (const result of [{ ...f.result, traceId: 'wrong' }, { ...f.result, output: { report: 'Bearer synthetic-secret-value' } }])
    assert.throws(() => j.recordResult(result, f.task), /^Error: JOURNAL_REJECTED$/);
  assert.throws(() => j.recordResult(f.result));
  assert.deepEqual(fs.readFileSync(f.log), before); assert.equal(fs.readdirSync(path.join(f.dir, 'snapshots')).length, 1);
});
test('post-approval changes rejected before write', t => {
  const f = fixture(t), j = openJournal(f.dir);
  const task = createTask({ taskId: 'approved', traceId: 'trace', agent: 'al-mutamid', input: f.task.input,
    revision: f.task.revision, policy: f.task.policy }); j.recordTask(task);
  const result = { ...structuredClone(task), kind: 'result', status: 'completed',
    output: { report: 'review', reviewedHash: task.hash.value }, handoff: { stage: 'publishing', agent: 'al-nashir' },
    decision: { status: 'APPROVED', reviewer: 'al-mutamid', reviewedAt: '2026-10-23T00:00:00Z',
      revisionId: 'r1', revisionHash: task.hash.value, reason: 'synthetic', evidenceIds: [], issueIds: [] } };
  result.input.body = 'mutated'; result.hash.value = reviewPackageHash(result);
  assert.throws(() => j.recordResult(result, task)); assert.equal(j.readAudit().length, 1);
});
for (const damage of ['snapshot', 'log', 'missing', 'incomplete', 'version']) test(`fails closed on ${damage} before next append`, t => {
  const f = fixture(t), j = openJournal(f.dir), digest = j.recordTask(f.task);
  const file = path.join(f.dir, 'snapshots', `${digest}.json`);
  if (damage === 'snapshot') fs.appendFileSync(file, ' ');
  if (damage === 'missing') fs.unlinkSync(file);
  if (damage === 'incomplete') fs.appendFileSync(f.log, '{');
  if (damage === 'log' || damage === 'version') {
    const event = JSON.parse(fs.readFileSync(f.log)); event[damage === 'log' ? 'seq' : 'version'] = 'bad';
    fs.writeFileSync(f.log, JSON.stringify(event) + '\n');
  }
  const before = fs.readFileSync(f.log); assert.throws(() => j.verify()); assert.throws(() => j.recordResult(f.result, f.task));
  assert.throws(() => openJournal(f.dir)); assert.deepEqual(fs.readFileSync(f.log), before);
  assert.ok(!fs.existsSync(path.join(f.dir, 'journal.lock')));
});
test('orphan snapshots are safe; oversized packages rejected', t => {
  const f = fixture(t), j = openJournal(f.dir); fs.writeFileSync(path.join(f.dir, 'snapshots', `${'b'.repeat(64)}.json`), 'partial');
  j.recordTask(f.task); assert.equal(j.verify(), true);
  f.task.input.body = 'x'.repeat(LIMITS.packageBytes); f.task.hash.value = reviewPackageHash(f.task);
  assert.throws(() => j.recordTask(f.task)); assert.equal(j.readAudit().length, 1);
});
test('cross-process writers either fail closed or leave a valid chain', async t => {
  const f = fixture(t); openJournal(f.dir);
  const code = `import {openJournal} from ${JSON.stringify(moduleURL)}; try { openJournal(process.argv[1]).recordTask(JSON.parse(process.argv[2])); } catch { process.exitCode=7; }`;
  const runs = await Promise.all(Array.from({ length: 6 }, (_, n) => child(code, f.root, [f.dir, JSON.stringify({ ...f.task, taskId: `task-${n}` })])));
  assert.ok(runs.every(r => [0, 7].includes(r.code) && r.output === ''));
  assert.equal(openJournal(f.dir).readAudit().length, runs.filter(r => r.code === 0).length);
});
test('import has no filesystem side effects', async t => {
  const f = fixture(t), r = await child(`await import(${JSON.stringify(moduleURL)});`, f.root);
  assert.equal(r.code, 0); assert.equal(r.output, ''); assert.deepEqual(fs.readdirSync(f.root), []);
});
test('rejects directory links at base, ancestor, snapshots, snapshot, log and lock paths', t => {
  const f = fixture(t), j = openJournal(f.dir), digest = j.recordTask(f.task);
  const target = path.join(f.root, 'target'); fs.mkdirSync(target);
  const link = path.join(f.root, 'linked'); fs.symlinkSync(f.dir, link, 'junction');
  assert.throws(() => openJournal(link)); assert.throws(() => openJournal(path.join(link, 'child')));
  for (const file of [path.join(f.dir, 'snapshots', `${digest}.json`), f.log, path.join(f.dir, 'journal.lock'), path.join(f.dir, 'snapshots')]) {
    const backup = `${file}.backup`, exists = fs.existsSync(file);
    if (exists) fs.renameSync(file, backup);
    fs.symlinkSync(target, file, 'junction');
    try { assert.throws(() => j.verify()); assert.throws(() => j.recordTask(f.task)); }
    finally { fs.unlinkSync(file); if (exists) fs.renameSync(backup, file); }
  }
  assert.equal(j.verify(), true);
});
test('audit size is bounded and a missing established log fails closed', t => {
  const f = fixture(t), j = openJournal(f.dir); j.recordTask(f.task);
  fs.appendFileSync(f.log, ' '.repeat(LIMITS.auditBytes));
  assert.throws(() => j.verify()); assert.throws(() => j.recordResult(f.result, f.task));
  fs.unlinkSync(f.log); assert.throws(() => openJournal(f.dir));
  assert.ok(!fs.existsSync(f.log)); assert.ok(!fs.existsSync(path.join(f.dir, 'journal.lock')));
});
