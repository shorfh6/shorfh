import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask,contentHash } from './envelope.mjs';
import { validateApprovalPacket,recordApproval } from './import-publication-approval.mjs';

const cp=v=>structuredClone(v),hex='a'.repeat(64);
function fixture(changeSnapshot=()=>{}) {
  const sources=[{id:'s1',url:'https://example.com/source'}];
  const evidence=[{id:'e1',sourceId:'s1',excerpt:'SYNTHETIC excerpt',location:'SYNTHETIC paragraph',context:'SYNTHETIC NOT REAL NEWS',attribution:'SYNTHETIC publisher'}];
  const claims=[{id:'c1',text:'SYNTHETIC fact',status:'unverified',confidence:'SYNTHETIC source assessment'}];
  const references=[{claimId:'c1',evidenceIds:['e1']}];
  const base={articleId:1,site:'https://example.com',editorialEvidence:{sourceUrls:{s1:sources[0].url},publicationDates:{source:'2026-01-01'},facts:[{id:'c1',text:'SYNTHETIC fact',evidenceIds:['e1']}],evidence,sourceRelationship:'SYNTHETIC single source'}};
  const snapshot={version:1,id:1,title:'SYNTHETIC title',excerpt:'SYNTHETIC excerpt',body:'SYNTHETIC fact https://example.com/source',image:'synthetic.png',category:{id:1,name:'SYNTHETIC category',slug:'synthetic'},author:{id:1,name:'SYNTHETIC editor',bio:''},tags:[{id:1,name:'SYNTHETIC tag'}],sourceUrl:sources[0].url,featured:false,exclusive:false,createdAt:'2026-01-01T00:00:00.000000Z'};
  const candidate={articleId:1,title:snapshot.title,excerpt:snapshot.excerpt,body:snapshot.body,seoTitle:snapshot.title,metaDescription:snapshot.excerpt,imageName:snapshot.image,imageLocalSha256:hex,categoryId:1,categoryName:snapshot.category.name,authorDisplayName:snapshot.author.name,tagNames:['SYNTHETIC tag'],sourceUrl:sources[0].url,featured:false,exclusive:false};
  function packet(agent,index,input,output){
    const task=createTask({taskId:'synthetic-task-'+index,traceId:'synthetic-approval-flow',agent,input:cp(input),revision:{id:'synthetic-r'+index,parentId:null,number:index,revisionRounds:0},policy:{id:'synthetic',version:'1',hash:hex,freshnessSeconds:86400},sources,claims:claims.map(c=>({...c,status:index===1?'unverified':'verified'})),evidence,references});
    const result={...cp(task),kind:'result',status:'completed',output,decision:null,handoff:{stage:{'al-muhaqqiq':'editing','al-muharrir':'media','al-musawwir':'approval'}[agent],agent:{'al-muhaqqiq':'al-muharrir','al-muharrir':'al-musawwir','al-musawwir':'al-mutamid'}[agent]}};
    const proof={actualAgent:agent,childFinalMatched:true,parentBindingVerified:true,taskBindingVerified:true,expectedTaskDigest:contentHash(task),childSessionId:'ses_synthetic'+index};
    return {task,result,proof};
  }
  const verifier=packet('al-muhaqqiq',1,base,{report:'SYNTHETIC verification',proposals:{claimVerdicts:[{claimId:'c1',status:'verified',evidenceIds:['e1']}]}});
  const editor=packet('al-muharrir',2,base,{proposal:cp(candidate)});
  const media=packet('al-musawwir',3,base,{proposal:{rightsStatus:'confirmed',mediaManifest:[{rightsStatus:'confirmed',hash:{algorithm:'sha256',value:hex}}]}});
  const supporting=[verifier,editor,media];
  changeSnapshot(snapshot);
  const input={...cp(base),publicationCandidate:cp(candidate),publicationSnapshot:snapshot,priorReviews:supporting.map(p=>({agent:p.task.agent,status:'completed',inputHash:p.task.hash.value,childSessionId:p.proof.childSessionId,output:cp(p.result.output)}))};
  const final=packet('al-mutamid',4,input,{});
  final.result.output={report:'SYNTHETIC final approval',reviewedHash:final.task.hash.value};
  final.result.decision={status:'APPROVED',reviewer:'al-mutamid',reviewedAt:new Date().toISOString(),revisionId:final.task.revision.id,revisionHash:final.task.hash.value,reason:'SYNTHETIC',evidenceIds:['e1'],issueIds:[]};
  final.result.handoff={stage:'publishing',agent:'al-nashir'};
  return {final,supporting};
}

test('validated full snapshot and all three supporting reviews create only parameterized approval arguments',async()=>{
  const {final,supporting}=fixture();const p=validateApprovalPacket(final,supporting);assert.equal(p.proof.media_sha256,hex);assert.equal(p.articleId,1);
  let call;const result=await recordApproval({query:async(...args)=>{call=args;return{rows:[{id:'synthetic-approval-id'}]};}},final,supporting);
  assert.equal(result.approvalId,'synthetic-approval-id');assert.equal(call[0].includes(final.task.input.publicationCandidate.body),false);assert.equal(call[1][0],1);
});
test('incomplete supporting roles or altered lineage cannot be imported',()=>{
  const {final,supporting}=fixture();assert.throws(()=>validateApprovalPacket(final,supporting.slice(1)),/SUPPORTING/);
  const changed=cp(supporting);changed[0].proof.childSessionId='ses_other';assert.throws(()=>validateApprovalPacket(final,changed),/LINEAGE/);
});
test('unverified actor identity, task digest or final decision is rejected',()=>{
  for(const mutate of [p=>p.proof.actualAgent='al-muharrir',p=>p.proof.expectedTaskDigest='0'.repeat(64),p=>p.result.decision.status='REJECTED']){const {final,supporting}=fixture();mutate(final);assert.throws(()=>validateApprovalPacket(final,supporting));}
});
test('reviewed database snapshot must match title body image author category tags and source',()=>{
  for(const mutate of [s=>s.title='different',s=>s.body='different',s=>s.image='different.png',s=>s.author.name='different',s=>s.category.name='different',s=>s.tags[0].name='different',s=>s.sourceUrl='https://example.com/different']){
    const {final,supporting}=fixture(mutate);assert.throws(()=>validateApprovalPacket(final,supporting),/SNAPSHOT/);
  }
});
test('media approval must cover the actual candidate image hash',()=>{
  const {final,supporting}=fixture();supporting[2].result.output.proposal.mediaManifest[0].hash.value='b'.repeat(64);
  assert.throws(()=>validateApprovalPacket(final,supporting));
});
test('old final reviews without a bound database snapshot are not retroactive approvals',()=>{
  const {final,supporting}=fixture();delete final.task.input.publicationSnapshot;assert.throws(()=>validateApprovalPacket(final,supporting));
});
test('invalid review never opens the database writer',async()=>{
  const {final,supporting}=fixture();final.proof.childFinalMatched=false;let called=false;
  await assert.rejects(recordApproval({query:async()=>{called=true;}},final,supporting));assert.equal(called,false);
});
