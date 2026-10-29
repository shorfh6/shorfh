import test from 'node:test';
import assert from 'node:assert/strict';
import {runPublicationTick,workerAuthorized,resolveWorkerAccess} from '../../lib/publication-worker.mjs';

const worker='1'.repeat(64),job={id:'synthetic-job',articleId:1,fence:'9007199254740993',state:'leased'};
function fixture(){const calls=[];const adapter={claim:async w=>{calls.push(['claim',w]);return job;},publish:async(j,w)=>{calls.push(['publish',j,w]);return{...j,state:'completed'};},fail:async(j,w,reason)=>{calls.push(['fail',j,w,reason]);return{...j,state:'pending'};},uncertain:async(j,w)=>{calls.push(['uncertain',j,w]);return{...j,state:'uncertain'};}};return{adapter,calls};}

test('worker credentials require a configured strong exact secret',()=>{
  const secret='SYNTHETIC-WORKER-SECRET-NOT-A-REAL-KEY';
  assert.equal(workerAuthorized(secret,secret),true);
  for(const[value,expected]of [[null,secret],['',secret],['wrong',secret],[secret,undefined],[secret,'short'],[secret+'x',secret]])assert.equal(workerAuthorized(value,expected),false);
});
test('one tick preserves the string fencing token and returns committed receipt',async()=>{
  const{adapter,calls}=fixture();const result=await runPublicationTick(adapter,worker);
  assert.equal(result.state,'completed');assert.deepEqual(calls,[['claim',worker],['publish',job,worker]]);
});
test('empty queue performs no publication, retry or model calls',async()=>{
  const{adapter,calls}=fixture();adapter.claim=async()=>null;assert.deepEqual(await runPublicationTick(adapter,worker),{state:'idle'});assert.deepEqual(calls,[]);
});
test('stale worker never records a new failure against a newer owner',async()=>{
  const{adapter,calls}=fixture();adapter.publish=async()=>{throw Error('RAAD_QUEUE_STALE_LEASE');};assert.deepEqual(await runPublicationTick(adapter,worker),{state:'lease_lost',id:job.id});assert.equal(calls.length,1);
});
test('image failures use bounded durable retries',async()=>{
  const{adapter,calls}=fixture();adapter.publish=async()=>{throw Error('RAAD_MEDIA_CHANGED');};await runPublicationTick(adapter,worker);assert.equal(calls[1][0],'fail');assert.equal(calls[1][3],'media_unavailable');
});
test('changed expired missing or wrong-site approvals cancel the job',async()=>{
  for(const code of ['RAAD_APPROVAL_STALE','RAAD_APPROVAL_REQUIRED','RAAD_SITE_URL_INVALID','RAAD_QUEUE_APPROVAL_STALE']){const{adapter,calls}=fixture();adapter.publish=async()=>{throw Error(code);};await runPublicationTick(adapter,worker);assert.equal(calls[1][3],'stale_approval');}
});
test('unclassified or commit failures reconcile rather than blindly retrying',async()=>{
  const{adapter,calls}=fixture();adapter.publish=async()=>{throw Error('private database detail');};const result=await runPublicationTick(adapter,worker);assert.equal(result.state,'uncertain');assert.equal(calls[1][0],'uncertain');assert.equal(JSON.stringify(result).includes('private'),false);
});
test('uncertain response can recover an already-committed database receipt',async()=>{
  const{adapter}=fixture();adapter.publish=async()=>{throw Error('connection lost after COMMIT');};adapter.uncertain=async()=>({...job,state:'completed',receipt:{article_id:1}});assert.equal((await runPublicationTick(adapter,worker)).state,'completed');
});
test('failed reconciliation preserves uncertainty without leaking diagnostics',async()=>{
  const{adapter}=fixture();adapter.publish=async()=>{throw Error('private transport');};adapter.uncertain=async()=>{throw Error('private credential');};assert.deepEqual(await runPublicationTick(adapter,worker),{state:'uncertain',id:job.id});
});
test('invalid worker identity is rejected before accessing the queue',async()=>{
  const{adapter,calls}=fixture();await assert.rejects(runPublicationTick(adapter,'not-a-hash'),/RAAD_QUEUE_ARGUMENTS/);assert.deepEqual(calls,[]);
});
test('unauthenticated requests cannot trigger secret/configuration database reads',async()=>{
  let read=false;assert.deepEqual(await resolveWorkerAccess(null,{},async()=>{read=true;}),{authorized:false,enabled:false});assert.equal(read,false);
});
test('configured environment identity never silently falls back to another credential',async()=>{
  let read=false;const value='SYNTHETIC-worker-request-key-000000';const access=await resolveWorkerAccess(value,{RAAD_WORKER_SECRET:'short',RAAD_WORKER_ENABLED:'true'},async()=>{read=true;return{secret:value,enabled:true};});assert.equal(access.authorized,false);assert.equal(read,false);
});
test('Vault-backed runtime key and enable state are resolved without returning the key',async()=>{
  const key='SYNTHETIC-worker-request-key-000000';assert.deepEqual(await resolveWorkerAccess(key,{},async()=>({secret:key,enabled:true})),{authorized:true,enabled:true});
});
test('paused Vault configuration permits authenticated disabled response but no tick',async()=>{
  const key='SYNTHETIC-worker-request-key-000000';assert.deepEqual(await resolveWorkerAccess(key,{},async()=>({secret:key,enabled:false})),{authorized:true,enabled:false});
});
test('missing stored configuration fails closed',async()=>{
  assert.deepEqual(await resolveWorkerAccess('SYNTHETIC-worker-request-key-000000',{},async()=>null),{authorized:false,enabled:false});
});
