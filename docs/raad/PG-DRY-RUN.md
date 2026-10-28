# PostgreSQL synthetic DRY RUN reference

This isolated reference stores **synthetic evidence only** in `raad_dry_run`.
It has no publishing adapter, application article writes, startup migrations,
worker loop, timer, or network connection on import. SQL installation occurs
only inside the explicit integration runner, never inside the queue module.
It is not a production integration or evidence of actual publication.

## Explicit execution

The main agent must first confirm readiness and start the disposable PostgreSQL
16 cluster in TEMP, with role/database `raad_test` and port **55439**. After
that confirmation, from `C:\Users\HDsupport1\Desktop\newsWeb`:

```text
node scripts/raad/pg-dry-run-queue.integration.mjs --connection-url postgresql://raad_test@127.0.0.1:55439/raad_test --execute-synthetic
```

Only those exact arguments and endpoint are accepted. No dotenv or environment
connection lookup is used. The runner checks database/role and refuses user
relations outside its own schema. Existing own-schema installs require its
version marker and exact table inventory. Installation is transactional and
idempotent; nothing is dropped, truncated, or deleted. Completed previous runs
can coexist through UUID story keys; unfinished previous runs are refused to
avoid ambiguous global-queue assertions. The main agent stops the disposable
cluster afterward. The runner closes pools and preserves all evidence.

This file is deliberately `.integration.mjs`, outside the default offline
`scripts/raad/*.test.mjs` suite. Importing either module does not run tests.
Output is JSON with synthetic marker, test-group counts/names, or a sanitized
failure code; neither connection URLs nor snapshot text is printed.

## Coordinator API

`createDryRunQueue(pool)` uses the installed `pg` dependency via an explicitly
provided pool. Every operation uses `pool.connect()`, one client for
`BEGIN ISOLATION LEVEL READ COMMITTED`/COMMIT/ROLLBACK, and finally release.
Each queue transaction explicitly selects READ COMMITTED rather than inheriting
the supplied pool's default isolation. Values are parameters; identifiers
are fixed and relations schema-qualified.

| Method | Result / behavior |
| --- | --- |
| `enqueue(result, expectedTask)` | Validates with trusted coordinator task; returns persistent job. Exact replays are idempotent. |
| `claim(workerId, leaseMs = 5000)` | One eligible job or null, `FOR UPDATE SKIP LOCKED`; attempts and bigint-string `fence` increment. |
| `finishDryRun(jobId, fence, workerId)` | Active matching unexpired lease and bound approval required; atomically inserts unique synthetic receipt, completes job, appends audit. |
| `fail(jobId, fence, workerId, 'known_failure' \| 'unknown')` | Known failure schedules retry; unknown outcome becomes uncertain. |
| `reconcile(jobId)` | Checks durable receipt first; otherwise only uncertain/expired jobs may retry. Returns `{state, receipt}`. |

Approval must be completed `approval`/`al-mutamid`, decision APPROVED by
`al-mutamid`, with matching revision/package/reviewedHash. `reviewPackageHash`
binds all eight envelope fields, including the complete input package. Task and
result snapshots are copied before awaits, content-hashed together, create-only,
and protected against UPDATE/DELETE by explicit-install triggers. Approval,
job, outbox and receipt use constrained composite foreign keys. Package hashes,
story keys, and story/revision pairs have uniqueness constraints. Enqueue writes
snapshot, job, immutable outbox intent and audit in one transaction.

The closed input dialect is exactly `{synthetic, storyKey, text}`:
`synthetic = "SYNTHETIC NOT REAL NEWS"`, `storyKey = "synthetic-<UUID>"`,
`text = "SYNTHETIC NOT REAL NEWS: queue reference fixture"`.
Sources, claims, evidence, references and issues must be empty. Additional
content, real text with a synthetic flag, or non-synthetic inputs fail closed.
This deliberately restricted fixture format does not accept news packages.

Same story with a different package/revision is `STORY_CONFLICT`, even with a
new approval. This reference does not support revising an existing story.
Same package with a different task/review snapshot is `APPROVAL_CONFLICT`.
A different story changes the bound input and therefore its package hash.

## Recovery and bounds

Leases use the database clock and accept integer **50–30000ms**. Worker IDs
are restricted opaque identifiers, hashed before persistence. There is no lease
renewal; operations exceeding the lease must reconcile, not extend implicitly.
Expired leases become uncertain during the next explicit claim (or can be
reconciled directly); claim never blindly reclaims them. Fences never decrease.
Unknown commit acknowledgments must be reconciled by job ID, not blindly retried.
Lease operations acquire the row lock before a fresh-statement database-clock
check. Both finish and failure state-changing UPDATEs also guard owner, fence,
leased state, bound approval and unexpired lease. Reconciliation checks expiry
in a fresh statement after locking and checking receipts; it does not reuse
a clock predicate or SELECT output evaluated before a lock wait.
Completed receipts survive pool closure/reconnect; reconciliation returns the
same receipt, not a second simulated effect.

Known failures and receipt-free reconciliations use exponential backoff
`min(1000, 100 * 2^(attempts-1))` milliseconds, at most **3 claims**. Exhaustion
is a durable `exhausted` state plus audit event (DLQ equivalent, no redrive API).
The integration runner uses explicit short database sleeps, no timers or worker
loop. Lock-wait regressions use independent clients and 200ms leases, prove
the operation is blocked on an unchanged tuple before expiry using
`pg_blocking_pids`, and release the lock 30ms after database-clock expiry.
Lock observation is bounded to 20 test-only checks separated by 2ms database
sleeps. Both failure outcomes must reject as STALE_LEASE without retries;
reconciliation must recognize expiry after waiting. Backoff tests require an
immediate claim to return null inside the scheduled window. The runner covers
concurrent enqueue, two-client locking/racing, approval
and tampering denials, immutable SQL snapshots/bindings, revision conflicts,
expired fences, unknown outcomes, reconnect durability and attempt exhaustion.
Reconnect models loss of the response after committed completion; it does not
claim to fault-inject a PostgreSQL crash or network partition.

Verification: the main agent ran **15 groups passed, 0 failed** on the isolated
PostgreSQL 16.10 cluster after the lock-wait fixes. The earlier 13-group run
is historical. A separate clean cluster stop/start preserved the actual test
counts exactly: 11 synthetic jobs, 9 simulated receipts, and 59 audit events.
The test cluster was then stopped. These are synthetic database records, not
published articles or a production performance measurement.

## Trust limitations

This is a trusted-client reference, not role authentication. Envelope reviewer
strings and hashes are not signatures. Direct SQL callers can forge new valid
records or alter job state; application validation is required. PUBLIC schema,
table, sequence and function privileges are revoked, but no production role
provisioning, RLS, identity verification or least-privilege deployment is provided.
Owners/admins can disable/drop triggers or rewrite the schema; immutability is
not protection against them, and TRUNCATE is not an exposed application API.
Snapshots are full JSON, not encryption; callers must provide only synthetic,
non-secret data. Audit contains event metadata, hashed worker IDs and fences,
not raw source text. Outbox records synthetic intent, not dispatched messages.
No real integration effect or production readiness follows from these tests.
