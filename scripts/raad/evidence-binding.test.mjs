import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, contentHash, validateTask, validateResult } from './envelope.mjs';
import { evidenceDigest, assertVerifiedEvidenceContinuation } from './evidence-binding.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const publishedAt = '2026-10-25T08:00:00Z';
const retrievedAt = '2026-10-25T09:00:00Z';
const sourceUrl = 'https://news.example/synthetic-observatory';

function verificationTask() {
  return createTask({ taskId: 'synthetic-verification', traceId: 'synthetic-story', agent: 'al-muhaqqiq',
    revision: { id: 'synthetic-r1', parentId: null, number: 1, revisionRounds: 0 },
    policy: { id: 'synthetic-policy', version: '1', hash: contentHash('synthetic-policy'), freshnessSeconds: 86400 },
    input: { synthetic: true, articleId: 'synthetic-article', site: 'https://site.example',
      editorialEvidence: {
        sourceUrls: [sourceUrl], publicationDates: [publishedAt],
        facts: [{ id: 'f1', text: 'Synthetic observatory opened.', claimId: 'c1', evidenceIds: ['e1'],
          sourceUrl, publishedAt, retrievedAt }],
        evidence: [{ id: 'e1', sourceUrl, publishedAt, retrievedAt, excerpt: 'Synthetic observatory opened.',
          location: 'paragraph 1', context: 'Synthetic announcement', attribution: 'Synthetic source' }],
        sourceRelationship: 'Single synthetic primary announcement',
      }, proposedBody: 'Synthetic research draft.', reviewHistory: [] },
    sources: [{ id: 's1', url: sourceUrl, publishedAt, retrievedAt, contentHash: contentHash('synthetic saved excerpt') }],
    claims: [
      { id: 'c1', text: 'Synthetic observatory opened.', status: 'pending', confidence: 'Awaiting review' },
      { id: 'c2', text: 'Synthetic opening was announced today.', status: 'pending', confidence: 'Awaiting review' },
    ],
    evidence: [
      { id: 'e1', sourceId: 's1', excerpt: 'Synthetic observatory opened.', location: 'paragraph 1',
        context: 'Synthetic announcement', attribution: 'Synthetic source', publishedAt, retrievedAt },
      { id: 'e2', sourceId: 's1', excerpt: 'Synthetic opening announced today.', location: 'paragraph 2',
        context: 'Synthetic announcement date', attribution: 'Synthetic source', publishedAt, retrievedAt },
    ],
    references: [{ claimId: 'c1', evidenceIds: ['e1'] }, { claimId: 'c2', evidenceIds: ['e2'] }],
  });
}

// Rebuild through the public constructor so rejection cannot be caused by stale hashes.
function recreate(task, mutate = () => {}) {
  const options = Object.fromEntries(['taskId', 'traceId', 'agent', 'revision', 'policy', 'input',
    'sources', 'claims', 'evidence', 'references', 'issues'].map(key => [key, copy(task[key])]));
  mutate(options);
  return createTask(options);
}

function verifiedResult(task) {
  return { ...copy(task), kind: 'result', status: 'completed',
    output: { report: 'Synthetic claims verified against supplied references.',
      proposals: { claimVerdicts: task.references.map(ref => ({ ...copy(ref), status: 'verified' })) } },
    handoff: { stage: 'editing', agent: 'al-muharrir' } };
}

function editorTask(task, mutate = () => {}) {
  return recreate(task, options => {
    options.taskId = 'synthetic-editing';
    options.agent = 'al-muharrir';
    options.revision = { id: 'synthetic-r2', parentId: task.revision.id, number: 2, revisionRounds: 0 };
    options.policy.hash = contentHash('synthetic-policy-with-owner-permission-note');
    options.claims.forEach(claim => { claim.status = 'verified'; claim.confidence = 'Supported by supplied evidence'; });
    options.input.reviewHistory = [{ agent: task.agent, taskId: task.taskId, taskHash: task.hash.value }];
    options.input.ownerPermission = { scope: 'synthetic editorial review only' };
    options.input.proposedBody = 'Original synthetic editorial wording of the same facts.';
    mutate(options);
  });
}

test('verified evidence continues to editor revision 2 despite a new package hash and lineage', () => {
  const prior = verificationTask(), result = verifiedResult(prior), next = editorTask(prior);
  const snapshot = copy({ prior, result, next });
  assert.equal(validateResult(result, prior), true);
  assert.equal(next.traceId, prior.traceId);
  assert.equal(next.agent, 'al-muharrir');
  assert.equal(next.revision.number, 2);
  assert.notEqual(next.hash.value, prior.hash.value);
  const binding = assertVerifiedEvidenceContinuation(prior, result, next);
  assert.equal(binding.digest, evidenceDigest(prior));
  assert.equal(binding.verificationTaskHash, prior.hash.value);
  assert.equal(binding.nextTaskHash, next.hash.value);
  assert.equal(binding.finalPublicationApprovalTransferred, false);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(next.approval, null);
  assert.equal(result.decision, null);
  assert.deepEqual({ prior, result, next }, snapshot);
});

test('evidence digest canonicalizes object keys without requiring identical serialization', () => {
  const prior = verificationTask();
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value;
  const next = createTask(reverseKeys(Object.fromEntries(['taskId', 'traceId', 'agent', 'revision', 'policy',
    'input', 'sources', 'claims', 'evidence', 'references', 'issues'].map(key => [key, prior[key]]))));
  assert.notEqual(JSON.stringify(prior.input), JSON.stringify(next.input));
  assert.equal(evidenceDigest(next), evidenceDigest(prior));
  assert.equal(assertVerifiedEvidenceContinuation(prior, verifiedResult(prior), next).finalPublicationApprovalTransferred, false);
});

test('every factual, source, timestamp, reference, identity and freshness change requires reverification', () => {
  const prior = verificationTask(), result = verifiedResult(prior);
  const changes = [
    ['fact', t => { t.input.editorialEvidence.facts[0].text = 'Synthetic observatory closed.'; }],
    ['excerpt package', t => { t.input.editorialEvidence.evidence[0].excerpt = 'Different excerpt'; }],
    ['source URL list', t => { t.input.editorialEvidence.sourceUrls[0] += '/changed'; }],
    ['publication dates', t => { t.input.editorialEvidence.publicationDates[0] = retrievedAt; }],
    ['source relationship', t => { t.input.editorialEvidence.sourceRelationship = 'Independent secondary account'; }],
    ['source URL', t => { t.sources[0].url += '/changed'; }],
    ['source retrieval time', t => { t.sources[0].retrievedAt = '2026-10-25T10:00:00Z'; }],
    ['saved source hash', t => { t.sources[0].contentHash = contentHash('different saved excerpt'); }],
    ['claim text', t => { t.claims[0].text = 'Synthetic observatory closed.'; }],
    ['claim identity', t => { t.claims[0].id = 'c3'; t.references[0].claimId = 'c3'; }],
    ['evidence excerpt', t => { t.evidence[0].excerpt = 'Different evidence'; }],
    ['evidence date', t => { t.evidence[0].publishedAt = retrievedAt; }],
    ['reference', t => { t.references[0].evidenceIds = ['e2']; }],
    ['freshness', t => { t.policy.freshnessSeconds = 43200; }],
    ['article identity', t => { t.input.articleId = 'different-article'; }],
    ['site identity', t => { t.input.site = 'https://different.example'; }],
  ];
  for (const [name, mutate] of changes) {
    const next = editorTask(prior, mutate);
    assert.equal(validateTask(next), true, name);
    assert.notEqual(next.hash.value, prior.hash.value, name);
    assert.notEqual(evidenceDigest(next), evidenceDigest(prior), name);
    assert.throws(() => assertVerifiedEvidenceContinuation(prior, result, next), { message: 'FACTS_CHANGED_REVERIFY' }, name);
  }
});

test('a self-consistent result for another task cannot replace the actual prior result', () => {
  const prior = verificationTask(), next = editorTask(prior);
  const forgedTask = recreate(prior, t => { t.input.editorialEvidence.facts[0].text = 'Replacement fact'; });
  const forgedResult = verifiedResult(forgedTask);
  assert.equal(validateResult(forgedResult, forgedTask), true);
  assert.throws(() => assertVerifiedEvidenceContinuation(prior, forgedResult, next), { message: 'CONTEXT_MISMATCH' });
  const wrongIdentity = verifiedResult(prior);
  wrongIdentity.taskId = 'another-verification';
  assert.throws(() => assertVerifiedEvidenceContinuation(prior, wrongIdentity, next), { message: 'CONTEXT_MISMATCH' });
});

test('a completed report from another agent is not fact verification', () => {
  const prior = recreate(verificationTask(), t => { t.agent = 'al-haris'; });
  const result = { ...verifiedResult(prior), handoff: null };
  assert.equal(validateResult(result, prior), true);
  assert.throws(() => assertVerifiedEvidenceContinuation(prior, result, editorTask(prior)), { message: 'VERIFICATION_REQUIRED' });
});

test('a valid blocked verifier result cannot continue', () => {
  const prior = verificationTask();
  const result = { ...copy(prior), kind: 'result', status: 'blocked', output: { reason: 'Synthetic evidence insufficient.' } };
  assert.equal(validateResult(result, prior), true);
  assert.throws(() => assertVerifiedEvidenceContinuation(prior, result, editorTask(prior)), { message: 'VERIFICATION_REQUIRED' });
});

test('all claims need unique verified verdicts with nonempty matching evidence references', () => {
  const prior = verificationTask(), next = editorTask(prior);
  const changes = [
    ['missing proposals', r => { delete r.output.proposals; }],
    ['missing verdicts', r => { r.output.proposals = { note: 'No verdicts' }; }],
    ['omitted claim', r => { r.output.proposals.claimVerdicts.pop(); }],
    ['duplicate claim', r => { r.output.proposals.claimVerdicts[1] = copy(r.output.proposals.claimVerdicts[0]); }],
    ['unverified claim', r => { r.output.proposals.claimVerdicts[1].status = 'pending'; }],
    ['unknown claim', r => { r.output.proposals.claimVerdicts[1].claimId = 'unknown-claim'; }],
    ['missing evidence', r => { delete r.output.proposals.claimVerdicts[0].evidenceIds; }],
    ['empty evidence', r => { r.output.proposals.claimVerdicts[0].evidenceIds = []; }],
    ['other claim evidence', r => { r.output.proposals.claimVerdicts[0].evidenceIds = ['e2']; }],
    ['mixed valid and unknown evidence', r => { r.output.proposals.claimVerdicts[0].evidenceIds.push('unknown-evidence'); }],
  ];
  for (const [name, mutate] of changes) {
    const result = verifiedResult(prior);
    mutate(result);
    assert.equal(validateResult(result, prior), true, name);
    assert.throws(() => assertVerifiedEvidenceContinuation(prior, result, next), { message: 'CLAIM_VERIFICATION_REQUIRED' }, name);
  }
});

test('identical evidence in a different trace cannot inherit verification', () => {
  const prior = verificationTask(), next = editorTask(prior, t => { t.traceId = 'different-story-trace'; });
  assert.equal(evidenceDigest(next), evidenceDigest(prior));
  assert.throws(() => assertVerifiedEvidenceContinuation(prior, verifiedResult(prior), next), { message: 'VERIFICATION_REQUIRED' });
});

test('al-mutamid APPROVED cannot be substituted for factual verification', () => {
  const prior = recreate(verificationTask(), t => { t.agent = 'al-mutamid'; });
  const result = { ...copy(prior), kind: 'result', status: 'completed',
    output: { report: 'Synthetic approval only.', reviewedHash: prior.hash.value },
    decision: { status: 'APPROVED', reviewer: 'al-mutamid', reviewedAt: retrievedAt,
      revisionId: prior.revision.id, revisionHash: prior.hash.value, reason: 'Synthetic structural approval.',
      evidenceIds: ['e1', 'e2'], issueIds: [] },
    handoff: { stage: 'publishing', agent: 'al-nashir' } };
  assert.equal(validateResult(result, prior), true);
  assert.throws(() => assertVerifiedEvidenceContinuation(prior, result, editorTask(prior)), { message: 'VERIFICATION_REQUIRED' });
});
