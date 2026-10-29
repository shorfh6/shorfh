import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import pg from 'pg';
import { securePgConnectionOptions } from '../../lib/pg-connection-options.mjs';
import { validateResult, contentHash, assertNoSecrets } from './envelope.mjs';
import { assertVerifiedEvidenceContinuation } from './evidence-binding.mjs';
import { openJournal } from './local-journal.mjs';

const check = (ok, code) => { if (!ok) throw new Error(code); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const roles = ['al-muhaqqiq', 'al-muharrir', 'al-musawwir'];
const normal = value => typeof value === 'string' ? value.replaceAll('\r\n','\n').trim() : value;

// Trusted coordinator/approver credential boundary, NOT an anonymous HTTP API.
// These metadata checks do not create cryptographic reviewer authentication.
export function validateApprovalPacket(packet, supporting) {
  const { task, result, proof } = packet;
  validateResult(result, task); assertNoSecrets(proof);
  check(task.agent === 'al-mutamid' && result.status === 'completed' && result.decision?.status === 'APPROVED', 'FINAL_APPROVAL_REQUIRED');
  check(task.claims.length>0 && task.evidence.length>0 && task.claims.every(c=>c.status==='verified'),'VERIFIED_CLAIMS_REQUIRED');
  const site=new URL(task.input.site);
  check(site.protocol==='https:'&&!site.username&&!site.password&&!site.search&&!site.hash&&site.pathname==='/'&&site.hostname.includes('.')&&!isIP(site.hostname),'PUBLIC_SITE_REQUIRED');
  function authentic(p) {
    validateResult(p.result,p.task); assertNoSecrets(p.proof);
    check(p.proof.actualAgent===p.task.agent && p.proof.childFinalMatched===true &&
      p.proof.parentBindingVerified===true && p.proof.taskBindingVerified===true &&
      p.proof.expectedTaskDigest===contentHash(p.task) && /^ses_[A-Za-z0-9]+$/.test(p.proof.childSessionId), 'REVIEW_PROOF_REQUIRED');
  }
  authentic(packet);
  check(Array.isArray(supporting) && supporting.length===3, 'SUPPORTING_REVIEWS_REQUIRED');
  for (const role of roles) {
    const packets=supporting.filter(p=>p.task.agent===role); check(packets.length===1,'SUPPORTING_REVIEWS_REQUIRED');
    const p=packets[0]; authentic(p);
    check(p.result.status==='completed' && p.task.traceId===task.traceId && p.task.input.articleId===task.input.articleId,'SUPPORTING_REVIEW_MISMATCH');
    const reference=task.input.priorReviews?.find(r=>r.agent===role && r.status==='completed');
    check(reference?.inputHash===p.task.hash.value && reference?.childSessionId===p.proof.childSessionId &&
      contentHash(reference.output)===contentHash(p.result.output), 'REVIEW_LINEAGE_MISMATCH');
  }
  const verifier=supporting.find(p=>p.task.agent==='al-muhaqqiq');
  assertVerifiedEvidenceContinuation(verifier.task,verifier.result,task);
  const media=supporting.find(p=>p.task.agent==='al-musawwir');
  check(media.result.output.proposal?.rightsStatus==='confirmed','MEDIA_REVIEW_REQUIRED');
  const snapshot=task.input.publicationSnapshot,c=task.input.publicationCandidate;
  check(snapshot && c && snapshot.version===1 && Number.isSafeInteger(snapshot.id) && snapshot.id===c.articleId && snapshot.id===task.input.articleId,'BOUND_DATABASE_SNAPSHOT_REQUIRED');
  check(Object.keys(snapshot).sort().join(',')===['version','id','title','excerpt','body','image','category','author','tags','sourceUrl','featured','exclusive','createdAt'].sort().join(','),'SNAPSHOT_FIELDS');
  for (const field of ['title','excerpt','body']) check(typeof c[field]==='string' && c[field].trim() && normal(snapshot[field])===normal(c[field]),'CANDIDATE_SNAPSHOT_MISMATCH');
  check(snapshot.image===c.imageName && /^[\w-]+\.(png|jpg|jpeg|webp)$/i.test(snapshot.image) && digest(c.imageLocalSha256),'MEDIA_SNAPSHOT_MISMATCH');
  check(Array.isArray(media.result.output.proposal.mediaManifest) && media.result.output.proposal.mediaManifest.some(a=>a.hash?.algorithm==='sha256'&&a.hash.value===c.imageLocalSha256&&a.rightsStatus==='confirmed'),'MEDIA_SNAPSHOT_MISMATCH');
  check(snapshot.category?.id===c.categoryId && snapshot.category?.name===c.categoryName &&
    (snapshot.author?.name??null)===(c.authorDisplayName??null) && snapshot.featured===c.featured && snapshot.exclusive===c.exclusive,'CANDIDATE_SNAPSHOT_MISMATCH');
  check(Array.isArray(snapshot.tags) && Array.isArray(c.tagNames) &&
    contentHash(snapshot.tags.map(t=>t.name).sort())===contentHash([...c.tagNames].sort()),'TAG_SNAPSHOT_MISMATCH');
  check(typeof c.sourceUrl==='string' && /^https:\/\//.test(c.sourceUrl) &&
    (snapshot.sourceUrl===c.sourceUrl || snapshot.sourceUrl==='' && c.body.includes(c.sourceUrl)),'SOURCE_SNAPSHOT_MISMATCH');
  check(c.seoTitle===c.title && c.metaDescription===c.excerpt,'SEO_MAPPING_MISMATCH');
  return { articleId:snapshot.id,snapshot,taskHash:task.hash.value,resultHash:contentHash(result),policyHash:task.policy.hash,
    reviewedAt:result.decision.reviewedAt,proof:{final_agent:'al-mutamid',decision:'APPROVED',agents:roles,
      final_child_session:proof.childSessionId,media_sha256:c.imageLocalSha256,site:site.origin,coordinator_task_digest:contentHash(task)} };
}

export async function recordApproval(client, packet, supporting) {
  const p=validateApprovalPacket(packet,supporting);
  // Caller supplies a dedicated approver connection. One PostgreSQL function is atomic.
  const r=await client.query('SELECT raad_gate.record_approval($1,$2::jsonb,$3,$4,$5,$6::timestamptz,$7::jsonb,3600) AS id',
    [p.articleId,JSON.stringify(p.snapshot),p.taskHash,p.resultHash,p.policyHash,p.reviewedAt,JSON.stringify(p.proof)]);
  return {articleId:p.articleId,approvalId:r.rows[0].id};
}

export async function recordAndQueueApproval(client,packet,supporting){
  const p=validateApprovalPacket(packet,supporting);
  let committing=false;
  await client.query('BEGIN');
  try{
    const existing=(await client.query('SELECT raad_queue.find_request($1,$2,$3,$4) AS work',[p.articleId,p.taskHash,p.resultHash,p.policyHash])).rows[0]?.work;
    let result;
    if(existing)result={articleId:p.articleId,approvalId:existing.approvalId,jobId:existing.id,queueState:existing.state};
    else{
      const recorded=await recordApproval(client,packet,supporting);
      const work=(await client.query('SELECT raad_queue.enqueue($1,$2) AS work',[recorded.articleId,recorded.approvalId])).rows[0]?.work;
      check(work?.id,'QUEUE_ENQUEUE_FAILED');
      result={...recorded,jobId:work.id,queueState:work.state};
    }
    committing=true;await client.query('COMMIT');return result;
  }catch(error){
    try{await client.query('ROLLBACK');}catch{/* The outcome may need reconciliation. */}
    if(committing)throw Error('APPROVAL_IMPORT_OUTCOME_UNKNOWN');
    throw error;
  }
}

function loadPacket(directory,event) {
  const read=(name,limit)=>{const file=path.join(directory,name),s=fs.lstatSync(file);check(s.isFile()&&!s.isSymbolicLink()&&s.size<=limit,'UNSAFE_REVIEW_FILE');return JSON.parse(fs.readFileSync(file,'utf8'));};
  return {task:read(`snapshots/${event.taskDigest}.json`,1024*1024),result:read(`snapshots/${event.resultDigest}.json`,1024*1024),proof:read(`${event.resultDigest}.review-proof.json`,128*1024)};
}
export async function main(args) {
  const enqueue=args.length===6&&args[5]==='--enqueue';
  check((args.length===5||enqueue) && args[0]==='--journal' && args[2]==='--result-digest' && args[4]==='--execute','EXPLICIT_IMPORT_ARGUMENTS_REQUIRED');
  const directory=path.resolve(args[1]); check(path.isAbsolute(args[1])&&digest(args[3]),'INVALID_IMPORT_REFERENCE');
  const events=openJournal(directory).readAudit().filter(e=>e.type==='result');
  const event=events.find(e=>e.resultDigest===args[3]); check(event,'REVIEW_RESULT_NOT_FOUND');
  const final=loadPacket(directory,event),supporting=roles.map(role=>{
    const ref=final.task.input.priorReviews?.find(r=>r.agent===role&&r.status==='completed');check(ref,'SUPPORTING_REVIEWS_REQUIRED');
    const item=events.find(e=>e.summary.agent===role&&e.summary.inputHash===ref.inputHash);check(item,'SUPPORTING_REVIEWS_REQUIRED');return loadPacket(directory,item);
  });
  validateApprovalPacket(final,supporting); // Reject invalid packets before opening a DB connection.
  check(process.env.RAAD_APPROVAL_DATABASE_URL,'APPROVER_CONNECTION_REQUIRED');
  const options=securePgConnectionOptions(process.env.RAAD_APPROVAL_DATABASE_URL,{ca:process.env.RAAD_APPROVAL_DB_CA_CERT});
  const client=new pg.Client({...options,connectionTimeoutMillis:5000,statement_timeout:10000});
  await client.connect(); try{return await (enqueue?recordAndQueueApproval(client,final,supporting):recordApproval(client,final,supporting));}finally{await client.end();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(error=>{console.error(JSON.stringify({error:/^[A-Z_]+$/.test(error.message)?error.message:'APPROVAL_IMPORT_FAILED'}));process.exitCode=1;});
}
