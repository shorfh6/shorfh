import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertPublicationApproved as assertForSite, publicationFailure, lockPublicationScope } from '../../lib/publication.ts';

const original=Buffer.from('SYNTHETIC owned image bytes');
const sha=createHash('sha256').update(original).digest('hex');
const q=(review={state:'approved',mediaSha256:sha},image='synthetic.png')=>({query:async()=>[],one:async()=>({review:{site:'https://example.com',...review},image}),exec:async()=>0});
const assertPublicationApproved=(db,id,load)=>assertForSite(db,id,load,'https://example.com');
const image=bytes=>({body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),contentType:'image/png',size:bytes.length});

test('publication uses the fixed global lock before row locks',async()=>{
  const calls=[];await lockPublicationScope({query:async(...args)=>{calls.push(args);return[];}});
  assert.deepEqual(calls,[['SELECT pg_catalog.pg_advisory_xact_lock(724214, 1)']]);
});
test('valid SQL approval and exact original image bytes pass',async()=>{
  let requested;await assertPublicationApproved(q(),1,async name=>{requested=name;return image(original);});assert.equal(requested,'synthetic.png');
});
test('database rejection prevents image retrieval',async()=>{
  let called=false;await assert.rejects(assertPublicationApproved({...q(),query:async()=>{throw Error('RAAD_APPROVAL_REQUIRED');}},1,async()=>{called=true;}),/RAAD_APPROVAL_REQUIRED/);assert.equal(called,false);
});
test('changed or missing image bytes reject before publication',async()=>{
  for(const result of [null,image(Buffer.from('SYNTHETIC changed image')),image(Buffer.alloc(0))])await assert.rejects(assertPublicationApproved(q(),1,async()=>result),/RAAD_MEDIA_CHANGED/);
});
test('unknown hashes, external image URLs and traversal keys fail closed',async()=>{
  for(const database of [q({state:'approved'}),q({state:'missing'}),q(undefined,'https://example.com/image.png'),q(undefined,'../private.png')]){
    let called=false;await assert.rejects(assertPublicationApproved(database,1,async()=>{called=true;}),/RAAD_MEDIA_CHANGED/);assert.equal(called,false);
  }
});
test('oversized and unexpected content types fail closed',async()=>{
  for(const content of [{...image(original),size:5*1024*1024+1},{...image(original),contentType:'text/html'},image(Buffer.alloc(5*1024*1024+1))])await assert.rejects(assertPublicationApproved(q(),1,async()=>content),/RAAD_MEDIA_CHANGED/);
});
test('unavailable storage yields a safe editorial failure without echoing diagnostics',async()=>{
  await assert.rejects(assertPublicationApproved(q(),1,async()=>{throw Error('private storage detail');}),error=>error.message==='RAAD_MEDIA_CHANGED');
});
test('unchanged continuous legacy publication does not pretend to have a new media approval',async()=>{
  let fetched=false;await assertPublicationApproved(q({state:'legacy'}),1,async()=>{fetched=true;});assert.equal(fetched,false);
});
test('safe UI errors distinguish stale review, legacy edits and missing gate schema',()=>{
  assert.equal(publicationFailure(Error('RAAD_APPROVAL_STALE')).code,'approval_stale');
  assert.equal(publicationFailure(Error('RAAD_PUBLISHED_EDIT_BLOCKED')).code,'published_edit_blocked');
  assert.equal(publicationFailure(Error('RAAD_ARTICLE_ID_IMMUTABLE')).code,'article_identity_locked');
  assert.equal(publicationFailure(Error('function raad_gate.assert_publishable(integer) does not exist')).code,'publication_gate_not_ready');
  assert.equal(publicationFailure(Error('unrelated database failure')),undefined);
});
test('missing wrong insecure or credential-bearing site configuration cannot publish',async()=>{
  for(const site of ['', 'http://example.com','https://other.example','https://user:password@example.com','https://example.com/incorrect-base']){
    let fetched=false;await assert.rejects(assertForSite(q(),1,async()=>{fetched=true;return image(original);},site),/RAAD_SITE_URL_INVALID/);assert.equal(fetched,false);
  }
});
