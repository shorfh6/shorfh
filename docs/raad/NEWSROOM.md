# Persistent newsroom coordinator — local implementation, not deployed

## Latest verification and actual service blocker

The full local suite now passes **570/570**, TypeScript passes, and isolated production builds pass. The protected original-media POST/GET integration passed **32 staging checks** against real independent staging DB/storage. This endpoint and the generic coordinator remain local changes awaiting the staged release and genuine inference cycle; do not describe them as deployed.

Actual live review of article 54 stopped with **HTTP 429 usage_limit_reached**. A later agent connection failed with `getaddrinfo ENOTFOUND chatgpt.com`. No alternative model/account was substituted, no review was fabricated, and no production pipeline was enabled. Article 54 is currently a draft containing the corrected original headline and concise wording, pending a genuine completed media review and final approval. Its original publication timestamp is preserved. Inspect the bound pending session and private blocker receipt before any technical recovery.

The durable protected runtime is now `.raad-local/newsroom-runtime/`, including the pinned web/approver-only connection helper, generated DPAPI credentials, official CA and verified official CLI 1.19.3. No operator-admin, service-role storage key, `.env`, browser profile, or provider auth store was copied. Both runtime configurations remain `enabled:false`; disabled execution was verified to stop with `NEWSROOM_RUNTIME_NOT_ENABLED` before database access. The earlier TEMP factories described below are development history, not the durable entry points.

Durable entry points, after genuine staging readiness is established:

```text
node scripts/raad/newsroom-run.mjs --adapter-module C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/newsroom-runtime/staging.mjs --execute-story
node scripts/raad/newsroom-run.mjs --adapter-module C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/newsroom-runtime/production.mjs --execute-story
```

Do not enable production solely because offline or injected tests pass. The original RSS reader task remains independent; no inference task was installed while the model quota/service was unavailable.

The coordinator connects existing RSS discovery records to the real `runReviewTask`, `openJournal`, evidence-continuation validator and `recordAndQueueApproval` importer. It stops at a **queued approval**, never claims a published article or calls the publication worker. Production integration and end-to-end verification remain outstanding.

## Files and boundaries

- `scripts/raad/newsroom-store.mjs`: private filesystem checkpoint chain and exclusive lock.
- `scripts/raad/newsroom-coordinator.mjs`: bounded single-stage ticks, source identity selection, review task construction, adoption and strict approval import.
- `scripts/raad/newsroom-adapter.mjs`: working trusted database/card/upload/preflight adapters with injected connections and transport.
- `scripts/raad/newsroom-run.mjs`: explicit trusted adapter module launcher, one stage or a bounded sequential story per invocation.
- `scripts/raad/newsroom-adapter.test.mjs`: offline database/HTTP adapter checks plus actual Windows card generation.
- `scripts/raad/newsroom-coordinator.test.mjs`: offline injected adapters/reviews/SQL transport only.
- `newsroom-content.mjs`: research/editing adoption and RSS selection; minimum excerpt/body lengths were removed so a brief fact set does not require padding. Upper limits and required nonempty content remain.

No automatic environment loading, auth-store reads, credential discovery, database migrations, deployment, scheduler installation or publication occurs on import. Production secrets belong in protected runtime configuration outside the repository; never return them from adapters or put them in journal/checkpoint data. The existing secret-pattern checks are precautionary, not a guarantee of sanitization. The trusted adapter module is executable code and must never originate from RSS or agent output.

## Stage progression

`reserve → research → verification → editing → prepare → media → preflight → approval → import → queued`

Each tick performs at most one stage. The newest eligible RSS notice is selected using its canonical Okaz URL SHA-256 identity and a maximum 24-hour window; all story identities, including blocked/unknown/duplicate stories, remain retained. RSS data is reduced to title, URL, dates and identity. RSS itself remains titles/URLs/dates only.

`runStory({maxStages:24})` runs those stages sequentially in one invocation under the **same exclusive lock throughout**. It stops at the first terminal outcome (`queued`, `blocked`, `unknown`, `duplicate`, `escalated`, `rejected`, or idle), writes a fsynced `run-<time>-<pid>.receipt.json` in the private runtime directory, and returns its sanitized receipt. It does not require nine scheduler polls or wait between ordinary stages. The receipt explicitly says `publicationVerified:false`.

1. **reserve** atomically checks the source against existing articles and reserves a private, explicitly non-ready draft, returning its stable article ID and current category/context data. An existing article returns `duplicate` and ends this story.
2. **research** calls the investigator with the selected URL. Authentic review proof must show that exact URL was fetched. The investigator proposes 2–5 facts, short cited evidence and routine/sensitive risk. Sensitive/unsupported findings stop for escalation. External content is explicitly inert.
3. **verification** is a distinct investigator task/session over the adopted facts and evidence. All claim verdicts must verify their own referenced evidence. Research completion alone is not verification.
4. **editing** receives verified facts and evidence continuity. It must produce original concise Arabic news and SEO. Source-prefix headlines (including `بحسب عكاظ`) are rejected; attribution belongs in the body/footer. No padding, invented dates, independent-confirmation claims or fabricated links. A claim map must cover every adopted fact. Semantic quality still requires the authentic reviews; structural checks are not fact checking.

   The claim map accepts both legacy `{claimId}` rows and actual editor `{section,paragraph,claimIds:[...],evidenceIds:[...]}` rows. Rows must use exactly one claim-ID shape, with nonempty, unique, known IDs. Every adopted fact must be covered. Optional evidence references must exist, belong to claims mapped by that row, and support every mapped claim. Unknown IDs, ambiguous shapes, empty/duplicate arrays, malformed locations and incomplete coverage are rejected before media preparation. The paragraph map itself remains intact in the adopted output and review lineage.
5. **prepare** invokes the trusted original-card/storage/draft adapter. It must use `scripts/raad/create-news-card.ps1` for original artwork and the new `/api/raad/media` integration for upload. It returns the exact draft snapshot, candidate and actual image provenance. The adapter must preserve adopted editing text/SEO/category/tags; mismatches are rejected.
6. **media** reviews the actual original artwork and rights; confirmed rights are required. The final import gate additionally matches its manifest hash against the candidate.
7. **preflight** reads the current draft and uploaded image and checks cross-article source uniqueness. Proof must match snapshot digest and image SHA-256.
8. **approval** reviews the full immutable bound package with authentic prior review references. `REVISION_REQUIRED` returns to editing, discards superseded media/final review from the active lineage and permits at most two correction rounds. Every task/result remains in the journal and checkpoint history. Rejection/escalation stops.
9. **import** validates the full authentic packet again and uses the existing atomic approver transaction to record and enqueue it. It does not invoke a publisher. Server snapshot enforcement remains authoritative when the draft changes after preflight/approval.

The configured policy hash/version is persisted per story; changing it blocks continuation rather than silently reusing old reviews. Freshness is checked at every stage, and total transitions are capped at 24. There is no automatic retry, fallback model, synthetic production review, or automatic unlock.

## Adapter contract (explicit injection)

`createNewsroomCoordinator({directory, discoveryFile, policy, cli, adapters, execute:true})` returns `{tick}`. Both paths must be absolute. `directory` must already exist, be private and be under ignored `.raad-local/` in real operation; it must not contain symlink components. `discoveryFile` points at the reader's `discovery.json`. `policy` has the existing `{id,version,hash,freshnessSeconds}` contract, with freshness at most 86400 seconds. `cli` supplies the absolute official executable and optional model/variant/timeout/compact options to the existing review runner. The coordinator overrides journal directory, fetch allowlist, read allowlist and execute settings for each task.

Adapters are trusted capabilities with closures over explicitly supplied database/storage configuration. Their results must be sanitized JSON, never clients, credentials, connection strings or raw error dumps:

| Capability | Required behavior/result |
| --- | --- |
| `reserveDraft({operationId,sourceKey,notice})` | Atomically deduplicate canonical source URL across all existing articles and reserve a draft with a stable ID. Return `{duplicate:true}` or `{articleId,categories:[{id,name}],...sanitizedEditorialContext}`. Supply current project/category proof, actual CMS rendering/SEO rules and truthful original illustration caption here. No published row creation. |
| `prepareMediaAndDraft({operationId,sourceKey,notice,articleId,edited,facts})` | Generate original card with `create-news-card.ps1`, upload via the media endpoint, write **draft only**, read back full snapshot. Return `{publicationCandidate,publicationSnapshot,originalMediaProof,metadataProjection?,allowedReadPaths?}`. Candidate/snapshot must follow `validateApprovalPacket` exactly. Include actual image-byte digest, original provenance/rights/use scope and caption/ALT. `allowedReadPaths` must be actual project-relative files permitted by `runReviewTask`; do not grant broad directories. |
| `preflight({operationId,sourceKey,notice,articleId,prepared})` | Read current persisted draft, source duplicates and actual uploaded image bytes. Return `{sourceUnique:true,snapshotHash:contentHash(actualSnapshot),imageSha256:actualByteSHA256,...sanitizedProof}` only after real checks. A flag without the reads is not evidence. |
| `withApprover(callback)` | Acquire the dedicated approver connection with configured verified TLS and bounded timeouts, invoke/await callback(client), release connection. Return its result unchanged. The coordinator calls `recordAndQueueApproval`; adapter must not publish. |

`operationId` is stable in the durable intent for investigation/idempotent reconciliation. It is not itself a database uniqueness constraint. The supplied reservation adapter implements cooperating-writer source deduplication under the global publication-scope transaction lock, then a canonical-source advisory lock, and compares canonicalized `source_url` across all articles before inserting. This is not a new database unique constraint against arbitrary noncooperating writers. One coordinator directory per deployment is required; independent stores are not mutually fenced during inference.

### Supplied runtime adapter implementation

`createNewsroomAdapters({mode,site,projectRef,projectDirectory,runtimeDirectory,withClient,requestHeaders?,...})` implements all four capabilities. `withClient(kind,callback)` must supply `(client,{role,projectRef,tlsAuthorized:true})`; the adapter rejects the wrong project, privileged/unexpected role or missing verified TLS before issuing SQL. Production is pinned to `www.shurfh.com` and `edfbsgnrsbbjngbudpfk`; staging is pinned to the approved `shorfh-raad-staging[-suffix].onrender.com` HTTPS hosts and `eotfvclpiflwikvqzhqt`. The local runtime directory must be inside the project's ignored `.raad-local/` tree.

Reservation reads current categories, inserts a clearly marked non-ready research draft with no author/image/featured/exclusive/publication state, then records ownership and its exact database snapshot locally. A later reservation can recover only that exact owned draft; it never overwrites a source-matching existing article or manually changed draft. Preparation verifies ownership/snapshot again under the global-then-source locks, writes only the adopted content/category/tags to the draft, and clears only its own prior image attachment before a replacement original-card upload. `source_url` remains unchanged, author null, featured/exclusive false. Both the draft and image attachment are read back and compared; ambiguous commits stop as unknown.

Card generation reads the existing trusted `create-news-card.ps1` into a PowerShell scriptblock executed through `-EncodedCommand` (no `-File`, no execution-policy change). News content is passed through a JSON input file, never interpolated into script source. The scoped PNG is created in `docs/raad/media/newsroom-<article>-<operation-hash>.png`; it must pass the actual static PNG validator, 1200×675 dimensions and 256KiB cap before upload. Actual generator/input/image SHA-256 and provenance are recorded in the private runtime directory. The required body caption is exactly:

> الصورة بطاقة توضيحية أصلية من شُرفة تعرض عنوان الخبر، وليست صورة للحدث.

The caption is supplied to the editor before adoption, so no unreviewed caption is appended afterward. It matches the deployed `articleImageAlt` prefix. The adapter reads `raad_queue.worker_configuration(site)` via the dedicated web connection and sends its key only in memory as `x-raad-worker-key`, with raw `image/png` and `x-raad-article-id`, to the pinned site's `/api/raad/media`. Redirects are rejected. Draft readback uses **authenticated `GET /api/raad/media`**, with the same in-memory worker key and article-ID header. The deterministic `raad-<articleId>-<SHA-prefix>.png` name must bind the requested article before a read, and the returned bytes must match both its SHA prefix and the full recorded digest. It never reads `/uploads/*` for draft verification, since those URLs require CMS authentication before publication. `/uploads/*` remains only the eventual published metadata URL. Optional staging Basic authentication is a supplied header capability, never a repository secret or agent input. Neither worker keys nor Basic headers enter checkpoints, provenance or returned proofs.

Preflight checks the actual database snapshot, cross-article source uniqueness, local card and generator hashes, stored provenance and downloaded PNG. Final approval receives a scoped `docs/raad/evidence/newsroom-<article>-clock.json` allowlisted path. Preflight returns that path without creating a file. The review wrapper exclusively creates its own clock, refreshes measured UTC every second during final review, checks the official child proof recorded a read of that exact file (case-insensitive normalized absolute paths on Windows), and rejects a completed decision timestamp outside the measured review interval. It stops its timer and removes its own clock file on success, validation failure or transport exception. A pre-existing clock is never overwritten/deleted automatically. These review-clock files contain only measured time, not credentials. Staging site identity is propagated consistently through all tasks and evidence binding; it does not accidentally import an approval for the production site.

## Explicit launcher

A protected external `.mjs` module exports `async createConfiguration()` returning the configuration above (including injected adapters), and optionally `async close()` for resource cleanup. It must supply a policy hash calculated from the current reviewed policy and explicit runtime capabilities; it must not recover secrets from repository `.env` or auth stores.

```text
node scripts/raad/newsroom-run.mjs --adapter-module <absolute-protected-module.mjs> --execute-one-stage
node scripts/raad/newsroom-run.mjs --adapter-module <absolute-protected-module.mjs> --execute-story
```

The ordinary runtime uses the real review runner. The injectable `review` parameter exists solely for offline transport tests and must not be replaced by synthetic results in operational configuration.

### Prepared local configuration and genuine staging command

The implementation also prepared **disabled** ignored runtime settings:

- `.raad-local/newsroom-staging/runtime.json`
- `.raad-local/newsroom-production/runtime.json`

Both contain only target identities, paths, policy version and an `enabled:false` readiness setting. Credentials are not embedded. Permanent executable factories outside Git now live under **`C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/newsroom-runtime/`**:

- `runtime-config.mjs` — reads the chosen disabled runtime settings before importing connection capabilities.
- `staging-runtime.mjs` — staging factory.
- `production-runtime.mjs` — production factory.
- `connection.mjs` — minimal pinned web/approver-only connection and staging-preview capabilities; no provisioning, operator/admin login, storage/service-role token or TEMP helper imports.
- `verify-runtime.mjs` — offline ignored-path/import/disabled-mode checks, with process and database creation guards.

The permanent connection helper uses the project's installed `pg` package and shared verified-TLS options. `identities.json` contains only approved project/host/port/database/site and restricted role metadata, not the old operator identity. The official CA is `database-ca.pem`, checked against fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. The exact allowlisted current-user DPAPI files are `production-web.dpapi`, `production-approver.dpapi`, `staging-web.dpapi`, `staging-approver.dpapi`, and `staging-preview.dpapi`. Production inputs came from the existing durable operator-secrets copies and were compared byte-for-byte with the known generated copies before copying. All five were copied as opaque encrypted bytes with exclusive creation, refusing an existing different destination. No credential was decrypted, printed or moved out of its existing source during persistence.

The staging settings' `previewCredentialFile` now points to permanent `staging-preview.dpapi`. Both settings' `opencode` paths now point to permanent **`.raad-local/newsroom-runtime/bin/opencode.exe`**. This is the exact official baseline executable, copied with its package metadata (`bin/package.json`), SHA-256 `cab0c9a8480f71fbb7cbc88ad91057712ecb500ab41fb9c01dd586cb9d8ea375`, version **1.19.3**. The source baseline package contained only that executable and package metadata; no additional package sidecars were present. Running the copied executable with `--version` succeeded without inference. Node.js, PowerShell, project dependencies and the existing authorized OpenCode user configuration remain ordinary host prerequisites; no `.env`, browser state or auth store was copied. These factories have not opened a database or run inference during this persistence work.

**Current hard block:** the owner-reported 429/quota failure prevents genuine LLM review. Do not run the following live command while that block remains. After quota is restored and the main agent finishes deployment/auth readiness and sets **only staging** `runtime.json` to `enabled:true`, run from `C:/Users/HDsupport1/Desktop/newsWeb`:

```text
node scripts/raad/watch-okaz-rss.mjs --directory "C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/okaz-rss-reader" --execute-reader
node scripts/raad/newsroom-run.mjs --adapter-module "C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/newsroom-runtime/staging-runtime.mjs" --execute-story
```

The first command refreshes genuine RSS notices when due; the second attempts one genuine selected story through authentic reviews and approval enqueue, writes its `run-*.receipt.json`, and stops immediately at blocked/unknown/escalation. A successful run must show `state:queued` and an actual `queueReceipt`. The existing approved worker then owns publication. The main agent must invoke/observe that **staging** worker and verify its exact job receipt, actual article status/timestamps, public preview SEO/canonical/NewsArticle/ALT and image bytes before calling the entire publication path verified. The command above deliberately does not invoke the production worker or mark queue success as publication success.

Current disabled-mode check returned `NEWSROOM_RUNTIME_NOT_ENABLED` before any connection/helper credential access. `git check-ignore` confirmed both runtime settings files are ignored. Production remains disabled until the main agent's operational readiness work; no OS task or deployment was installed here.

**Persistence verification:** `node .raad-local/newsroom-runtime/verify-runtime.mjs` passed: **16 paths ignored**, both disabled factories imported and returned `NEWSROOM_RUNTIME_NOT_ENABLED`, **0 DPAPI reads, 0 decryption/process attempts, 0 database-client creations**, and **0 TEMP runtime dependencies**. The checker also validates project identity metadata, the official CA and rejection of admin/operator/storage connection kinds before any credential access. No runtime mode was enabled. Windows DPAPI remains bound to the original Windows user: any future scheduled runtime must use that identity or receive an explicitly provisioned replacement, not copied plaintext.

Safe permanent verification commands (no LLM, decryption or database access):

```text
node .raad-local/newsroom-runtime/verify-runtime.mjs
"C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/newsroom-runtime/bin/opencode.exe" --version
```

Permanent disabled launcher checks:

```text
node scripts/raad/newsroom-run.mjs --adapter-module "C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/newsroom-runtime/staging-runtime.mjs" --execute-story
node scripts/raad/newsroom-run.mjs --adapter-module "C:/Users/HDsupport1/Desktop/newsWeb/.raad-local/newsroom-runtime/production-runtime.mjs" --execute-story
```

Both must return `NEWSROOM_RUNTIME_NOT_ENABLED` while settings remain disabled. These are disabled-mode checks, not permission to run reviews while the 429/quota block exists. For PowerShell, prefix the quoted executable path in the `--version` command with the call operator `&`. The older TEMP factories are superseded and are not dependencies of these permanent entry points; they were not deleted as part of this work.

## Durability, unknown outcomes and reconciliation

The store holds an exclusive `newsroom.lock` across the entire tick, fsyncs the lock, and writes fsynced exclusive sequential checkpoints with a SHA-256 chain. Directory fsync is attempted where supported (Windows may reject directory handles). A durable intent containing operation identity and the trusted expected task is saved **before** any inference, draft write, image upload or import. Completion is checkpointed only after results validate. Any thrown transport/adapter error is conservatively `unknown`; returned but invalid editorial results escalate. A surviving intent after interruption becomes `unknown`, with no re-dispatch. An abandoned lock is never stolen. A partial/corrupt checkpoint fails closed; no automatic repair or truncation.

There is intentionally no generic `retry`/`reset` API: inspect the recorded operation, journal task/results/proofs and external side effects before recovery. In particular, resolve an ambiguous import via `raad_queue.find_request` for the exact bound article/task/result/policy hashes and inspect its queue state/receipt; never create a second draft or rerun inference just because the parent timed out. Only a trusted operator can perform documented recovery after proving the old process is stopped and resolving the outcome. Recovery tooling remains a follow-up task; editing a checkpoint alone breaks the integrity chain.

Limits: 1000 retained story identities, 10000 checkpoints, 16MiB per checkpoint, plus existing journal limits. Checkpoints are full state snapshots, so storage grows with history and will need deliberate archival while retaining dedup identities. No automatic eviction. This is a single-host filesystem coordinator, not a production append-only audit system, distributed lease/fencing implementation, or OS sandbox. Filesystem administrators can rewrite local proofs; authentic reviewer metadata is obtained from the existing official CLI/export checks, not a new cryptographic signature.

## Verification and remaining operational work

Offline command:

```text
node --test scripts/raad/newsroom-coordinator.test.mjs
```

Tests exercise the stage sequence through the real approval validator/importer using only synthetic in-memory SQL responses, restart persistence, concurrent lock rejection, abandoned intent, source deduplication, required source fetch, risk escalation, forged proof rejection, failed claim verification, source-prefixed title rejection, two revision rounds, unknown commit outcome and checkpoint corruption. They do not invoke a model, network, database, media upload or publication.

Latest integration-gap verification: **all 36 newsroom tests passed, 0 failed, 0 skipped** (22 coordinator and 14 adapter tests), using:

```text
node --test scripts/raad/newsroom-adapter.test.mjs scripts/raad/newsroom-coordinator.test.mjs
```

The adjacent-gate regression command was:

```text
node --test scripts/raad/newsroom-*.test.mjs scripts/raad/evidence-binding.test.mjs scripts/raad/import-publication-approval.test.mjs scripts/raad/local-journal.test.mjs scripts/raad/rss-discovery.test.mjs scripts/raad/watch-okaz-rss.test.mjs
```

It reported **81 passed, 1 failed**: the unchanged local-journal junction fixture hit Windows `ENOTEMPTY` while creating its `snapshots` test junction. Inspection located the failure at fixture setup (`fs.symlinkSync`), before journal assertions. A separate diagnostic rerun of `node --test scripts/raad/local-journal.test.mjs` passed **14/14**, including that same junction case; the existing test file was not changed. The earlier pre-review run of 76 tests passed and remains historical, not the result of this regression invocation. `git diff --check` passed with existing LF/CRLF warnings in concurrently edited files.

The Windows card-generation test actually executed the existing generic PowerShell generator against JSON data in an isolated temporary fixture and passed PNG validation. All SQL and HTTP in these tests were offline fakes; no model, database, publisher upload or publication was invoked. An initial run hit a Windows temporary-directory cleanup race (`ENOTEMPTY`); bounded filesystem cleanup retry was added to test teardown, and the subsequent complete run passed. This is not an operational retry policy.

Remaining real blockers:

- Owner-reported 429/quota exhaustion is a hard blocker for genuine LLM reviews. No live review or quota retry was attempted for these fixes.
- The trusted adapters and protected connection wiring are now implemented; their actual database permissions, current categories and staged transaction behavior still need a live staging run.
- Deploy/validate the main agent's worker-authenticated media GET endpoint and the actual original-card upload/hash/readback integration. The adapter now uses GET for drafts; live behavior is not established by fake HTTP tests.
- Run a genuine staged source→research→separate verification→editing→media→approval→queue cycle, with actual CLI proofs and failure cases. Confirm source-access scope and escalation handling without treating RSS approval as permission to copy bodies/images.
- Validate the implemented live review clock and current worker/approval expiry settings in a real CLI run, plus process termination/unknown outcome reconciliation, monitoring and archival/recovery procedures. The media endpoint requires enabled worker configuration and the in-memory configured key to match the deployed server; no key or schedule was changed here.
- Establish the authorized single coordinator deployment/schedule, protected configuration, database source uniqueness semantics and durable host availability. Existing RSS and approved-publication schedules alone do not install this coordinator.
- Permanent helper, DPAPI, CA, identity metadata and CLI persistence is complete with no TEMP runtime dependencies; production remains disabled. Actual connection testing under the eventual scheduled Windows identity remains unperformed, and quota/staging/publication gates remain open.
- Verify publication separately via the existing worker receipt and public readback. `queued` is not `published`.
