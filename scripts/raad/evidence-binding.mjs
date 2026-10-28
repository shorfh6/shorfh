import { contentHash, validateTask, validateResult } from './envelope.mjs';

// Stage provenance, NOT a final publication approval or reviewer authentication.
// Adding editorial proposals/review lineage changes the full task hash even when
// the investigator's facts remain identical. Never transfer final APPROVED here.
export function evidenceDigest(task) {
  validateTask(task);
  const e = task.input.editorialEvidence;
  if (!e || !Array.isArray(e.facts) || !Array.isArray(e.evidence)) throw Error('EVIDENCE_PACKAGE_REQUIRED');
  return contentHash({ articleId: task.input.articleId, site: task.input.site,
    sourceUrls: e.sourceUrls, publicationDates: e.publicationDates, facts: e.facts,
    excerptEvidence: e.evidence, sourceRelationship: e.sourceRelationship,
    sources: task.sources, claims: task.claims.map(({ id, text }) => ({ id, text })),
    evidence: task.evidence, references: task.references,
    freshnessSeconds: task.policy.freshnessSeconds });
}

export function assertVerifiedEvidenceContinuation(verificationTask, verificationResult, nextTask) {
  validateResult(verificationResult, verificationTask);
  validateTask(nextTask);
  if (verificationTask.agent !== 'al-muhaqqiq' || verificationResult.status !== 'completed' ||
      verificationTask.traceId !== nextTask.traceId || verificationResult.decision !== null) throw Error('VERIFICATION_REQUIRED');
  const verdicts = verificationResult.output?.proposals?.claimVerdicts;
  if (!Array.isArray(verdicts) || verdicts.length !== verificationTask.claims.length ||
      new Set(verdicts.map(v => v.claimId)).size !== verdicts.length ||
      verificationTask.claims.some(c => !verdicts.some(v => v.claimId === c.id && v.status === 'verified' &&
        Array.isArray(v.evidenceIds) && v.evidenceIds.length > 0 && v.evidenceIds.every(id =>
          verificationTask.references.some(r => r.claimId === c.id && r.evidenceIds.includes(id)))))) throw Error('CLAIM_VERIFICATION_REQUIRED');
  const before = evidenceDigest(verificationTask), after = evidenceDigest(nextTask);
  if (before !== after) throw Error('FACTS_CHANGED_REVERIFY');
  return Object.freeze({ digest: after, verificationTaskHash: verificationTask.hash.value,
    nextTaskHash: nextTask.hash.value, method: 'coordinator SHA-256 comparison of unchanged evidence and claims',
    finalPublicationApprovalTransferred: false });
}
