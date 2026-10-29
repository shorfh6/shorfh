import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Explicit caller-supplied clients, and a fixed disposable cloud marker. Import
// does not connect or install anything; this runner cannot accept production data.
export async function verifyPublicationQueue({admin,web,web2,approver}){
  const marker=(await admin.query('SELECT project_ref FROM raad_staging_verification.installation WHERE singleton')).rows[0];
  assert.equal(marker?.project_ref,'eotfvclpiflwikvqzhqt');
  assert.equal((await admin.query("SELECT count(*)::integer AS n FROM public.articles WHERE title NOT LIKE 'SYNTHETIC %'")).rows[0].n,0,'REFUSE_REAL_ARTICLES');
  assert.equal((await admin.query("SELECT count(*)::integer AS n FROM public.users WHERE email NOT LIKE '%@invalid.example'")).rows[0].n,0,'REFUSE_REAL_USERS');
  const jobs=[],passed=[];let current='install';
  const check=async(name,fn)=>{current=name;await fn();passed.push(name);};
  const hex=()=>randomBytes(32).toString('hex');
  const proof={final_agent:'al-mutamid',decision:'APPROVED',agents:['al-muhaqqiq','al-muharrir','al-musawwir'],media_sha256:'1'.repeat(64),site:'https://shorfh-raad-staging.onrender.com',synthetic:true};
  async function article(){const cat=(await admin.query("SELECT id FROM public.categories WHERE name LIKE 'SYNTHETIC %' LIMIT 1")).rows[0];assert.ok(cat);return(await web.query("INSERT INTO public.articles(title,excerpt,body,image,category_id) VALUES($1,'SYNTHETIC excerpt','SYNTHETIC NOT REAL NEWS','synthetic-staging.png',$2) RETURNING id",['SYNTHETIC queue '+randomUUID(),cat.id])).rows[0].id;}
  async function approval(id,seconds=3600){return(await approver.query('SELECT raad_gate.record_approval($1,raad_gate.article_snapshot($1),$2,$3,$4,clock_timestamp(),$5::jsonb,$6) AS id',[id,hex(),hex(),hex(),JSON.stringify(proof),seconds])).rows[0].id;}
  async function enqueue(id,decision){const job=(await approver.query('SELECT raad_queue.enqueue($1,$2) AS work',[id,decision])).rows[0].work;jobs.push(job.id);await admin.query("UPDATE raad_queue.jobs SET available_at=clock_timestamp()-interval '1 day' WHERE id=$1",[job.id]);return job;}
  async function fixture(){const id=await article(),decision=await approval(id),job=await enqueue(id,decision);return{id,decision,job};}
  const state=async id=>(await web.query('SELECT raad_queue.status($1) AS work',[id])).rows[0].work;
  async function claim(worker,q=web){return(await q.query('SELECT raad_queue.claim($1,120) AS work',[worker])).rows[0].work;}
  async function complete(job,worker,q=web){return(await q.query('SELECT raad_queue.publish($1,$2::bigint,$3) AS work',[job.id,job.fence,worker])).rows[0].work;}
  async function expire(job){await admin.query("UPDATE raad_queue.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);}
  async function cleanup(){for(const id of jobs)await admin.query("SELECT raad_queue._cancel(j,'test_cleanup') FROM raad_queue.jobs j WHERE id=$1 AND state IN('pending','leased','uncertain')",[id]);}
  try{
    await admin.query('BEGIN');try{await admin.query(await readFile(new URL('../../db/raad/publication-queue.sql',import.meta.url),'utf8'));await admin.query('COMMIT');}catch(error){await admin.query('ROLLBACK');throw error;}
    assert.equal((await admin.query("SELECT count(*)::integer AS n FROM raad_queue.jobs WHERE state IN('pending','leased','uncertain')")).rows[0].n,0,'REFUSE_UNOWNED_ACTIVE_TEST_JOBS');
    await check('RLS and privileges separate approver, worker and private ledger',async()=>{
      const rows=(await admin.query("SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='raad_queue' AND c.relkind='r' AND c.relname IN('installation','jobs','outbox','receipts','audit')")).rows;assert.equal(rows.length,5);assert.ok(rows.every(r=>r.relrowsecurity));
      await assert.rejects(web.query('SELECT * FROM raad_queue.jobs'),/permission denied/);
      await assert.rejects(approver.query('SELECT raad_queue.claim($1,120)',[hex()]),/permission denied/);
      await assert.rejects(web.query('SELECT raad_queue.enqueue(1,$1)',[randomUUID()]),/permission denied/);
    });
    await check('enqueue requires exact stored approval and writes one idempotent job and outbox',async()=>{
      const id=await article();await assert.rejects(approver.query('SELECT raad_queue.enqueue($1,$2)',[id,randomUUID()]),/RAAD_QUEUE_APPROVAL_REQUIRED/);
      const decision=await approval(id),job=await enqueue(id,decision);const retry=(await approver.query('SELECT raad_queue.enqueue($1,$2) AS work',[id,decision])).rows[0].work;assert.equal(retry.id,job.id);
      assert.equal((await admin.query('SELECT count(*)::integer AS n FROM raad_queue.outbox WHERE job_id=$1',[job.id])).rows[0].n,1);await cleanup();
    });
    await check('two concurrent workers claim distinct jobs and commit exactly one receipt per job',async()=>{
      const a=await fixture(),b=await fixture(),wa=hex(),wb=hex();const claimed=await Promise.all([claim(wa,web),claim(wb,web2)]);assert.equal(new Set(claimed.map(j=>j.id)).size,2);assert.ok(claimed.every(j=>[a.job.id,b.job.id].includes(j.id)));
      for(const[j,w,q]of[[claimed[0],wa,web],[claimed[1],wb,web2]]){const result=await complete(j,w,q);assert.equal(result.state,'completed');assert.equal((await complete(j,w,q)).receipt.completed_at,result.receipt.completed_at);}
      const retry=(await approver.query('SELECT raad_queue.enqueue($1,$2) AS work',[a.id,a.decision])).rows[0].work;assert.equal(retry.id,a.job.id);assert.equal(retry.state,'completed');
      const binding=(await admin.query('SELECT task_hash,result_hash,policy_hash FROM raad_gate.approvals WHERE id=$1',[a.decision])).rows[0];
      const recovered=(await approver.query('SELECT raad_queue.find_request($1,$2,$3,$4) AS work',[a.id,binding.task_hash,binding.result_hash,binding.policy_hash])).rows[0].work;assert.equal(recovered.id,a.job.id);assert.equal(recovered.state,'completed');
      await assert.rejects(web.query('SELECT raad_queue.find_request($1,$2,$3,$4)',[a.id,binding.task_hash,binding.result_hash,binding.policy_hash]),/permission denied/);
    });
    await check('publication, receipt and job completion roll back together',async()=>{
      const f=await fixture(),w=hex(),j=await claim(w);assert.equal(j.id,f.job.id);
      await web.query('BEGIN');try{await complete(j,w);assert.equal((await web.query('SELECT status FROM public.articles WHERE id=$1',[f.id])).rows[0].status,'published');}finally{await web.query('ROLLBACK');}
      assert.equal((await web.query('SELECT status FROM public.articles WHERE id=$1',[f.id])).rows[0].status,'draft');assert.equal((await state(j.id)).receipt,null);await cleanup();
    });
    await check('changed draft cancels the queued revision before publication',async()=>{
      const f=await fixture();await web.query("UPDATE public.articles SET body='SYNTHETIC changed after review' WHERE id=$1",[f.id]);assert.equal(await claim(hex()),null);assert.equal((await state(f.job.id)).state,'cancelled');
    });
    await check('expired lease cannot renew or complete',async()=>{
      const f=await fixture(),w=hex(),j=await claim(w);await expire(j);
      await assert.rejects(web.query('SELECT raad_queue.renew($1,$2::bigint,$3,120)',[j.id,j.fence,w]),/RAAD_QUEUE_STALE_LEASE/);await assert.rejects(complete(j,w),/RAAD_QUEUE_STALE_LEASE/);await cleanup();
    });
    await check('lease time is rechecked after waiting for a row lock',async()=>{
      const f=await fixture(),w=hex(),j=await claim(w);await admin.query('BEGIN');await admin.query('SELECT 1 FROM raad_queue.jobs WHERE id=$1 FOR UPDATE',[j.id]);
      const waiting=complete(j,w,web2).then(()=>null,error=>error);
      try{await new Promise(resolve=>setTimeout(resolve,100));await admin.query("UPDATE raad_queue.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[j.id]);await admin.query('COMMIT');assert.match((await waiting).message,/RAAD_QUEUE_STALE_LEASE/);}finally{await admin.query('ROLLBACK');}await cleanup();
    });
    await check('unknown outcome reconciles before retry and fences the old owner',async()=>{
      const f=await fixture(),old=hex(),j=await claim(old);await web.query('SELECT raad_queue.uncertain($1,$2::bigint,$3)',[j.id,j.fence,old]);assert.equal((await state(j.id)).state,'uncertain');
      await claim(hex());assert.equal((await state(j.id)).state,'pending');await admin.query("UPDATE raad_queue.jobs SET available_at=clock_timestamp()-interval '1 day' WHERE id=$1",[j.id]);const next=await claim(hex());assert.equal(next.fence,'2');await assert.rejects(complete(j,old),/RAAD_QUEUE_STALE_LEASE/);await cleanup();
    });
    await check('known failures have bounded attempts and end in dead-letter state',async()=>{
      const f=await fixture();for(let n=1;n<=3;n++){const w=hex(),j=await claim(w);assert.equal(j.id,f.job.id);await web.query("SELECT raad_queue.fail($1,$2::bigint,$3,'media_unavailable')",[j.id,j.fence,w]);if(n<3)await admin.query("UPDATE raad_queue.jobs SET available_at=clock_timestamp()-interval '1 day' WHERE id=$1",[j.id]);}
      const final=await state(f.job.id);assert.equal(final.attempts,3);assert.equal(final.state,'dead');assert.equal(final.receipt,null);
    });
    await check('manual approved publication reconciles instead of publishing twice',async()=>{
      const f=await fixture();await web.query("UPDATE public.articles SET status='published' WHERE id=$1",[f.id]);assert.equal(await claim(hex()),null);const result=await state(f.job.id);assert.equal(result.state,'completed');assert.equal(result.receipt.kind,'reconciled');
    });
    await check('withdrawing a published article cancels its pending worker lease',async()=>{
      const f=await fixture(),w=hex(),j=await claim(w);await web.query("UPDATE public.articles SET status='published' WHERE id=$1",[f.id]);await web.query("UPDATE public.articles SET status='draft' WHERE id=$1",[f.id]);assert.equal((await state(j.id)).state,'cancelled');await assert.rejects(complete(j,w),/RAAD_QUEUE_STALE_LEASE/);
    });
    await check('deleting an article preserves audit and cancels the queued job',async()=>{
      const f=await fixture();await web.query('DELETE FROM public.articles WHERE id=$1',[f.id]);assert.equal((await state(f.job.id)).state,'cancelled');
    });
    await check('fencing tokens remain exact beyond JavaScript safe integers',async()=>{
      const f=await fixture();await admin.query('UPDATE raad_queue.jobs SET fence=9007199254740992 WHERE id=$1',[f.job.id]);const w=hex(),j=await claim(w);assert.equal(j.fence,'9007199254740993');await complete(j,w);
    });
    await check('review expiry cancels the queued publication',async()=>{
      const id=await article(),decision=await approval(id,1),j=await enqueue(id,decision);await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(await claim(hex()),null);assert.equal((await state(j.id)).state,'cancelled');
    });
    await check('job binding and append-only ledger cannot be rewritten',async()=>{
      const f=await fixture();await assert.rejects(admin.query('UPDATE raad_queue.jobs SET article_id=-1 WHERE id=$1',[f.job.id]),/RAAD_QUEUE_IMMUTABLE_JOB/);await assert.rejects(admin.query("UPDATE raad_queue.audit SET event='rewritten' WHERE job_id=$1",[f.job.id]),/RAAD_IMMUTABLE_REVIEW/);await assert.rejects(admin.query('TRUNCATE raad_queue.outbox'),/RAAD_TRUNCATE_BLOCKED/);await cleanup();
    });
    return{projectRef:marker.project_ref,synthetic:true,passed:passed.length,failed:0,tests:passed,productionTouched:false};
  }catch(error){const failure=new Error('QUEUE_INTEGRATION_FAILED');failure.phase=current;failure.code=error.code;failure.safeMessage=error.message.replace(/RaaD!9[a-f0-9]{64}/g,'[redacted]');failure.passed=passed.length;throw failure;}
  finally{await cleanup();}
}
