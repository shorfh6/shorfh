import { createHash } from 'node:crypto';

// Offline role contracts, not LLM agents. No adapters, timers, environment or I/O.
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const requireThat = (condition, code) => { if (!condition) throw new Error(code); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const active = ['discovered', 'verified', 'edited', 'media_ready', 'approved'];
export const readiness = Object.freeze({ mode: 'offline-dry-run', scheduler: false,
  realAdapter: false, network: false, database: false, llmInteraction: false });
export function assertOffline(mode = 'offline-dry-run') {
  requireThat(mode === readiness.mode, 'LIVE_IMPOSSIBLE');
  return readiness;
}

function editorialGate(doc, now) {
  const { policy, categories, sources, claims } = doc;
  requireThat(doc.synthetic === 'SYNTHETIC NOT REAL NEWS', 'SYNTHETIC_REQUIRED');
  requireThat(text(doc.storyKey) && text(policy?.version), 'INVALID_CONTRACT');
  requireThat(Number.isFinite(now) && Number.isFinite(policy.maxAgeMs) && policy.maxAgeMs > 0, 'INVALID_CLOCK_POLICY');
  requireThat(text(categories?.version) && Array.isArray(categories.allowed) &&
    categories.allowed.includes(doc.category), 'UNKNOWN_CATEGORY');
  requireThat(Array.isArray(policy.trustedSources) && Array.isArray(sources) && sources.length > 0, 'MISSING_SOURCES');
  requireThat(Array.isArray(claims) && claims.length > 0, 'MISSING_CLAIMS');
  requireThat(['ordinary', 'sensitive', 'high'].includes(doc.risk) && Array.isArray(doc.conflicts), 'INVALID_RISK');
  requireThat(doc.risk === 'ordinary' && doc.conflicts.length === 0, 'ESCALATION_REQUIRED');
  const ids = new Set();
  for (const source of sources) {
    requireThat(text(source.id) && !ids.has(source.id), 'SOURCE_ID_INVALID');
    ids.add(source.id);
    requireThat(source.approved === true && policy.trustedSources.includes(source.publisher) && text(source.proof), 'UNTRUSTED_SOURCE');
    const timestamp = Date.parse(source.timestamp);
    requireThat(Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= policy.maxAgeMs, 'STALE_SOURCE');
  }
  const claimIds = new Set();
  for (const claim of claims) {
    requireThat(text(claim.id) && !claimIds.has(claim.id) && text(claim.text), 'CLAIM_ID_INVALID');
    claimIds.add(claim.id);
    requireThat(claim.verification === 'verified' && Array.isArray(claim.evidence) &&
      claim.evidence.length > 0 && claim.evidence.every(id => ids.has(id)), 'UNVERIFIED_CLAIM');
  }
}
function draftGate(doc) {
  requireThat(text(doc.draft?.text) && Array.isArray(doc.draft.claimIds) &&
    doc.draft.claimIds.length === doc.claims.length &&
    new Set(doc.draft.claimIds).size === doc.claims.length &&
    doc.claims.every(c => doc.draft.claimIds.includes(c.id)), 'DRAFT_CLAIMS_INCOMPLETE');
}
function mediaGate(doc) {
  const m = doc.media;
  requireThat(m && text(m.assetHash) && text(m.license) && text(m.attribution) &&
    m.rightsApproved === true && ['owned', 'licensed'].includes(m.ownership), 'MEDIA_RIGHTS_INCOMPLETE');
  requireThat(['photograph', 'illustrative'].includes(m.kind), 'MEDIA_KIND_INVALID');
  requireThat(m.kind !== 'illustrative' || m.label === 'Illustrative — not a documentary photograph', 'ILLUSTRATION_LABEL_REQUIRED');
}
function metadataGate(doc, now) {
  requireThat(text(doc.title), 'TITLE_REQUIRED');
  requireThat(typeof doc.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.slug), 'SLUG_INVALID');
  requireThat(text(doc.media?.alt), 'ALT_REQUIRED');
  const site = doc.site; const meta = doc.metadata;
  let origin; let image;
  try { origin = new URL(site?.origin); image = new URL(doc.media?.url); }
  catch { throw new Error('SITE_OR_IMAGE_INVALID'); }
  requireThat(origin.protocol === 'https:' && origin.origin === site.origin &&
    !origin.username && !origin.password && image.protocol === 'https:' &&
    !image.username && !image.password, 'SITE_OR_IMAGE_INVALID');
  const canonicalUrl = `${site.origin}/${doc.category}/${doc.slug}`;
  requireThat(meta?.canonical === canonicalUrl, 'CANONICAL_MISMATCH');
  requireThat(meta.approved === true, 'METADATA_NOT_APPROVED');
  // Structural SEO checks only; originality, truth and semantic quality need editorial review.
  requireThat(text(meta.seoTitle), 'SEO_TITLE_REQUIRED');
  requireThat(text(meta.metaDescription), 'META_DESCRIPTION_REQUIRED');
  const news = meta.newsArticle;
  requireThat(news?.['@context'] === 'https://schema.org' && news['@type'] === 'NewsArticle', 'NEWSARTICLE_REQUIRED');
  requireThat(news.description === meta.metaDescription, 'NEWSARTICLE_DESCRIPTION_MISMATCH');
  requireThat(news.headline === doc.title && news.articleSection === doc.category &&
    news.url === canonicalUrl && news.mainEntityOfPage === canonicalUrl, 'NEWSARTICLE_MISMATCH');
  requireThat(text(site.author) && news.author?.['@type'] === 'Person' &&
    news.author.name === site.author, 'NEWSARTICLE_AUTHOR_INVALID');
  requireThat(text(site.publisher) && news.publisher?.['@type'] === 'Organization' &&
    news.publisher.name === site.publisher, 'NEWSARTICLE_PUBLISHER_INVALID');
  requireThat(news.image === doc.media.url, 'NEWSARTICLE_IMAGE_MISMATCH');
  // Require unambiguous UTC instants; dates describe synthetic fixture history only.
  const instant = value => {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
  };
  const published = instant(news.datePublished); const modified = instant(news.dateModified);
  requireThat(Number.isFinite(published) && Number.isFinite(modified) &&
    published <= now && modified >= published && modified <= now, 'NEWSARTICLE_DATES_INVALID');
}

export class Workflow {
  #doc; #stage = 'discovered'; #revision = 1; #correctionRounds = 0; #approval; #events = []; #trace;
  constructor(doc, trace = 'offline-contract') {
    // Trace is hashed so caller-supplied text never enters the audit trail.
    this.#doc = copy(doc); this.#trace = hash(trace);
    this.#audit('discovered', 'discovery');
  }
  get view() { return copy({ stage: this.#stage, revision: this.#revision,
    correctionRounds: this.#correctionRounds, binding: this.#binding(), approval: this.#approval ?? null }); }
  get events() { return copy(this.#events); }
  #binding() { return hash({ contract: 1, revision: this.#revision, article: this.#doc }); }
  #audit(event, role) {
    this.#events.push({ eventId: `${this.#trace}:${this.#events.length + 1}`,
      traceId: this.#trace, event, role, stage: this.#stage, revision: this.#revision,
      correctionRounds: this.#correctionRounds,
      policy: hash(this.#doc.policy ?? null), policyVersion: hash(this.#doc.policy?.version ?? null),
      binding: this.#binding() });
  }
  #expect(stage) { requireThat(this.#stage === stage, 'STAGE_DENIED'); }
  #gate(now) {
    try { editorialGate(this.#doc, now); }
    catch (error) {
      if (error.message === 'ESCALATION_REQUIRED') {
        this.#stage = 'escalated'; this.#approval = undefined; this.#audit('escalated', 'verification');
      }
      throw error;
    }
  }
  verify(now) {
    this.#expect('discovered'); this.#gate(now);
    this.#stage = 'verified'; this.#audit('verified', 'verification');
  }
  edit(now) {
    this.#expect('verified'); this.#gate(now); draftGate(this.#doc);
    this.#stage = 'edited'; this.#audit('edited', 'editor');
  }
  prepareMedia(now) {
    this.#expect('edited'); this.#gate(now); draftGate(this.#doc); mediaGate(this.#doc);
    metadataGate(this.#doc, now);
    this.#stage = 'media_ready'; this.#audit('media_ready', 'media');
  }
  approve(reviewer, now) {
    this.#expect('media_ready'); requireThat(reviewer === 'al-mutamid', 'REVIEWER_DENIED');
    this.#gate(now); draftGate(this.#doc); mediaGate(this.#doc);
    metadataGate(this.#doc, now);
    this.#approval = { reviewer, binding: this.#binding() };
    this.#stage = 'approved'; this.#audit('approved', 'al-mutamid');
  }
  update(doc) {
    requireThat(active.includes(this.#stage) || this.#stage === 'revision_requested', 'TERMINAL_STATE');
    this.#checkCorrectionBudget();
    this.#doc = copy(doc); this.#revision++; this.#correctionRounds++; this.#approval = undefined;
    this.#stage = 'discovered'; this.#audit('revision_invalidated', 'coordinator');
  }
  #checkCorrectionBudget() {
    if (this.#correctionRounds < 2) return;
    this.#stage = 'escalated'; this.#approval = undefined;
    this.#audit('correction_limit_reached', 'coordinator');
    throw new Error('CORRECTION_LIMIT_REACHED');
  }
  decide(decision, reviewer) {
    requireThat(active.includes(this.#stage), 'TERMINAL_STATE');
    requireThat(reviewer === 'al-mutamid', 'REVIEWER_DENIED');
    requireThat(['rejected', 'revision_requested', 'escalated'].includes(decision), 'DECISION_DENIED');
    if (decision === 'revision_requested') this.#checkCorrectionBudget();
    this.#stage = decision; this.#approval = undefined; this.#audit(decision, reviewer);
  }
  dryRun(simulation, now, options = {}) {
    assertOffline(options.mode);
    this.#expect('approved');
    requireThat(this.#approval?.reviewer === 'al-mutamid' && this.#approval.binding === this.#binding(), 'APPROVAL_INVALID');
    this.#gate(now); draftGate(this.#doc); mediaGate(this.#doc);
    metadataGate(this.#doc, now);
    const result = simulation.begin(hash(this.#doc.storyKey.trim().toLowerCase()), now);
    this.#audit(`simulation_${result.status}`, 'coordinator');
    if (result.status === 'complete') {
      this.#stage = 'dry_run_complete'; this.#audit('dry_run_complete', 'coordinator');
    }
    return result;
  }
}

// Local transaction/lease model only. "Committed" means an in-memory receipt.
export class LocalSimulation {
  #records = new Map(); #receipts = new Set(); #sequence = 0;
  constructor({ leaseMs = 100, backoffMs = 20, maxAttempts = 3 } = {}) {
    requireThat([leaseMs, backoffMs, maxAttempts].every(n => Number.isSafeInteger(n) && n > 0), 'INVALID_SIMULATION_POLICY');
    this.leaseMs = leaseMs; this.backoffMs = backoffMs; this.maxAttempts = maxAttempts;
  }
  begin(key, now) {
    requireThat(text(key) && Number.isFinite(now), 'INVALID_SIMULATION_INPUT');
    let r = this.#records.get(key);
    if (r?.status === 'complete') return { status: 'complete', key };
    if (r?.status === 'uncertain') return { status: 'reconcile_required', key };
    if (r?.status === 'leased' && now < r.until) return { status: 'duplicate_in_flight', key };
    // Expired workers may have committed: never blindly retry an expired lease.
    if (r?.status === 'leased') { r.status = 'uncertain'; return { status: 'reconcile_required', key }; }
    if (r && now < r.retryAt) return { status: 'backoff', key };
    if (r?.attempts >= this.maxAttempts) return { status: 'exhausted', key };
    r = { attempts: (r?.attempts ?? 0) + 1, status: 'leased', until: now + this.leaseMs,
      token: `lease-${++this.#sequence}`, retryAt: 0 };
    this.#records.set(key, r);
    return { status: 'leased', key, token: r.token, attempt: r.attempts };
  }
  settle(lease, now, outcome) {
    const r = this.#records.get(lease.key);
    requireThat(r?.status === 'leased' && r.token === lease.token && now < r.until, 'LEASE_DENIED');
    requireThat(['success', 'outage', 'uncertain_committed', 'uncertain_absent'].includes(outcome), 'OUTCOME_DENIED');
    if (outcome === 'success' || outcome === 'uncertain_committed') this.#receipts.add(lease.key);
    r.status = outcome === 'success' ? 'complete' : outcome === 'outage' ? 'retry' : 'uncertain';
    r.retryAt = now + this.backoffMs * 2 ** (r.attempts - 1);
    return { status: r.status, key: lease.key };
  }
  reconcile(key, now) {
    const r = this.#records.get(key);
    requireThat(r?.status === 'uncertain' && Number.isFinite(now), 'RECONCILE_DENIED');
    r.status = this.#receipts.has(key) ? 'complete' : 'retry';
    r.retryAt = now + this.backoffMs * 2 ** (r.attempts - 1);
    return { status: r.status, key };
  }
  get summary() { return { simulatedReceipts: this.#receipts.size, localRecords: this.#records.size }; }
}
