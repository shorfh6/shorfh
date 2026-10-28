import { randomUUID } from 'node:crypto';
import { validateResult, contentHash } from './envelope.mjs';

export const SYNTHETIC = 'SYNTHETIC NOT REAL NEWS';
export const FIXTURE_TEXT = 'SYNTHETIC NOT REAL NEWS: queue reference fixture';
export const LIMITS = Object.freeze({ attempts: 3, leaseMinMs: 50, leaseMaxMs: 30000, backoffBaseMs: 100, backoffMaxMs: 1000 });
const check = (ok, code) => { if (!ok) throw new Error(code); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const domain = new Set(['STORY_CONFLICT', 'APPROVAL_CONFLICT', 'STALE_LEASE', 'JOB_NOT_FOUND', 'NOT_UNCERTAIN', 'BOUND_APPROVAL']);
const workerHash = value => {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value), 'WORKER_ID');
  return contentHash(value);
};
function approved(result, task) {
  validateResult(result, task);
  check(task.stage === 'approval' && task.agent === 'al-mutamid' && result.status === 'completed' &&
    result.decision?.status === 'APPROVED' && result.output?.reviewedHash === task.hash.value, 'APPROVAL_REQUIRED');
  // Closed fixture dialect: adding a marker to real news cannot enter this queue.
  check(Object.keys(task.input).sort().join(',') === 'storyKey,synthetic,text' &&
    task.input.synthetic === SYNTHETIC && task.input.text === FIXTURE_TEXT &&
    /^synthetic-[a-f0-9-]{36}$/.test(task.input.storyKey) && uuid(task.input.storyKey.slice(10)) &&
    ['sources', 'claims', 'evidence', 'references', 'issues'].every(k => task[k].length === 0), 'SYNTHETIC_ONLY');
}

/** Trusted coordinator API. Import does not connect, install SQL, or start work. */
export function createDryRunQueue(pool) {
  async function transaction(fn) {
    const client = await pool.connect();
    let committing = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const value = await fn(client);
      committing = true;
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
      if (domain.has(error.message)) throw error;
      throw new Error(committing ? 'QUEUE_DB_OUTCOME_UNKNOWN' : 'QUEUE_DB_ERROR');
    } finally { client.release(); }
  }
  const audit = (c, j, event) => c.query(`INSERT INTO raad_dry_run.audit
    (job_id,event,worker_hash,fence) VALUES ($1,$2,$3,$4)`, [j.id, event, j.worker_hash, j.fence]);
  async function bound(c, j) {
    const { rows: [a] } = await c.query(`SELECT * FROM raad_dry_run.approvals
      WHERE approval_hash=$1 AND package_hash=$2 AND story_key=$3`, [j.approval_hash, j.package_hash, j.story_key]);
    check(a, 'BOUND_APPROVAL');
    try { approved(a.review_snapshot, a.task_snapshot); } catch { throw new Error('BOUND_APPROVAL'); }
    check(contentHash({ task: a.task_snapshot, result: a.review_snapshot }) === j.approval_hash, 'BOUND_APPROVAL');
  }
  async function active(c, id, token, worker) {
    // A SELECT predicate/output can be evaluated before waiting for an unchanged
    // locked tuple. Acquire the lock first, then use a new statement's DB clock.
    const { rows: [j] } = await c.query('SELECT * FROM raad_dry_run.jobs WHERE id=$1 FOR UPDATE', [id]);
    check(j && j.state === 'leased' && j.fence === token && j.worker_hash === worker, 'STALE_LEASE');
    const valid = await c.query(`SELECT id FROM raad_dry_run.jobs
      WHERE id=$1 AND lease_until>clock_timestamp()`, [id]);
    check(valid.rowCount === 1, 'STALE_LEASE');
    await bound(c, j);
    return j;
  }
  function leaseArgs(id, token, worker) {
    check(uuid(id) && typeof token === 'string' && /^[1-9][0-9]{0,18}$/.test(token), 'LEASE_ARGUMENTS');
    return workerHash(worker);
  }
  async function transition(c, j, state, event, delay = 0, requireActive = false) {
    const { rows: [updated] } = await c.query(`UPDATE raad_dry_run.jobs SET state=$2, lease_until=NULL,
      available_at=clock_timestamp()+($3::integer * interval '1 millisecond') WHERE id=$1
      AND (NOT $4::boolean OR (state='leased' AND fence=$5 AND worker_hash=$6
        AND approval_hash=$7 AND lease_until>clock_timestamp())) RETURNING *`,
    [j.id, state, delay, requireActive, j.fence, j.worker_hash, j.approval_hash]);
    check(updated, 'STALE_LEASE');
    await audit(c, updated, event);
    return updated;
  }
  const retry = (c, j, requireActive = false) => transition(c, j, j.attempts >= LIMITS.attempts ? 'exhausted' : 'pending',
    j.attempts >= LIMITS.attempts ? 'exhausted' : 'retry',
    Math.min(LIMITS.backoffMaxMs, LIMITS.backoffBaseMs * 2 ** (j.attempts - 1)), requireActive);
  return Object.freeze({
    async enqueue(result, expectedTask) {
      approved(result, expectedTask);
      // Copy before awaiting so the caller cannot mutate data while acquiring a connection.
      const task = JSON.parse(JSON.stringify(expectedTask)), review = JSON.parse(JSON.stringify(result));
      const hash = contentHash({ task, result: review }), story = task.input.storyKey;
      return transaction(async c => {
        // Serializes conflicting enqueues, including first insert; no process-local lock.
        await c.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))', [story]);
        const { rows: [existing] } = await c.query('SELECT * FROM raad_dry_run.jobs WHERE story_key=$1', [story]);
        if (existing) {
          check(existing.package_hash === task.hash.value, 'STORY_CONFLICT');
          check(existing.approval_hash === hash, 'APPROVAL_CONFLICT');
          return existing;
        }
        await c.query(`INSERT INTO raad_dry_run.approvals
          (approval_hash,package_hash,story_key,revision_key,task_snapshot,review_snapshot)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [hash, task.hash.value, story, task.revision.id, JSON.stringify(task), JSON.stringify(review)]);
        const { rows: [j] } = await c.query(`INSERT INTO raad_dry_run.jobs (id,story_key,package_hash,approval_hash)
          VALUES ($1,$2,$3,$4) RETURNING *`, [randomUUID(), story, task.hash.value, hash]);
        await c.query(`INSERT INTO raad_dry_run.outbox (job_id,approval_hash,package_hash,event)
          VALUES ($1,$2,$3,'synthetic_enqueued')`, [j.id, hash, task.hash.value]);
        await audit(c, j, 'enqueued');
        return j;
      });
    },
    async claim(workerId, leaseMs = 5000) {
      const worker = workerHash(workerId);
      check(Number.isInteger(leaseMs) && leaseMs >= LIMITS.leaseMinMs && leaseMs <= LIMITS.leaseMaxMs, 'LEASE_DURATION');
      return transaction(async c => {
        const expired = await c.query(`SELECT * FROM raad_dry_run.jobs WHERE state='leased'
          AND lease_until<=clock_timestamp() FOR UPDATE SKIP LOCKED`);
        for (const j of expired.rows) await transition(c, j, 'uncertain', 'expired');
        const { rows: [j] } = await c.query(`SELECT * FROM raad_dry_run.jobs WHERE state='pending'
          AND attempts<3 AND available_at<=clock_timestamp() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
        if (!j) return null;
        await bound(c, j);
        const { rows: [claimed] } = await c.query(`UPDATE raad_dry_run.jobs SET state='leased',attempts=attempts+1,
          fence=fence+1,worker_hash=$2,lease_until=clock_timestamp()+($3::integer * interval '1 millisecond')
          WHERE id=$1 RETURNING *`, [j.id, worker, leaseMs]);
        await audit(c, claimed, 'claimed');
        return claimed;
      });
    },
    async finishDryRun(id, token, workerId) {
      const worker = leaseArgs(id, token, workerId);
      return transaction(async c => {
        const j = await active(c, id, token, worker);
        const { rows: [receipt] } = await c.query(`INSERT INTO raad_dry_run.simulated_receipts
          (job_id,approval_hash,package_hash,simulated) VALUES ($1,$2,$3,true) RETURNING *`, [id, j.approval_hash, j.package_hash]);
        // Recheck the DB clock after validation/insert; failure rolls back the receipt too.
        const completed = await c.query(`UPDATE raad_dry_run.jobs SET state='completed',lease_until=NULL
          WHERE id=$1 AND state='leased' AND fence=$2 AND worker_hash=$3 AND approval_hash=$4
          AND lease_until>clock_timestamp() RETURNING *`, [id, token, worker, j.approval_hash]);
        check(completed.rowCount === 1, 'STALE_LEASE');
        await audit(c, completed.rows[0], 'completed');
        return receipt;
      });
    },
    async fail(id, token, workerId, outcome) {
      const worker = leaseArgs(id, token, workerId);
      check(['known_failure', 'unknown'].includes(outcome), 'FAILURE_OUTCOME');
      return transaction(async c => {
        const j = await active(c, id, token, worker);
        return outcome === 'unknown' ? transition(c, j, 'uncertain', 'uncertain', 0, true) : retry(c, j, true);
      });
    },
    async reconcile(id) {
      check(uuid(id), 'JOB_ID');
      return transaction(async c => {
        const { rows: [j] } = await c.query('SELECT * FROM raad_dry_run.jobs WHERE id=$1 FOR UPDATE', [id]);
        check(j, 'JOB_NOT_FOUND');
        await bound(c, j);
        const { rows: [receipt] } = await c.query(`SELECT * FROM raad_dry_run.simulated_receipts
          WHERE job_id=$1 AND approval_hash=$2 AND package_hash=$3`, [id, j.approval_hash, j.package_hash]);
        if (receipt) {
          if (j.state !== 'completed') await transition(c, j, 'completed', 'reconciled');
          return { state: 'completed', receipt };
        }
        const { rows: [timing] } = await c.query(`SELECT lease_until<=clock_timestamp() AS expired
          FROM raad_dry_run.jobs WHERE id=$1`, [id]);
        check(j.state === 'uncertain' || j.state === 'leased' && timing.expired, 'NOT_UNCERTAIN');
        return { state: (await retry(c, j)).state, receipt: null };
      });
    },
  });
}
