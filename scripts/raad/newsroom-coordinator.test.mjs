import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { contentHash } from './envelope.mjs';
import { openNewsroomStore } from './newsroom-store.mjs';
import { createNewsroomCoordinator } from './newsroom-coordinator.mjs';
import { main as runMain } from './newsroom-run.mjs';
import { assertEditorialClaimMap } from './newsroom-content.mjs';

const clock = '2026-10-29T14:00:00.000Z';
function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'raad-newsroom-offline-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const url = 'https://www.okaz.com.sa/local/na/2222222';
  const id = createHash('sha256').update('okaz\n' + url).digest('hex');
  const discoveryFile = path.join(directory, 'discovery.json');
  fs.writeFileSync(discoveryFile, JSON.stringify({ version: 1, items: { [id]: { id, url, title: 'SYNTHETIC NOT REAL NEWS', publishedAt: clock } } }));
  const policy = { id: 'offline-only', version: '1', hash: 'a'.repeat(64), freshnessSeconds: 86400 };
  const title = 'عنوان أصيل لاختبار غرفة الأخبار فقط';
  const excerpt = 'موجز اصطناعي لاختبار المسار المحلي ولا يمثل خبراً حقيقياً أو مادة جاهزة للنشر.';
  const body = 'محتوى اصطناعي للاختبار فقط. '.repeat(12) + url;
  const edited = { title, excerpt, body, seoTitle: title, metaDescription: excerpt, categoryId: 1, tagNames: [], claimMap: [{ claimId: 'c1' }, { claimId: 'c2' }] };
  const evidence = [{ id: 'e1', sourceId: 'okaz', excerpt: 'SYNTHETIC NOT REAL NEWS', location: 'offline fixture', context: 'offline fixture', attribution: 'offline fixture' }];
  const calls = [], sql = [];
  const review = async task => {
    calls.push(task);
    const result = { ...structuredClone(task), kind: 'result', status: 'completed', error: null };
    if (task.agent === 'al-muhaqqiq') {
      result.output = task.claims.length ? { report: 'OFFLINE ONLY', proposals: { claimVerdicts: task.claims.map(c => ({ claimId: c.id, status: 'verified', evidenceIds: ['e1'] })) } } :
        { report: 'OFFLINE ONLY', proposals: { risk: 'routine', facts: [1, 2].map(i => ({ id: `c${i}`, text: `Offline fact ${i}`, evidenceIds: ['e1'] })), evidence } };
      result.handoff = { stage: 'editing', agent: 'al-muharrir' };
    } else if (task.agent === 'al-muharrir') {
      result.output = { proposal: edited }; result.handoff = { stage: 'media', agent: 'al-musawwir' };
    } else if (task.agent === 'al-musawwir') {
      result.output = { proposal: { rightsStatus: 'confirmed', mediaManifest: [{ rightsStatus: 'confirmed', hash: { algorithm: 'sha256', value: 'b'.repeat(64) } }] } };
      result.handoff = { stage: 'approval', agent: 'al-mutamid' };
    } else {
      result.output = { report: 'OFFLINE ONLY', reviewedHash: task.hash.value };
      result.decision = { status: 'APPROVED', reviewer: 'al-mutamid', reviewedAt: clock, revisionId: task.revision.id, revisionHash: task.hash.value, reason: 'Offline fixture only', evidenceIds: ['e1'], issueIds: [] };
      result.handoff = { stage: 'publishing', agent: 'al-nashir' };
    }
    const run = { result, reviewProof: { actualAgent: task.agent, childSessionId: `ses_offline${calls.length}`, childFinalMatched: true, parentBindingVerified: true, taskBindingVerified: true, expectedTaskDigest: contentHash(task), fetchedUrls: [url] } };
    overrides.mutateReview?.(run, task);
    return run;
  };
  const adapters = {
    reserveDraft: async () => ({ articleId: 9001, categories: [{ id: 1, name: 'Offline' }] }),
    prepareMediaAndDraft: async ({ edited: e }) => ({
      publicationCandidate: { ...e, articleId: 9001, imageName: 'offline.png', imageLocalSha256: 'b'.repeat(64), categoryName: 'Offline', authorDisplayName: null, featured: false, exclusive: false, sourceUrl: url },
      publicationSnapshot: { version: 1, id: 9001, title: e.title, excerpt: e.excerpt, body: e.body, image: 'offline.png', category: { id: 1, name: 'Offline' }, author: null, tags: [], sourceUrl: url, featured: false, exclusive: false, createdAt: clock },
      originalMediaProof: { synthetic: true, generator: 'offline-test-only' },
    }),
    preflight: async ({ prepared }) => ({ sourceUnique: true, snapshotHash: contentHash(prepared.publicationSnapshot), imageSha256: 'b'.repeat(64) }),
    withApprover: async callback => callback({ query: async query => {
      sql.push(query);
      if (query.includes('find_request')) return { rows: [{ work: null }] };
      if (query.includes('record_approval')) return { rows: [{ id: 'offline-approval' }] };
      if (query.includes('enqueue')) return { rows: [{ work: { id: 'offline-job', state: 'pending' } }] };
      return { rows: [] };
    } }),
    ...overrides.adapters,
  };
  const config = { directory, discoveryFile, policy, adapters, cli: { opencode: path.join(directory, 'never-executed.exe') }, review, execute: true, now: () => clock };
  const tick = () => createNewsroomCoordinator(config).tick();
  const state = () => { const store = openNewsroomStore(directory); try { return store.state.stories[id]; } finally { store.close(); } };
  return { directory, config, tick, state, id, calls, sql };
}

test('offline complete stage cycle survives reopening and invokes authentic packet gate and atomic importer', async t => {
  const f = fixture(t);
  const stages = [];
  for (let i = 0; i < 9; i++) stages.push((await f.tick()).state);
  assert.deepEqual(stages, ['research', 'verification', 'editing', 'prepare', 'media', 'preflight', 'approval', 'import', 'queued']);
  assert.equal(f.calls.length, 5);
  assert.equal(f.sql.filter(s => s.includes('enqueue')).length, 1);
  assert.equal(f.sql.at(-1), 'COMMIT');
  assert.equal((await f.tick()).state, 'idle');
  assert.equal(f.state().queueReceipt.jobId, 'offline-job');
});

test('exclusive lock prevents concurrent ticks and is never stolen', async t => {
  let release;
  const f = fixture(t, { adapters: { reserveDraft: () => new Promise(resolve => { release = resolve; }) } });
  const running = f.tick();
  await assert.rejects(f.tick(), { code: 'EEXIST' });
  release({ duplicate: true }); await running;
  fs.writeFileSync(path.join(f.directory, 'newsroom.lock'), 'abandoned');
  await assert.rejects(f.tick(), { code: 'EEXIST' });
});

test('unknown draft write outcome is durable and never retried', async t => {
  let attempts = 0;
  const f = fixture(t, { adapters: { reserveDraft: async () => { attempts++; throw Error('TRANSPORT_LOST'); } } });
  assert.equal((await f.tick()).state, 'unknown');
  assert.equal((await f.tick()).state, 'idle');
  assert.equal(attempts, 1); assert.equal(f.state().intent.stage, 'reserve');
});

test('persisted intent from interrupted process becomes unknown without dispatch', async t => {
  const f = fixture(t); await f.tick();
  const store = openNewsroomStore(f.directory);
  store.state.stories[f.id].intent = { stage: 'research', operationId: 'offline-crash' };
  store.save(store.state); store.close();
  assert.equal((await f.tick()).state, 'unknown'); assert.equal(f.calls.length, 0);
});

test('database source duplicate stops before research', async t => {
  const f = fixture(t, { adapters: { reserveDraft: async () => ({ duplicate: true }) } });
  assert.equal((await f.tick()).state, 'duplicate');
  assert.equal((await f.tick()).state, 'idle'); assert.equal(f.calls.length, 0);
});

test('research requires actual observed selected URL fetch and routine risk', async t => {
  for (const mutateReview of [run => { run.reviewProof.fetchedUrls = []; }, run => { run.result.output.proposals.risk = 'sensitive'; }]) {
    const f = fixture(t, { mutateReview }); await f.tick();
    assert.equal((await f.tick()).state, 'escalated'); assert.equal(f.sql.length, 0);
  }
});

test('forged review proof fails closed before any downstream operation', async t => {
  const f = fixture(t, { mutateReview: run => { run.reviewProof.expectedTaskDigest = '0'.repeat(64); } });
  await f.tick(); assert.equal((await f.tick()).state, 'unknown');
  assert.equal((await f.tick()).state, 'idle'); assert.equal(f.sql.length, 0);
});

test('unsupported adopted fact cannot pass separate verification', async t => {
  const f = fixture(t, { mutateReview: (run, task) => { if (task.claims.length && task.agent === 'al-muhaqqiq') run.result.output.proposals.claimVerdicts[0].status = 'unsupported'; } });
  await f.tick(); await f.tick(); assert.equal((await f.tick()).state, 'escalated');
});

test('source-prefixed headline is rejected', async t => {
  const f = fixture(t, { mutateReview: (run, task) => { if (task.agent === 'al-muharrir') run.result.output.proposal.title = run.result.output.proposal.seoTitle = 'بحسب عكاظ عنوان اصطناعي غير مقبول'; } });
  for (let i = 0; i < 3; i++) await f.tick();
  assert.equal((await f.tick()).state, 'escalated');
});

test('review revision rounds are durable and bounded at two', async t => {
  const f = fixture(t, { mutateReview: (run, task) => {
    if (task.agent === 'al-mutamid') {
      const limit = task.revision.revisionRounds === 2;
      run.result.decision.status = limit ? 'ESCALATE' : 'REVISION_REQUIRED';
      run.result.handoff = limit ? null : { stage: 'editing', agent: 'al-muharrir' };
    }
  } });
  let result;
  for (let i = 0; i < 18; i++) result = await f.tick();
  assert.equal(result.state, 'escalated'); assert.equal(f.state().rounds, 2);
  assert.equal(f.sql.length, 0);
});

test('commit outcome unknown never triggers a blind import retry', async t => {
  let commits = 0;
  const f = fixture(t, { adapters: { withApprover: async callback => callback({ query: async query => {
    if (query === 'COMMIT') { commits++; throw Error('lost connection'); }
    if (query.includes('find_request')) return { rows: [{ work: { id: 'existing', approvalId: 'approved', state: 'pending' } }] };
    return { rows: [] };
  } }) } });
  for (let i = 0; i < 9; i++) await f.tick();
  assert.equal(f.state().stage, 'unknown'); assert.equal(f.state().failure.code, 'APPROVAL_IMPORT_OUTCOME_UNKNOWN');
  await f.tick(); assert.equal(commits, 1);
});

test('checkpoint corruption fails closed before external work', async t => {
  const f = fixture(t); await f.tick();
  fs.appendFileSync(path.join(f.directory, 'checkpoint-000003.json'), 'broken');
  await assert.rejects(f.tick()); assert.equal(f.calls.length, 0);
});

test('media/draft adapter cannot silently change adopted wording', async t => {
  const f = fixture(t);
  const original = f.config.adapters.prepareMediaAndDraft;
  f.config.adapters.prepareMediaAndDraft = async args => {
    const p = await original(args); p.publicationCandidate.body += ' Extra unreviewed fact'; return p;
  };
  for (let i = 0; i < 5; i++) await f.tick();
  assert.equal(f.state().stage, 'escalated');
  assert.equal(f.state().failure.code, 'NEWSROOM_EDITED_CONTENT_CHANGED');
  assert.equal(f.sql.length, 0);
});

test('preflight rejects changed snapshot or image before final approval', async t => {
  for (const key of ['snapshotHash', 'imageSha256']) {
    const f = fixture(t);
    const original = f.config.adapters.preflight;
    f.config.adapters.preflight = async args => ({ ...await original(args), [key]: '0'.repeat(64) });
    for (let i = 0; i < 7; i++) await f.tick();
    assert.equal(f.state().stage, 'escalated');
    assert.equal(f.calls.some(task => task.agent === 'al-mutamid'), false);
  }
});

test('changed policy and elapsed freshness cannot reuse prior reviews', async t => {
  const f = fixture(t); await f.tick();
  f.config.policy = { ...f.config.policy, hash: 'c'.repeat(64) };
  await assert.rejects(f.tick(), /NEWSROOM_POLICY_CHANGED/);
  assert.equal(f.calls.length, 0);
  f.config.policy.hash = 'a'.repeat(64);
  f.config.now = () => '2026-10-31T14:00:00Z';
  assert.equal((await f.tick()).state, 'escalated');
  assert.equal(f.calls.length, 0);
});

test('launcher requires explicit execution and absolute module path', async () => {
  await assert.rejects(runMain([]), /NEWSROOM_EXPLICIT_ARGUMENTS_REQUIRED/);
  await assert.rejects(runMain(['--adapter-module', 'relative.mjs', '--execute-one-stage']), /NEWSROOM_EXPLICIT_ARGUMENTS_REQUIRED/);
});

test('one bounded story invocation holds its lock across all stages and records a queue receipt', async t => {
  const f = fixture(t);
  const originalReview = f.config.review;
  f.config.review = async (...args) => {
    await assert.rejects(createNewsroomCoordinator(f.config).tick(), { code: 'EEXIST' });
    return originalReview(...args);
  };
  const receipt = await createNewsroomCoordinator(f.config).runStory();
  assert.equal(receipt.state, 'queued'); assert.equal(receipt.stages.length, 9);
  assert.equal(receipt.queueReceipt.jobId, 'offline-job'); assert.equal(receipt.publicationVerified, false);
  assert.equal(fs.readdirSync(f.directory).filter(name => name.endsWith('.receipt.json')).length, 1);
});

test('bounded invocation stops immediately on unknown side effects', async t => {
  let attempts = 0;
  const f = fixture(t, { adapters: { reserveDraft: async () => { attempts++; throw Error('CONNECTION_LOST'); } } });
  const result = await createNewsroomCoordinator(f.config).runStory();
  assert.equal(result.state, 'unknown'); assert.equal(result.stages.length, 1); assert.equal(attempts, 1);
});

test('staging identity is propagated through research, evidence binding and final approval', async t => {
  const site = 'https://shorfh-raad-staging.onrender.com';
  const f = fixture(t, { adapters: { reserveDraft: async () => ({ articleId: 9001, site, categories: [{ id: 1, name: 'Offline' }] }) } });
  const receipt = await createNewsroomCoordinator(f.config).runStory();
  assert.equal(receipt.state, 'queued');
  for (const task of f.calls) {
    assert.equal(task.input.site, site);
    if (task.input.editorialEvidence) assert.equal(task.input.editorialEvidence.site, site);
  }
});

test('actual editor paragraph claimIds maps pass the complete bound review/import cycle', async t => {
  const f = fixture(t, { mutateReview: (run, task) => {
    if (task.agent === 'al-muharrir') run.result.output.proposal.claimMap = [
      { section: 'المقدمة', paragraph: 1, claimIds: ['c1', 'c2'], evidenceIds: ['e1'] },
    ];
  } });
  assert.equal((await createNewsroomCoordinator(f.config).runStory()).state, 'queued');
  assert.equal(f.state().edited.claimMap[0].claimIds.length, 2);
});

test('claim-map validation rejects unknown claims/evidence, ambiguous shapes, duplicates and uncovered facts', () => {
  const facts = { facts: [{ id: 'c1', evidenceIds: ['e1'] }, { id: 'c2', evidenceIds: ['e2'] }], evidence: [{ id: 'e1' }, { id: 'e2' }, { id: 'unused' }] };
  assert.equal(assertEditorialClaimMap([{ claimId: 'c1' }, { claimId: 'c2', evidenceIds: ['e2'] }], facts), true);
  assert.equal(assertEditorialClaimMap([{ section: 'المتن', paragraph: 'النص المعتمد', claimIds: ['c1', 'c2'], evidenceIds: ['e1', 'e2'] }], facts), true);
  const badMaps = [
    [{ claimIds: ['c1', 'unknown'] }], [{ claimId: 'unknown' }], [{ claimId: 'c1' }],
    [{ claimId: 'c1', claimIds: ['c1', 'c2'] }], [{ claimIds: [] }],
    [{ claimIds: ['c1', 'c1', 'c2'] }], [{ claimIds: ['c1', 'c2'], evidenceIds: ['unknown'] }],
    [{ claimIds: ['c1', 'c2'], evidenceIds: ['e1'] }], [{ claimIds: ['c1', 'c2'], evidenceIds: ['e1', 'e2', 'unused'] }],
    [{ claimIds: ['c1', 'c2'], evidenceIds: [] }], [{ claimIds: ['c1', 'c2'], paragraph: {} }], [null],
  ];
  for (const map of badMaps) assert.throws(() => assertEditorialClaimMap(map, facts), /NEWSROOM_CLAIM_/);
});

test('editor claimIds with unknown IDs stop before media preparation or approval import', async t => {
  const f = fixture(t, { mutateReview: (run, task) => {
    if (task.agent === 'al-muharrir') run.result.output.proposal.claimMap = [{ section: 'المتن', paragraph: 1, claimIds: ['c1', 'c2', 'invented'], evidenceIds: ['e1'] }];
  } });
  const result = await createNewsroomCoordinator(f.config).runStory();
  assert.equal(result.state, 'escalated'); assert.equal(f.state().failure.code, 'NEWSROOM_CLAIM_MAP_IDS');
  assert.equal(f.calls.some(task => task.agent === 'al-musawwir'), false); assert.equal(f.sql.length, 0);
});
