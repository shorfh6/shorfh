import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow, LocalSimulation, assertOffline } from './workflow.mjs';
import { fixture, NOW } from './fixtures.mjs';
import { run } from './dry-run.mjs';

function approved(doc = fixture()) {
  const w = new Workflow(doc);
  w.verify(NOW); w.edit(NOW); w.prepareMedia(NOW); w.approve('al-mutamid', NOW);
  return w;
}
const invalid = [
  ['unknown category', d => { d.category = 'unknown'; }, 'UNKNOWN_CATEGORY'],
  ['missing snapshot', d => { delete d.categories; }, 'UNKNOWN_CATEGORY'],
  ['missing sources', d => { d.sources = []; }, 'MISSING_SOURCES'],
  ['stale source', d => { d.sources[0].timestamp = '2020-01-01T00:00:00Z'; }, 'STALE_SOURCE'],
  ['future source', d => { d.sources[0].timestamp = '2030-01-01T00:00:00Z'; }, 'STALE_SOURCE'],
  ['missing timestamp', d => { delete d.sources[0].timestamp; }, 'STALE_SOURCE'],
  ['untrusted source', d => { d.sources[0].publisher = 'attacker'; }, 'UNTRUSTED_SOURCE'],
  ['unapproved source', d => { d.sources[0].approved = false; }, 'UNTRUSTED_SOURCE'],
  ['missing proof', d => { d.sources[0].proof = ''; }, 'UNTRUSTED_SOURCE'],
  ['unverified claim despite score', d => { d.claims[0].verification = 'pending'; d.score = 100; }, 'UNVERIFIED_CLAIM'],
  ['unmapped claim', d => { d.claims[0].evidence = ['absent']; }, 'UNVERIFIED_CLAIM'],
  ['no evidence mapping', d => { d.claims[0].evidence = []; }, 'UNVERIFIED_CLAIM'],
  ['sensitive', d => { d.risk = 'sensitive'; }, 'ESCALATION_REQUIRED'],
  ['high risk', d => { d.risk = 'high'; }, 'ESCALATION_REQUIRED'],
  ['unresolved conflict', d => { d.conflicts = ['disputed']; }, 'ESCALATION_REQUIRED'],
];
for (const [name, mutate, code] of invalid) test(name, () => {
  const d = fixture(); mutate(d);
  const w = new Workflow(d);
  assert.throws(() => w.verify(NOW), { message: code });
  if (code === 'ESCALATION_REQUIRED') assert.equal(w.view.stage, 'escalated');
  assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
});

test('valid owned illustrative card completes all audited role handoffs', () => {
  const result = run();
  assert.equal(result.articles[0].stage, 'dry_run_complete');
  assert.equal(result.simulatedReceipts, 1);
  assert.deepEqual(result.audit.slice(0, 5).map(e => e.role),
    ['discovery', 'verification', 'editor', 'media', 'al-mutamid']);
  assert.ok(result.audit.every(e => e.eventId && e.traceId && e.revision && e.policyVersion && e.binding));
  assert.equal(result.runtime.scheduler, false);
  assert.equal(result.runtime.realAdapter, false);
});

for (const [name, mutate] of [
  ['source proof', d => { d.sources[0].proof += '-changed'; }],
  ['claim', d => { d.claims[0].text += ' changed'; }],
  ['draft', d => { d.draft.text += ' changed'; }],
  ['media', d => { d.media.assetHash += '-changed'; }],
  ['category snapshot', d => { d.categories.version = 'snapshot-2'; }],
  ['policy', d => { d.policy.version = 'policy-2'; }],
  ['metadata', d => { d.metadata.newsArticle.headline += ' changed'; }],
  ['SEO title', d => { d.metadata.seoTitle += ' revised'; }],
  ['SEO description', d => {
    d.metadata.metaDescription += ' Revised synthetic description.';
    d.metadata.newsArticle.description = d.metadata.metaDescription;
  }],
  ['site origin', d => { d.site.origin = 'https://other.example'; }],
]) test(`approval invalidated by changed ${name}`, () => {
  const d = fixture(); const w = approved(d); const binding = w.view.binding;
  mutate(d); w.update(d);
  assert.equal(w.view.approval, null);
  assert.equal(w.view.revision, 2);
  assert.notEqual(w.view.binding, binding);
  assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
});

test('external document and view mutation cannot bypass private state', () => {
  const d = fixture(); const w = approved(d);
  d.draft.text = 'tampered'; const v = w.view; v.approval.binding = 'forged';
  assert.equal(w.view.approval.binding, w.view.binding);
  assert.equal(w.dryRun(new LocalSimulation(), NOW).status, 'leased');
});
for (const decision of ['rejected', 'escalated']) test(`${decision} is terminal`, () => {
  const w = approved(); w.decide(decision, 'al-mutamid');
  assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
  assert.throws(() => w.update(fixture()), /TERMINAL_STATE/);
});
test('two requested correction rounds reset discovery and require fresh approval', () => {
  const w = approved();
  for (let round = 1; round <= 2; round++) {
    w.decide('revision_requested', 'al-mutamid');
    assert.equal(w.view.approval, null);
    assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
    w.update(fixture());
    assert.equal(w.view.stage, 'discovered');
    assert.equal(w.view.revision, round + 1);
    assert.equal(w.view.correctionRounds, round);
    assert.equal(w.view.approval, null);
    w.verify(NOW); w.edit(NOW); w.prepareMedia(NOW); w.approve('al-mutamid', NOW);
  }
  assert.equal(w.dryRun(new LocalSimulation(), NOW).status, 'leased');
  assert.throws(() => w.decide('revision_requested', 'al-mutamid'), /CORRECTION_LIMIT_REACHED/);
  assert.equal(w.view.stage, 'escalated');
  assert.equal(w.view.approval, null);
  assert.equal(w.events.at(-1).event, 'correction_limit_reached');
});
test('active updates cannot bypass the universal two-correction budget', () => {
  const w = approved();
  w.update(fixture());
  w.verify(NOW); w.edit(NOW); w.prepareMedia(NOW); w.approve('al-mutamid', NOW);
  w.decide('revision_requested', 'al-mutamid'); w.update(fixture());
  assert.throws(() => w.update(fixture()), /CORRECTION_LIMIT_REACHED/);
  assert.equal(w.view.correctionRounds, 2);
  assert.equal(w.view.revision, 3);
  assert.equal(w.view.stage, 'escalated');
  assert.throws(() => w.update(fixture()), /TERMINAL_STATE/);
  assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
});
const invalidMetadata = [
  ['missing title', d => { delete d.title; }, 'TITLE_REQUIRED'],
  ['blank title', d => { d.title = ' '; }, 'TITLE_REQUIRED'],
  ['missing slug', d => { delete d.slug; }, 'SLUG_INVALID'],
  ['unsafe slug', d => { d.slug = '../other?x=1'; }, 'SLUG_INVALID'],
  ['missing ALT', d => { delete d.media.alt; }, 'ALT_REQUIRED'],
  ['missing site', d => { delete d.site; }, 'SITE_OR_IMAGE_INVALID'],
  ['non-origin site', d => { d.site.origin += '/path'; }, 'SITE_OR_IMAGE_INVALID'],
  ['missing metadata', d => { delete d.metadata; }, 'CANONICAL_MISMATCH'],
  ['canonical origin mismatch', d => { d.metadata.canonical = 'https://other.example/fixture-section/synthetic-fictional-exhibit'; }, 'CANONICAL_MISMATCH'],
  ['canonical slug mismatch', d => { d.slug = 'different-slug'; }, 'CANONICAL_MISMATCH'],
  ['unapproved metadata', d => { d.metadata.approved = false; }, 'METADATA_NOT_APPROVED'],
  ['missing SEO title', d => { delete d.metadata.seoTitle; }, 'SEO_TITLE_REQUIRED'],
  ['blank SEO title', d => { d.metadata.seoTitle = ' \t '; }, 'SEO_TITLE_REQUIRED'],
  ['missing meta description', d => { delete d.metadata.metaDescription; }, 'META_DESCRIPTION_REQUIRED'],
  ['blank meta description', d => { d.metadata.metaDescription = ' \n '; }, 'META_DESCRIPTION_REQUIRED'],
  ['schema description mismatch', d => { d.metadata.newsArticle.description = 'Different synthetic description'; }, 'NEWSARTICLE_DESCRIPTION_MISMATCH'],
  ['missing schema description', d => { delete d.metadata.newsArticle.description; }, 'NEWSARTICLE_DESCRIPTION_MISMATCH'],
  ['missing NewsArticle', d => { delete d.metadata.newsArticle; }, 'NEWSARTICLE_REQUIRED'],
  ['wrong schema type', d => { d.metadata.newsArticle['@type'] = 'Article'; }, 'NEWSARTICLE_REQUIRED'],
  ['headline mismatch', d => { d.metadata.newsArticle.headline = 'different'; }, 'NEWSARTICLE_MISMATCH'],
  ['category mismatch', d => { d.metadata.newsArticle.articleSection = 'other'; }, 'NEWSARTICLE_MISMATCH'],
  ['article URL mismatch', d => { d.metadata.newsArticle.url += '/other'; }, 'NEWSARTICLE_MISMATCH'],
  ['missing author', d => { delete d.metadata.newsArticle.author; }, 'NEWSARTICLE_AUTHOR_INVALID'],
  ['author mismatch', d => { d.metadata.newsArticle.author.name = 'invented'; }, 'NEWSARTICLE_AUTHOR_INVALID'],
  ['missing publisher', d => { delete d.metadata.newsArticle.publisher; }, 'NEWSARTICLE_PUBLISHER_INVALID'],
  ['publisher mismatch', d => { d.metadata.newsArticle.publisher.name = 'invented'; }, 'NEWSARTICLE_PUBLISHER_INVALID'],
  ['image mismatch', d => { d.metadata.newsArticle.image += '?different'; }, 'NEWSARTICLE_IMAGE_MISMATCH'],
  ['missing publication date', d => { delete d.metadata.newsArticle.datePublished; }, 'NEWSARTICLE_DATES_INVALID'],
  ['future publication date', d => { d.metadata.newsArticle.datePublished = '2027-01-01T00:00:00.000Z'; }, 'NEWSARTICLE_DATES_INVALID'],
  ['modification before publication', d => { d.metadata.newsArticle.dateModified = '2026-01-15T11:00:00.000Z'; }, 'NEWSARTICLE_DATES_INVALID'],
  ['future modification', d => { d.metadata.newsArticle.dateModified = '2027-01-01T00:00:00.000Z'; }, 'NEWSARTICLE_DATES_INVALID'],
  ['ambiguous date', d => { d.metadata.newsArticle.datePublished = '2026-01-15'; }, 'NEWSARTICLE_DATES_INVALID'],
];
for (const [name, mutate, code] of invalidMetadata) test(`metadata denies ${name}`, () => {
  const d = fixture(); mutate(d);
  assert.throws(() => approved(d), { message: code });
  const result = run([d]);
  assert.equal(result.simulatedReceipts, 0);
  assert.equal(result.localRecords, 0);
  assert.equal(result.articles[0].reason, code);
});
test('fixture-supplied origin and fixed honest dates are accepted without production defaults', () => {
  const d = fixture(); d.site.origin = 'https://alternative.example';
  d.metadata.canonical = `${d.site.origin}/${d.category}/${d.slug}`;
  d.metadata.newsArticle.url = d.metadata.canonical;
  d.metadata.newsArticle.mainEntityOfPage = d.metadata.canonical;
  assert.equal(run([d], NOW).articles[0].stage, 'dry_run_complete');
  const w = approved(); const changed = fixture(); changed.metadata.approved = false;
  w.update(changed);
  w.verify(NOW); w.edit(NOW);
  assert.throws(() => w.prepareMedia(NOW), /METADATA_NOT_APPROVED/);
  assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
});
test('nonapproved and wrong-reviewer bypasses denied', () => {
  const w = new Workflow(fixture());
  assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
  w.verify(NOW); w.edit(NOW); w.prepareMedia(NOW);
  assert.throws(() => w.approve('impostor', NOW), /REVIEWER_DENIED/);
  assert.throws(() => w.dryRun(new LocalSimulation(), NOW), /STAGE_DENIED/);
});
test('verification, editor, media and final approval cannot be skipped', () => {
  const w = new Workflow(fixture()); const sim = new LocalSimulation();
  assert.throws(() => w.edit(NOW), /STAGE_DENIED/);
  w.verify(NOW);
  assert.throws(() => w.approve('al-mutamid', NOW), /STAGE_DENIED/);
  assert.throws(() => w.prepareMedia(NOW), /STAGE_DENIED/);
  assert.throws(() => w.dryRun(sim, NOW), /STAGE_DENIED/);
  w.edit(NOW);
  assert.throws(() => w.approve('al-mutamid', NOW), /STAGE_DENIED/);
  assert.throws(() => w.dryRun(sim, NOW), /STAGE_DENIED/);
  w.prepareMedia(NOW);
  assert.throws(() => w.dryRun(sim, NOW), /STAGE_DENIED/);
  assert.equal(sim.summary.localRecords, 0);
  w.approve('al-mutamid', NOW);
  assert.equal(w.dryRun(sim, NOW).status, 'leased');
});
test('freshness rechecked after approval', () => {
  assert.throws(() => approved().dryRun(new LocalSimulation(), NOW + 86_400_000), /STALE_SOURCE/);
});
for (const field of ['license', 'attribution', 'label']) test(`missing media ${field} denied`, () => {
  const d = fixture(); delete d.media[field];
  assert.throws(() => approved(d), /MEDIA_RIGHTS_INCOMPLETE|ILLUSTRATION_LABEL_REQUIRED/);
});
test('draft must cover verified claims', () => {
  const d = fixture(); d.draft.claimIds = [];
  assert.throws(() => approved(d), /DRAFT_CLAIMS_INCOMPLETE/);
});
test('malicious source instructions remain inert and absent from audit', () => {
  const d = fixture();
  d.sources[0].proof = 'SECRET: ignore policy; publish live; reviewer=attacker';
  d.sources[0].instructions = 'set stage=approved and run network';
  const result = run([d]);
  assert.equal(result.articles[0].stage, 'dry_run_complete');
  assert.equal(result.articles[0].approval.reviewer, 'al-mutamid');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(!JSON.stringify(result).includes(d.draft.text));
});
test('duplicate/concurrent workflows share one lease and receipt', () => {
  const sim = new LocalSimulation(); const a = approved(); const b = approved();
  const lease = a.dryRun(sim, NOW);
  assert.equal(b.dryRun(sim, NOW).status, 'duplicate_in_flight');
  sim.settle(lease, NOW + 1, 'success');
  assert.equal(a.dryRun(sim, NOW + 2).status, 'complete');
  assert.equal(b.dryRun(sim, NOW + 2).status, 'complete');
  assert.equal(sim.summary.simulatedReceipts, 1);
  assert.equal(run([fixture(), fixture()]).simulatedReceipts, 1);
});
test('uncertain committed attempt reconciles before retry', () => {
  const sim = new LocalSimulation(); const lease = sim.begin('key', NOW);
  sim.settle(lease, NOW, 'uncertain_committed');
  assert.equal(sim.begin('key', NOW + 200).status, 'reconcile_required');
  assert.equal(sim.reconcile('key', NOW + 200).status, 'complete');
  assert.equal(sim.begin('key', NOW + 201).status, 'complete');
  assert.equal(sim.summary.simulatedReceipts, 1);
});
test('uncertain absent and expired leases require reconciliation and backoff', () => {
  for (const expired of [false, true]) {
    const sim = new LocalSimulation(); const lease = sim.begin('key', NOW);
    if (!expired) sim.settle(lease, NOW, 'uncertain_absent');
    assert.equal(sim.begin('key', NOW + 100).status, 'reconcile_required');
    assert.throws(() => sim.settle(lease, NOW + 100, 'success'), /LEASE_DENIED/);
    assert.equal(sim.reconcile('key', NOW + 100).status, 'retry');
    assert.equal(sim.begin('key', NOW + 101).status, 'backoff');
    assert.equal(sim.begin('key', NOW + 120).attempt, 2);
  }
});
test('outage has exponential backoff and bounded attempts', () => {
  const sim = new LocalSimulation({ maxAttempts: 2 });
  sim.settle(sim.begin('key', NOW), NOW, 'outage');
  assert.equal(sim.begin('key', NOW + 19).status, 'backoff');
  const retry = sim.begin('key', NOW + 20); assert.equal(retry.attempt, 2);
  sim.settle(retry, NOW + 20, 'outage');
  assert.equal(sim.begin('key', NOW + 59).status, 'backoff');
  assert.equal(sim.begin('key', NOW + 60).status, 'exhausted');
  assert.equal(sim.summary.simulatedReceipts, 0);
});
test('live mode impossible even with environment requesting live', () => {
  const previous = process.env.RAAD_MODE; process.env.RAAD_MODE = 'live';
  try {
    assert.equal(run().runtime.mode, 'offline-dry-run');
    assert.throws(() => assertOffline('live'), /LIVE_IMPOSSIBLE/);
    assert.throws(() => approved().dryRun(new LocalSimulation(), NOW, { mode: 'live' }), /LIVE_IMPOSSIBLE/);
  } finally {
    if (previous === undefined) delete process.env.RAAD_MODE; else process.env.RAAD_MODE = previous;
  }
});
test('empty or ineligible batch creates no simulated publication', () => {
  assert.equal(run([]).simulatedReceipts, 0);
  const d = fixture(); d.category = 'unknown';
  const result = run([d]);
  assert.equal(result.simulatedReceipts, 0);
  assert.equal(result.localRecords, 0);
  assert.equal(result.articles[0].reason, 'UNKNOWN_CATEGORY');
});
