import { createHash } from 'node:crypto';

// Pure exchange validation only: no execution, persistence, clock, or transport.
export const VERSION = 'raad.contract/1';
export const AGENTS = Object.freeze(Object.fromEntries([
  ['al-rasid', 'discovery'], ['al-muhaqqiq', 'verification'],
  ['al-muharrir', 'editing'], ['al-musawwir', 'media'],
  ['al-mutamid', 'approval'], ['al-nashir', 'publishing'],
  ['al-haris', 'security'], ['al-muraqib', 'monitoring'],
].map(([agent, stage]) => [agent, Object.freeze({ role: stage, stage, delegation: false })])));
const stages = ['discovery', 'verification', 'editing', 'media', 'approval', 'publishing'];
const decisions = ['APPROVED', 'REVISION_REQUIRED', 'REJECTED', 'ESCALATE'];
const check = (ok, code) => { if (!ok) throw new Error(code); };
const text = v => typeof v === 'string' && v.trim().length > 0;
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => check(object(v) && Object.keys(v).every(k => allowed.includes(k)), 'UNKNOWN_FIELD');
const copy = v => JSON.parse(JSON.stringify(v));

// Sorted object keys, array order preserved, JSON primitives only, no implicit coercion.
function canonical(v, seen = new Set()) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { check(Number.isFinite(v), 'NON_JSON'); return JSON.stringify(v); }
  check(object(v) || Array.isArray(v), 'NON_JSON');
  check(!seen.has(v), 'CYCLIC_DATA');
  check(Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v)), 'NON_JSON');
  check(Reflect.ownKeys(v).every(k => typeof k === 'string' &&
    (Array.isArray(v) && k === 'length' || Object.getOwnPropertyDescriptor(v, k)?.enumerable &&
      'value' in Object.getOwnPropertyDescriptor(v, k))), 'NON_JSON');
  seen.add(v);
  let result;
  if (Array.isArray(v)) {
    check(Object.keys(v).length === v.length && Object.keys(v).every((k, i) => k === String(i)), 'NON_JSON');
    result = `[${v.map(x => canonical(x, seen)).join(',')}]`;
  } else result = `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k], seen)}`).join(',')}}`;
  seen.delete(v);
  return result;
}
export const contentHash = value => createHash('sha256').update(canonical(value)).digest('hex');

// The only authoritative content package. Output is a proposal/report, never a
// replacement for input. The coordinator must adopt proposals in a new revision.
const boundFields = ['input', 'revision', 'policy', 'sources', 'claims', 'evidence', 'references', 'issues'];
export const reviewPackageHash = envelope => contentHash(Object.fromEntries(boundFields.map(k => [k, envelope[k]])));
const credentialKeys = new Set(['token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'bearertoken',
  'apikey', 'secret', 'clientsecret', 'apisecret', 'accesssecret', 'password', 'passwd', 'authorization',
  'proxyauthorization', 'credential', 'credentials', 'privatekey', 'cookie', 'cookies', 'setcookie',
  'sessiontoken', 'sessionid', 'awsaccesskeyid', 'awssecretaccesskey', 'signature', 'sig']);
const credentialKey = key => credentialKeys.has(key.toLowerCase().replace(/[-_\s]/g, ''));

// Conservative rejection, not a comprehensive secret detector or redaction service.
export function assertNoSecrets(value) {
  canonical(value);
  function visit(v) {
    if (typeof v === 'string') {
      check(!/(?:\bBearer\s+\S+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16})\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/i.test(v), 'SECRET_VALUE');
      for (const raw of v.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
        let url;
        try { url = new URL(raw); } catch { throw new Error('INVALID_URL'); }
        check(!url.username && !url.password, 'URL_CREDENTIALS');
        for (const k of url.searchParams.keys()) check(!credentialKey(k) && k.toLowerCase() !== 'key', 'URL_SECRET');
        for (const k of new URLSearchParams(url.hash.slice(1)).keys()) check(!credentialKey(k) && k.toLowerCase() !== 'key', 'URL_SECRET');
      }
    } else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        check(!credentialKey(k), 'SECRET_KEY');
        check(!['__proto__', 'prototype', 'constructor'].includes(k), 'UNSAFE_KEY');
        visit(child);
      }
    }
  }
  visit(value);
  return true;
}

function identity(e) {
  check(e.version === VERSION, 'VERSION');
  check(text(e.taskId) && text(e.traceId), 'IDS');
  const spec = Object.hasOwn(AGENTS, e.agent) ? AGENTS[e.agent] : null;
  check(spec && spec.role === e.role && spec.stage === e.stage, 'ROLE_STAGE');
  keys(e.revision, ['id', 'parentId', 'number', 'revisionRounds']);
  check(text(e.revision.id) && (e.revision.parentId === null || text(e.revision.parentId)) &&
    Number.isSafeInteger(e.revision.number) && e.revision.number >= 1 &&
    Number.isInteger(e.revision.revisionRounds) && e.revision.revisionRounds >= 0 &&
    e.revision.revisionRounds <= 2, 'REVISION');
  keys(e.policy, ['id', 'version', 'hash', 'freshnessSeconds']);
  check(text(e.policy.id) && text(e.policy.version) && hex(e.policy.hash) &&
    Number.isSafeInteger(e.policy.freshnessSeconds) && e.policy.freshnessSeconds > 0, 'POLICY');
  keys(e.hash, ['algorithm', 'value']);
  check(e.hash.algorithm === 'sha256' && hex(e.hash.value), 'HASH');
  check(object(e.input), 'INPUT');
  check(e.hash.value === reviewPackageHash(e), 'INPUT_HASH');
}

function references(e) {
  for (const name of ['sources', 'claims', 'evidence', 'references', 'issues']) check(Array.isArray(e[name]), 'COLLECTION');
  const ids = name => {
    const set = new Set();
    for (const item of e[name]) {
      check(object(item) && text(item.id) && !set.has(item.id), 'DUPLICATE_OR_MISSING_ID');
      set.add(item.id);
    }
    return set;
  };
  const sources = ids('sources'), claims = ids('claims'), evidence = ids('evidence');
  ids('issues');
  for (const claim of e.claims) check(text(claim.text) && text(claim.status) && text(claim.confidence), 'CLAIM');
  for (const item of e.evidence) check(sources.has(item.sourceId) &&
    ['excerpt', 'location', 'context', 'attribution'].every(k => text(item[k])), 'EVIDENCE');
  const mapped = new Set();
  for (const ref of e.references) {
    check(claims.has(ref.claimId) && !mapped.has(ref.claimId) && Array.isArray(ref.evidenceIds) &&
      ref.evidenceIds.length > 0 && new Set(ref.evidenceIds).size === ref.evidenceIds.length &&
      ref.evidenceIds.every(id => evidence.has(id)), 'ORPHAN_REFERENCE');
    mapped.add(ref.claimId);
  }
  for (const claim of e.claims) check(claim.status !== 'verified' || mapped.has(claim.id), 'UNSUPPORTED_CLAIM');
}

function decision(d, e) {
  keys(d, ['status', 'reviewer', 'reviewedAt', 'revisionId', 'revisionHash', 'reason', 'evidenceIds', 'issueIds']);
  check(decisions.includes(d.status), 'DECISION_STATUS');
  check(d.reviewer === 'al-mutamid', 'REVIEWER');
  check(d.revisionId === e.revision.id && d.revisionHash === e.hash.value, 'REVIEW_BINDING');
  check(text(d.reason) && typeof d.reviewedAt === 'string' &&
    /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(d.reviewedAt) && Number.isFinite(Date.parse(d.reviewedAt)), 'DECISION_METADATA');
  for (const [field, collection] of [['evidenceIds', 'evidence'], ['issueIds', 'issues']]) {
    check(Array.isArray(d[field]) && d[field].every(id => e[collection].some(item => item.id === id)), 'DECISION_REFERENCE');
  }
  check(d.status !== 'REVISION_REQUIRED' || e.revision.revisionRounds < 2, 'REVISION_LIMIT');
}

function next(e) {
  if (e.status !== 'completed') return null;
  if (['monitoring', 'security'].includes(e.stage)) return null;
  if (e.error !== null || ['REJECTED', 'ESCALATE'].includes(e.decision?.status)) return null;
  if (e.decision?.status === 'REVISION_REQUIRED') return 'editing';
  if (e.stage === 'approval' && e.decision?.status !== 'APPROVED') return null;
  return stages[stages.indexOf(e.stage) + 1] ?? null;
}
const fields = ['version', 'kind', 'taskId', 'traceId', 'agent', 'role', 'stage', 'revision', 'hash', 'policy',
  'input', 'sources', 'claims', 'evidence', 'references', 'output', 'decision', 'approval', 'issues', 'handoff', 'metrics', 'error', 'status'];

function validateOutput(e) {
  const o = e.output;
  if (e.status === 'no_candidates') {
    check(e.stage === 'discovery' && e.error === null && e.decision === null, 'NO_CANDIDATES');
    keys(o, ['candidates', 'reason']);
    check(Array.isArray(o.candidates) && o.candidates.length === 0 && text(o.reason), 'NO_CANDIDATES');
    return;
  }
  if (e.status === 'blocked') {
    check(e.decision === null, 'BLOCKED_DECISION');
    if (e.stage === 'publishing') {
      keys(o, ['mode', 'adapter', 'inputHash', 'reason']);
      check(o.mode === 'preflight' && o.adapter === 'blocked' && o.inputHash === e.hash.value && text(o.reason), 'PUBLISHING_OUTPUT');
    } else {
      keys(o, ['reason']);
      check(text(o.reason), 'BLOCKED_REASON');
    }
    return;
  }
  check(e.status === 'completed' && e.error === null, 'RESULT_STATUS');
  if (e.stage === 'approval') {
    keys(o, ['report', 'reviewedHash']);
    check(text(o.report) && o.reviewedHash === e.hash.value, 'REVIEW_OUTPUT');
  } else if (e.stage === 'publishing') {
    keys(o, ['mode', 'simulated', 'inputHash']);
    check(o.mode === 'dry_run' && o.simulated === true && o.inputHash === e.hash.value, 'PUBLISHING_OUTPUT');
  } else if (e.stage === 'discovery') {
    keys(o, ['candidates']);
    check(Array.isArray(o.candidates) && o.candidates.length > 0 &&
      o.candidates.every(c => object(c) && Object.keys(c).length > 0), 'CANDIDATES');
  } else if (['editing', 'media'].includes(e.stage)) {
    keys(o, ['proposal']);
    check(object(o.proposal) && Object.keys(o.proposal).length > 0, 'PROPOSAL');
  } else {
    keys(o, ['report', 'proposals']);
    check(text(o.report) && (o.proposals === undefined || object(o.proposals) && Object.keys(o.proposals).length > 0), 'REPORT');
  }
}
function validate(e) {
  assertNoSecrets(e);
  keys(e, fields);
  identity(e);
  references(e);
  if (e.stage === 'publishing') {
    decision(e.approval, e);
    check(e.approval.status === 'APPROVED', 'APPROVAL_REQUIRED');
  } else check(e.approval === null, 'UNEXPECTED_APPROVAL');
  check(['task', 'result'].includes(e.kind), 'KIND');
  // Measurement authenticity cannot be inferred from agent text. This minimal contract
  // accepts no agent-reported numerical metrics; coordinator telemetry is separate.
  check(e.metrics === undefined || e.metrics === null || e.metrics === 'unknown', 'METRICS');
  if (e.error !== null) {
    keys(e.error, ['code', 'message', 'retryable']);
    check(text(e.error.code) && text(e.error.message) && typeof e.error.retryable === 'boolean' &&
      e.status === 'blocked' && e.decision === null, 'ERROR_RESULT');
  }
  check(e.output === null || object(e.output), 'OUTPUT');
  if (e.decision !== null) {
    check(e.kind === 'result' && e.agent === 'al-mutamid' && e.stage === 'approval', 'DECISION_AUTHORITY');
    decision(e.decision, e);
  }
  if (e.kind === 'task') check(e.status === null && e.decision === null && e.output === null && e.error === null && e.handoff === null, 'TASK_OUTPUT');
  else {
    validateOutput(e);
    const target = next(e);
    if (target === null) check(e.handoff === null, 'HANDOFF');
    else {
      keys(e.handoff, ['stage', 'agent']);
      check(e.handoff.stage === target && AGENTS[e.handoff.agent]?.stage === target, 'HANDOFF');
    }
    if (e.stage === 'approval' && e.status === 'completed') check(e.decision !== null, 'DECISION_REQUIRED');
  }
  return true;
}

/** Caller supplies scoped input (including the complete content package), IDs,
 * immutable revision and policy. No IDs, timestamps, or measurements are invented. */
export function createTask(options) {
  keys(options, ['taskId', 'traceId', 'agent', 'input', 'revision', 'policy', 'sources', 'claims', 'evidence', 'references', 'issues', 'approval']);
  const spec = AGENTS[options.agent];
  const task = { version: VERSION, kind: 'task', ...options,
    role: spec?.role, stage: spec?.stage,
    sources: options.sources ?? [], claims: options.claims ?? [], evidence: options.evidence ?? [],
    references: options.references ?? [], issues: options.issues ?? [],
    output: null, decision: null, approval: options.approval ?? null, handoff: null, metrics: 'unknown', error: null, status: null };
  task.hash = { algorithm: 'sha256', value: reviewPackageHash(task) };
  validate(task);
  return copy(task);
}

export function validateTask(task) {
  validate(task);
  check(task.kind === 'task', 'EXPECTED_TASK');
  return true;
}

/** expectedTask is trusted coordinator context, never context supplied by the agent.
 * Validates an exchange, not editorial readiness or authorization to publish. */
export function validateResult(result, expectedTask) {
  validateTask(expectedTask);
  validate(result);
  check(result.kind === 'result', 'EXPECTED_RESULT');
  for (const field of ['taskId', 'traceId', 'agent', 'role', 'stage', 'hash', 'approval', ...boundFields]) {
    check(canonical(result[field]) === canonical(expectedTask[field]), 'CONTEXT_MISMATCH');
  }
  return true;
}

/** Text-free, in-memory summary. Caller owns any append-only persistence. */
export function auditSummary(result, expectedTask) {
  validateResult(result, expectedTask);
  return Object.freeze({ version: VERSION, taskIdHash: contentHash(result.taskId), traceIdHash: contentHash(result.traceId),
    agent: result.agent, stage: result.stage, revisionNumber: result.revision.number,
    revisionRounds: result.revision.revisionRounds, inputHash: result.hash.value,
    policyVersionHash: contentHash(result.policy.version), decision: result.decision?.status ?? null,
    outcome: result.status, failed: result.status === 'blocked' || ['REJECTED', 'ESCALATE'].includes(result.decision?.status),
    claimCount: result.claims.length, evidenceCount: result.evidence.length });
}

export function validateSourceRegistry(registry) {
  assertNoSecrets(registry);
  keys(registry, ['version', 'ownerApproval', 'sources']);
  check(registry.version === VERSION && Array.isArray(registry.sources), 'SOURCE_REGISTRY');
  if (registry.ownerApproval === 'pending') {
    check(registry.sources.length === 0, 'SOURCE_REGISTRY');
    return true;
  }
  check(registry.ownerApproval === 'editorial-only' && registry.sources.length === 1, 'SOURCE_REGISTRY');
  const source = registry.sources[0];
  keys(source, ['id', 'name', 'url', 'approvalScope', 'approvedBy', 'automatedCollection',
    'articleRepublication', 'imageReuse', 'rightsStatus', 'discovery', 'policy']);
  // Exact reviewed values form a closed URL allowlist, not a configurable fetch target.
  // Owner editorial approval is neither publisher permission nor operational authority.
  check(source.id === 'okaz' && source.name === 'عكاظ' && source.url === 'https://www.okaz.com.sa/' &&
    source.approvalScope === 'editorial-reference-only' && source.approvedBy === 'owner' &&
    source.automatedCollection === false && source.articleRepublication === false &&
    source.imageReuse === false && source.rightsStatus === 'permission-pending', 'SOURCE_REGISTRY');
  keys(source.discovery, ['type', 'url', 'feedVerified']);
  check(source.discovery.type === 'rss-index' && source.discovery.url === 'https://www.okaz.com.sa/rss' &&
    source.discovery.feedVerified === false, 'SOURCE_REGISTRY');
  keys(source.policy, ['url', 'reviewedOn']);
  check(source.policy.url === 'https://www.okaz.com.sa/privacy-policy' &&
    source.policy.reviewedOn === '2026-10-25', 'SOURCE_REGISTRY');
  return true;
}
export function validateRuntime(runtime) {
  keys(runtime, ['version', 'mode', 'pollIntervalSeconds', 'livePublishing', 'schedulerInstalled']);
  check(runtime.version === VERSION && runtime.mode === 'dry-run' && runtime.pollIntervalSeconds === 300 &&
    runtime.livePublishing === false && runtime.schedulerInstalled === false, 'RUNTIME_DISABLED_REQUIRED');
  return true;
}
