import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createTask, contentHash, reviewPackageHash } from './envelope.mjs';
import { createDryRunQueue, SYNTHETIC, FIXTURE_TEXT } from './pg-dry-run-queue.mjs';

const ENDPOINT = 'postgresql://raad_test@127.0.0.1:55439/raad_test';
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(storyKey = `synthetic-${randomUUID()}`, revision = 1) {
  const task = createTask({ taskId: `synthetic-task-${randomUUID()}`, traceId: `synthetic-trace-${randomUUID()}`,
    agent: 'al-mutamid', input: { synthetic: SYNTHETIC, storyKey, text: FIXTURE_TEXT },
    revision: { id: `synthetic-r${revision}`, parentId: revision === 1 ? null : 'synthetic-r1', number: revision, revisionRounds: revision - 1 },
    policy: { id: 'synthetic-policy', version: '1', hash: contentHash('synthetic-policy'), freshnessSeconds: 86400 } });
  const result = { ...copy(task), kind: 'result', status: 'completed',
    output: { report: SYNTHETIC, reviewedHash: task.hash.value },
    decision: { status: 'APPROVED', reviewer: 'al-mutamid', reviewedAt: '2026-01-15T12:00:00Z',
      revisionId: task.revision.id, revisionHash: task.hash.value, reason: SYNTHETIC, evidenceIds: [], issueIds: [] },
    handoff: { stage: 'publishing', agent: 'al-nashir' } };
  return { task, result };
}

async function install(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const context = await c.query(`SELECT current_database() AS db, current_user AS role`);
    assert.deepEqual(context.rows[0], { db: 'raad_test', role: 'raad_test' });
    const foreign = await c.query(`SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema','raad_dry_run')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
      AND c.relkind IN ('r','p','v','m','f','S')`);
    assert.equal(foreign.rowCount, 0, 'REFUSE_NON_SYNTHETIC_DATABASE');
    const { rows: [schema] } = await c.query(`SELECT pg_catalog.to_regnamespace('raad_dry_run') IS NOT NULL AS present`);
    if (schema.present) {
      const identity = await c.query('SELECT singleton,marker FROM raad_dry_run.identity');
      assert.deepEqual(identity.rows, [{ singleton: true, marker: 'raad.synthetic-queue/1' }]);
      const tables = await c.query(`SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='raad_dry_run' AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname`);
      assert.deepEqual(tables.rows.map(r => r.relname), ['approvals', 'audit', 'identity', 'jobs', 'outbox', 'simulated_receipts']);
    }
    await c.query(await readFile(new URL('./pg-dry-run-queue.sql', import.meta.url), 'utf8'));
    await c.query('COMMIT');
  } catch (error) { try { await c.query('ROLLBACK'); } catch {} throw error; }
  finally { c.release(); }
}

export async function runIntegration(args) {
  // Exact spelling is intentional: no alternate host, password, query, or env fallback.
  assert.deepEqual(args, ['--connection-url', ENDPOINT, '--execute-synthetic'], 'EXPLICIT_SYNTHETIC_ENDPOINT_REQUIRED');
  const options = { connectionString: args[1], max: 4, connectionTimeoutMillis: 2000, statement_timeout: 3000,
    application_name: 'raad-synthetic-integration' };
  let pool = new pg.Pool(options);
  let q = createDryRunQueue(pool);
  const passed = [];
  let current = 'schema_install_and_preflight';
  const test = async (name, fn) => { current = name; await fn(); passed.push(name); };
  const enqueue = async f => q.enqueue(f.result, f.task);
  const wait = ms => pool.query("SELECT pg_catalog.pg_sleep($1::double precision / 1000)", [ms]);
  const row = async id => (await pool.query('SELECT * FROM raad_dry_run.jobs WHERE id=$1', [id])).rows[0];
  async function lockedPastExpiry(id, action) {
    const operationPool = new pg.Pool({ ...options, max: 1 });
    const holder = await pool.connect();
    let pending;
    try {
      const { rows: [backend] } = await operationPool.query('SELECT pg_catalog.pg_backend_pid() AS pid');
      await holder.query('BEGIN');
      const { rows: [owner] } = await holder.query('SELECT pg_catalog.pg_backend_pid() AS pid');
      await holder.query('SELECT id FROM raad_dry_run.jobs WHERE id=$1 FOR UPDATE', [id]);
      pending = action(createDryRunQueue(operationPool)).then(value => ({ value }), error => ({ error }));
      let observed;
      // Bounded test synchronization, not a worker polling loop. Prove the
      // operation is blocked on this unchanged tuple BEFORE the lease expires.
      for (let i = 0; i < 20; i++) {
        const { rows: [status] } = await holder.query(`SELECT lease_until>clock_timestamp() AS unexpired,
          $2::integer=ANY(pg_catalog.pg_blocking_pids($3::integer)) AS blocked
          FROM raad_dry_run.jobs WHERE id=$1`, [id, owner.pid, backend.pid]);
        if (status.blocked) { observed = status; break; }
        await holder.query('SELECT pg_catalog.pg_sleep(0.002)');
      }
      assert.deepEqual(observed, { unexpired: true, blocked: true });
      await holder.query(`SELECT pg_catalog.pg_sleep(GREATEST(0,
        extract(epoch FROM (lease_until-clock_timestamp())))+0.03) FROM raad_dry_run.jobs WHERE id=$1`, [id]);
      await holder.query('COMMIT'); // No UPDATE: exercise the unchanged-tuple wait case.
      return await pending;
    } finally {
      await holder.query('ROLLBACK'); holder.release();
      if (pending) await pending;
      await operationPool.end();
    }
  }
  try {
    await install(pool);
    // Previously unfinished synthetic jobs would make whole-queue claim assertions ambiguous.
    assert.equal((await pool.query("SELECT 1 FROM raad_dry_run.jobs WHERE state IN ('pending','leased','uncertain')")).rowCount, 0,
      'REFUSE_UNFINISHED_PREVIOUS_RUN');
    const f = fixture();
    let job, receipt;
    await test('approval_required_pending_rejected_wrong_reviewer_denied', async () => {
      await assert.rejects(q.enqueue(f.task, f.task));
      const rejected = copy(f.result); rejected.decision.status = 'REJECTED'; rejected.handoff = null;
      await assert.rejects(q.enqueue(rejected, f.task), /APPROVAL_REQUIRED/);
      const wrong = copy(f.result); wrong.decision.reviewer = 'al-nashir';
      await assert.rejects(q.enqueue(wrong, f.task));
    });
    await test('tampered_input_hash_context_and_reviewed_hash_denied', async () => {
      for (const change of [r => { r.input.text = 'real news'; }, r => { r.hash.value = '0'.repeat(64); },
        r => { r.traceId = 'different'; }, r => { r.output.reviewedHash = '0'.repeat(64); },
        r => { r.policy.version = 'different'; }]) {
        const bad = copy(f.result); change(bad); await assert.rejects(q.enqueue(bad, f.task));
      }
    });
    await test('closed_synthetic_input_denies_rehashed_real_content', async () => {
      const bad = fixture(); bad.task.input.text = 'real news'; bad.task.hash.value = reviewPackageHash(bad.task);
      bad.result = { ...bad.result, input: copy(bad.task.input), hash: copy(bad.task.hash) };
      bad.result.output.reviewedHash = bad.task.hash.value; bad.result.decision.revisionHash = bad.task.hash.value;
      await assert.rejects(enqueue(bad), /SYNTHETIC_ONLY/);
    });
    await test('concurrent_enqueue_atomic_unique_outbox_and_immutable_snapshots', async () => {
      const pair = await Promise.all([enqueue(f), enqueue(f)]); job = pair[0]; assert.equal(pair[1].id, job.id);
      const counts = await pool.query(`SELECT (SELECT count(*) FROM raad_dry_run.outbox WHERE job_id=$1)::integer AS outbox,
        (SELECT count(*) FROM raad_dry_run.approvals WHERE approval_hash=$2)::integer AS approvals`, [job.id, job.approval_hash]);
      assert.deepEqual(counts.rows[0], { outbox: 1, approvals: 1 });
      const snapshot = await pool.query('SELECT task_snapshot,review_snapshot FROM raad_dry_run.approvals WHERE approval_hash=$1', [job.approval_hash]);
      assert.deepEqual(snapshot.rows[0], { task_snapshot: f.task, review_snapshot: f.result });
      await assert.rejects(pool.query('UPDATE raad_dry_run.approvals SET task_snapshot=$1 WHERE approval_hash=$2', ['{}', job.approval_hash]), /IMMUTABLE/);
      await assert.rejects(pool.query('DELETE FROM raad_dry_run.approvals WHERE approval_hash=$1', [job.approval_hash]), /IMMUTABLE/);
      await assert.rejects(pool.query('UPDATE raad_dry_run.jobs SET approval_hash=$1 WHERE id=$2', ['0'.repeat(64), job.id]), /IMMUTABLE/);
    });
    await test('different_revision_same_story_conflicts_and_rolls_back', async () => {
      await assert.rejects(enqueue(fixture(f.task.input.storyKey, 2)), /STORY_CONFLICT/);
      assert.equal((await pool.query('SELECT 1 FROM raad_dry_run.approvals WHERE story_key=$1', [job.story_key])).rowCount, 1);
    });
    await test('sql_missing_approval_and_mismatched_outbox_denied', async () => {
      await assert.rejects(pool.query(`INSERT INTO raad_dry_run.jobs (id,story_key,package_hash,approval_hash)
        VALUES ($1,$2,$3,$4)`, [randomUUID(), `synthetic-${randomUUID()}`, '1'.repeat(64), '2'.repeat(64)]),
      error => error.code === '23503');
      await assert.rejects(pool.query(`INSERT INTO raad_dry_run.outbox (job_id,package_hash,approval_hash,event)
        VALUES ($1,$2,$3,'synthetic_enqueued')`, [randomUUID(), job.package_hash, job.approval_hash]),
      error => error.code === '23503');
    });
    await test('skip_locked_uses_independent_clients', async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN'); await c.query('SELECT id FROM raad_dry_run.jobs WHERE id=$1 FOR UPDATE', [job.id]);
        assert.equal(await q.claim('locked-contender'), null);
      } finally { await c.query('ROLLBACK'); c.release(); }
    });
    let claimed;
    await test('two_concurrent_workers_only_one_claim', async () => {
      const claims = await Promise.all([q.claim('worker-a'), q.claim('worker-b')]);
      assert.equal(claims.filter(Boolean).length, 1); claimed = claims.find(Boolean);
      assert.equal(claimed.attempts, 1); assert.equal(claimed.fence, '1');
      const worker = claims[0] ? 'worker-a' : 'worker-b';
      await assert.rejects(q.finishDryRun(job.id, claimed.fence, 'wrong-worker'), /STALE_LEASE/);
      receipt = await q.finishDryRun(job.id, claimed.fence, worker);
      assert.equal(receipt.simulated, true);
      await assert.rejects(q.finishDryRun(job.id, claimed.fence, worker), /STALE_LEASE/);
    });
    await test('reconnect_after_lost_commit_ack_preserves_receipt_and_snapshots', async () => {
      await pool.end(); pool = new pg.Pool(options); q = createDryRunQueue(pool);
      const reconciled = await q.reconcile(job.id); assert.equal(reconciled.state, 'completed');
      assert.deepEqual(reconciled.receipt, receipt);
      const saved = await pool.query('SELECT review_snapshot FROM raad_dry_run.approvals WHERE approval_hash=$1', [job.approval_hash]);
      assert.deepEqual(saved.rows[0].review_snapshot, f.result);
      assert.equal((await pool.query('SELECT 1 FROM raad_dry_run.simulated_receipts WHERE job_id=$1', [job.id])).rowCount, 1);
      await assert.rejects(pool.query('UPDATE raad_dry_run.simulated_receipts SET simulated=false WHERE job_id=$1', [job.id]), /IMMUTABLE/);
      await assert.rejects(pool.query("UPDATE raad_dry_run.audit SET event='retry' WHERE job_id=$1", [job.id]), /IMMUTABLE/);
    });
    await test('lease_expiry_uncertain_no_blind_retry_and_monotonic_fence', async () => {
      const j = await enqueue(fixture()); const old = await q.claim('old', 50);
      assert.equal(old.id, j.id); await wait(65);
      await assert.rejects(q.finishDryRun(j.id, old.fence, 'old'), /STALE_LEASE/);
      assert.equal(await q.claim('new'), null); assert.equal((await row(j.id)).state, 'uncertain');
      assert.equal((await q.reconcile(j.id)).state, 'pending'); await wait(105);
      const next = await q.claim('new'); assert.equal(next.fence, '2');
      await assert.rejects(q.finishDryRun(j.id, old.fence, 'old'), /STALE_LEASE/);
      await q.finishDryRun(j.id, next.fence, 'new');
    });
    await test('unknown_without_receipt_reconciles_before_retry', async () => {
      const j = await enqueue(fixture()); const lease = await q.claim('uncertain-worker');
      await q.fail(j.id, lease.fence, 'uncertain-worker', 'unknown');
      assert.equal(await q.claim('other'), null);
      assert.equal((await q.reconcile(j.id)).state, 'pending'); await wait(105);
      const next = await q.claim('other'); await q.finishDryRun(j.id, next.fence, 'other');
    });
    await test('bounded_backoff_three_attempts_then_durable_exhaustion', async () => {
      const j = await enqueue(fixture());
      for (let attempt = 1; attempt <= 3; attempt++) {
        const lease = await q.claim('failing'); assert.equal(lease.id, j.id); assert.equal(lease.attempts, attempt);
        const failed = await q.fail(j.id, lease.fence, 'failing', 'known_failure');
        assert.equal(failed.state, attempt === 3 ? 'exhausted' : 'pending');
        if (attempt < 3) {
          const delay = await pool.query(`SELECT extract(epoch FROM (available_at-clock_timestamp()))*1000 AS ms
            FROM raad_dry_run.jobs WHERE id=$1`, [j.id]);
          assert.ok(Number(delay.rows[0].ms) <= 1000);
          assert.ok(Number(delay.rows[0].ms) > 0, 'backoff window must still be open');
          assert.equal(await q.claim('too-early'), null, 'claim must respect scheduled backoff');
          await wait(attempt === 1 ? 105 : 205);
        }
      }
      assert.equal(await q.claim('done'), null);
      assert.equal((await pool.query('SELECT 1 FROM raad_dry_run.simulated_receipts WHERE job_id=$1', [j.id])).rowCount, 0);
      assert.equal((await pool.query("SELECT 1 FROM raad_dry_run.audit WHERE job_id=$1 AND event='exhausted'", [j.id])).rowCount, 1);
    });
    await test('failure_waiting_on_unchanged_lock_rejects_expired_lease', async () => {
      for (const outcome of ['known_failure', 'unknown']) {
        const j = await enqueue(fixture()); const lease = await q.claim('blocked-failure', 200);
        assert.equal(lease.id, j.id);
        const settled = await lockedPastExpiry(j.id,
          other => other.fail(j.id, lease.fence, 'blocked-failure', outcome));
        assert.equal(settled.error?.message, 'STALE_LEASE');
        const unchanged = await row(j.id);
        assert.equal(unchanged.state, 'leased'); assert.equal(unchanged.attempts, 1);
        assert.equal(unchanged.fence, lease.fence);
        assert.equal((await pool.query(`SELECT 1 FROM raad_dry_run.audit
          WHERE job_id=$1 AND event IN ('retry','uncertain','exhausted')`, [j.id])).rowCount, 0);
        assert.equal((await q.reconcile(j.id)).state, 'pending'); await wait(105);
        const next = await q.claim('recovered-failure'); await q.finishDryRun(j.id, next.fence, 'recovered-failure');
      }
    });
    await test('reconcile_waiting_on_unchanged_lock_uses_post_lock_clock', async () => {
      const j = await enqueue(fixture()); const lease = await q.claim('blocked-reconcile', 200);
      assert.equal(lease.id, j.id);
      const settled = await lockedPastExpiry(j.id, other => other.reconcile(j.id));
      assert.equal(settled.error, undefined); assert.deepEqual(settled.value, { state: 'pending', receipt: null });
      assert.equal((await row(j.id)).attempts, 1);
      await wait(105);
      const next = await q.claim('recovered-reconcile');
      assert.equal(next.fence, '2'); await q.finishDryRun(j.id, next.fence, 'recovered-reconcile');
    });
    await test('invalid_lease_bounds_rejected', async () => {
      for (const ms of [0, 49, 30001, 50.5]) await assert.rejects(q.claim('bounds', ms), /LEASE_DURATION/);
    });
    console.log(JSON.stringify({ synthetic: true, passed: passed.length, failed: 0, assertions: passed }));
    return passed;
  } catch {
    console.log(JSON.stringify({ synthetic: true, passed: passed.length, failed: 1,
      assertions: passed, failedAssertion: current, code: 'SYNTHETIC_INTEGRATION_FAILED' }));
    const reported = new Error('SYNTHETIC_INTEGRATION_FAILED'); reported.reported = true;
    throw reported;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIntegration(process.argv.slice(2)).catch(error => {
    if (!error.reported) console.log(JSON.stringify({ synthetic: true, failed: 1, code: 'SYNTHETIC_INTEGRATION_FAILED' }));
    process.exitCode = 1;
  });
}
