import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Deliberately separate from the offline *.test.mjs suite and all cloud endpoints.
const ENDPOINT = 'postgresql://raad_test@127.0.0.1:55439/raad_gate_test';
assert.deepEqual(process.argv.slice(2), ['--connection-url', ENDPOINT, '--execute-synthetic']);
const pool = new pg.Pool({ connectionString: ENDPOINT, max: 5, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
const proof = { final_agent: 'al-mutamid', decision: 'APPROVED', agents: ['al-muhaqqiq', 'al-muharrir', 'al-musawwir'], media_sha256: '1'.repeat(64), site:'https://synthetic.example', synthetic: true };
const hash = () => randomUUID().replaceAll('-', '').repeat(2);
const tests = [];
let current = 'isolated-database-preflight';
const test = async (name, fn) => { current = name; await fn(); tests.push(name); };
async function transaction(fn, role) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); if (role) await c.query(`SET LOCAL ROLE ${role}`); const result = await fn(c); await c.query('COMMIT'); return result; }
  catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
  finally { c.release(); }
}
async function article(status = 'draft') {
  const suffix = randomUUID();
  return transaction(async c => {
    const { rows: [u] } = await c.query("INSERT INTO public.users(name,email,password_hash,role) VALUES($1,$2,'SYNTHETIC-NOT-A-PASSWORD','editor') RETURNING id", ['SYNTHETIC '+suffix, suffix+'@invalid.example']);
    const { rows: [cat] } = await c.query('INSERT INTO public.categories(name,slug) VALUES($1,$2) RETURNING id', ['SYNTHETIC '+suffix, 'synthetic-'+suffix]);
    const { rows: [tag] } = await c.query('INSERT INTO public.tags(name) VALUES($1) RETURNING id', ['SYNTHETIC '+suffix]);
    const { rows: [a] } = await c.query(`INSERT INTO public.articles(title,excerpt,body,image,category_id,author_id,status,source_url,published_at)
      VALUES($1,'SYNTHETIC description','SYNTHETIC NOT REAL NEWS https://example.com/reference','synthetic-original.png',$2,$3,$4,'https://example.com/reference',CASE WHEN $4='published' THEN clock_timestamp()-interval '2 days' ELSE NULL END) RETURNING *`, ['SYNTHETIC '+suffix, cat.id, u.id, status]);
    await c.query('INSERT INTO public.article_tags(article_id,tag_id) VALUES($1,$2)', [a.id, tag.id]);
    return { ...a, tagId: tag.id };
  });
}
async function approve(id, seconds = 86400, q = pool, customProof = proof) {
  return (await q.query(`SELECT raad_gate.record_approval($1,raad_gate.article_snapshot($1),$2,$3,$4,clock_timestamp(),$5::jsonb,$6) AS id`,
    [id, hash(), hash(), hash(), JSON.stringify(customProof), seconds])).rows[0].id;
}
const publish = (id, q = pool) => q.query("UPDATE public.articles SET status='published',published_at=COALESCE(published_at,clock_timestamp()) WHERE id=$1", [id]);
const state = async id => (await pool.query('SELECT * FROM public.articles WHERE id=$1', [id])).rows[0];
try {
  const { rows: [where] } = await pool.query("SELECT current_database() AS db,current_user AS role,current_setting('data_directory') AS directory,inet_server_port() AS port");
  assert.equal(where.db, 'raad_gate_test'); assert.equal(where.role, 'raad_test'); assert.equal(where.port, 55439);
  assert.match(where.directory.replaceAll('\\','/'), /\/Temp\/opencode\/raad-pg-data$/i);
  const tables = await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='public'");
  let legacy;
  if (tables.rowCount === 0) {
    await pool.query(await readFile(new URL('../../db/migrations/0001_init.sql', import.meta.url), 'utf8'));
    legacy = await article('published');
  } else {
    assert.equal((await pool.query('SELECT version FROM raad_gate.installation WHERE singleton')).rows[0].version,1);
    assert.equal((await pool.query("SELECT 1 FROM public.articles WHERE title NOT LIKE 'SYNTHETIC %'")).rowCount,0,'REFUSE_REAL_ARTICLES');
    assert.equal((await pool.query("SELECT 1 FROM public.users WHERE email NOT LIKE '%@invalid.example'")).rowCount,0,'REFUSE_REAL_USERS');
    legacy=(await pool.query("SELECT a.* FROM public.articles a JOIN raad_gate.legacy l ON l.article_id=a.id WHERE a.status='published' AND l.revoked_at IS NULL ORDER BY a.id LIMIT 1")).rows[0];
    assert.ok(legacy,'Fresh test database required after the legacy test has completed');
  }
  await transaction(async c => c.query(await readFile(new URL('../../db/raad/publication-gate.sql', import.meta.url), 'utf8')));

  await test('snapshot contains public edition but no credentials or counters', async () => {
    const a = await article(); const s = (await pool.query('SELECT raad_gate.article_snapshot($1) AS snapshot', [a.id])).rows[0].snapshot;
    assert.equal(s.id, a.id); assert.equal(s.author.name.startsWith('SYNTHETIC'), true); assert.equal(s.tags.length, 1);
    for (const key of ['email','password_hash']) assert.equal(JSON.stringify(s).includes('"'+key+'"'), false);
    for (const key of ['views','status','published_at','updated_at']) assert.equal(Object.hasOwn(s,key),false);
  });
  await test('direct published insert and unapproved update fail closed', async () => {
    await assert.rejects(article('published'), /RAAD_SAVE_DRAFT_FIRST/);
    const a = await article(); await assert.rejects(publish(a.id), /RAAD_APPROVAL_REQUIRED/); assert.equal((await state(a.id)).status, 'draft');
  });
  await test('approved exact draft publishes with server time and audit', async () => {
    const a = await article(); await approve(a.id); await publish(a.id);
    assert.equal((await state(a.id)).status, 'published');
    assert.equal((await pool.query("SELECT 1 FROM raad_gate.audit WHERE article_id=$1 AND event='published'", [a.id])).rowCount, 1);
  });
  await test('title body excerpt image source and placement changes invalidate review', async () => {
    for (const [column, value] of [['title','SYNTHETIC changed'],['body','SYNTHETIC changed'],['excerpt','SYNTHETIC changed'],['image','different.png'],['source_url','https://example.com/changed'],['featured',true],['exclusive',true]]) {
      const a = await article(); await approve(a.id); await pool.query(`UPDATE public.articles SET ${column}=$2 WHERE id=$1`, [a.id,value]);
      await assert.rejects(publish(a.id), /RAAD_APPROVAL_STALE/);
    }
  });
  await test('published edits are rejected without removing the old public edition', async () => {
    const a = await article(); await approve(a.id); await publish(a.id);
    await assert.rejects(pool.query('UPDATE public.articles SET body=$2 WHERE id=$1', [a.id,'SYNTHETIC unreviewed']), /RAAD_PUBLISHED_EDIT_BLOCKED/);
    assert.equal((await state(a.id)).body, a.body); assert.equal((await state(a.id)).status, 'published');
  });
  await test('article identity cannot change even without foreign-key links', async () => {
    const a = await article();
    await pool.query('DELETE FROM public.article_tags WHERE article_id=$1', [a.id]);
    await assert.rejects(transaction(c=>c.query('UPDATE public.articles SET id=$2 WHERE id=$1', [a.id,-a.id]),'raad_gate_publisher'), /RAAD_ARTICLE_ID_IMMUTABLE/);
    await approve(a.id); await publish(a.id);
    await assert.rejects(transaction(c=>c.query('UPDATE public.articles SET id=$2 WHERE id=$1', [a.id,-a.id]),'raad_gate_publisher'), /RAAD_ARTICLE_ID_IMMUTABLE/);
    assert.equal((await state(a.id)).status, 'published');
    assert.equal(await state(-a.id), undefined);
  });
  await test('views and unchanged tag synchronization do not invalidate or refresh articles', async () => {
    const a = await article(); await approve(a.id); await publish(a.id); const before = await state(a.id);
    await pool.query('UPDATE public.articles SET views=views+1 WHERE id=$1', [a.id]);
    await transaction(async c => { await c.query('DELETE FROM public.article_tags WHERE article_id=$1', [a.id]); await c.query('INSERT INTO public.article_tags VALUES($1,$2)', [a.id,a.tagId]); });
    const after = await state(a.id); assert.equal(after.views, before.views+1); assert.equal(after.updated_at.toISOString(), before.updated_at.toISOString());
  });
  await test('tags category and author attribution cannot mutate public editions; security suspension remains available', async () => {
    const a = await article(); await approve(a.id); await publish(a.id);
    await assert.rejects(pool.query('UPDATE public.tags SET name=$2 WHERE id=$1', [a.tagId,'SYNTHETIC renamed']), /RAAD_PUBLIC_DEPENDENCY_BLOCKED/);
    await assert.rejects(pool.query('DELETE FROM public.article_tags WHERE article_id=$1', [a.id]), /RAAD_PUBLIC_DEPENDENCY_BLOCKED/);
    await assert.rejects(pool.query('UPDATE public.categories SET name=$2 WHERE id=$1', [a.category_id,'SYNTHETIC renamed']), /RAAD_PUBLIC_DEPENDENCY_BLOCKED/);
    for (const [column,value] of [['name','SYNTHETIC renamed'],['bio','SYNTHETIC changed bio']])
      await assert.rejects(pool.query(`UPDATE public.users SET ${column}=$2 WHERE id=$1`, [a.author_id,value]), /RAAD_PUBLIC_DEPENDENCY_BLOCKED/);
    const before=(await pool.query('SELECT raad_gate.article_snapshot_hash($1) AS hash',[a.id])).rows[0].hash;
    await pool.query("UPDATE public.users SET status='disabled' WHERE id=$1",[a.author_id]);
    assert.equal((await pool.query('SELECT raad_gate.article_snapshot_hash($1) AS hash',[a.id])).rows[0].hash,before);
  });
  await test('dependency checks re-arm after a transaction flushes deferred constraints', async () => {
    const a = await article(); await approve(a.id); await publish(a.id);
    for (const [table,id,column] of [['tags',a.tagId,'name'],['categories',a.category_id,'name'],['users',a.author_id,'bio']]) {
      await assert.rejects(transaction(async c => {
        await c.query(`UPDATE public.${table} SET ${column}=${column} WHERE id=$1`, [id]);
        await c.query('SET CONSTRAINTS ALL IMMEDIATE');
        await c.query(`UPDATE public.${table} SET ${column}=$2 WHERE id=$1`, [id,'SYNTHETIC unreviewed after constraint flush']);
      },'raad_gate_publisher'), /RAAD_PUBLIC_DEPENDENCY_BLOCKED/);
    }
    await assert.rejects(transaction(async c => {
      await c.query('DELETE FROM public.article_tags WHERE article_id=$1', [a.id]);
      await c.query('INSERT INTO public.article_tags VALUES($1,$2)', [a.id,a.tagId]);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      await c.query('SET CONSTRAINTS ALL DEFERRED');
      await c.query('DELETE FROM public.article_tags WHERE article_id=$1', [a.id]);
    },'raad_gate_publisher'), /RAAD_PUBLIC_DEPENDENCY_BLOCKED/);
    const draft = await article();
    await transaction(async c => {
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      for (const name of ['SYNTHETIC first allowed draft change','SYNTHETIC second allowed draft change']) {
        await c.query('UPDATE public.tags SET name=$2 WHERE id=$1', [draft.tagId,name]);
      }
    },'raad_gate_publisher');
    assert.equal((await pool.query('SELECT raad_gate.article_snapshot($1) AS snapshot',[draft.id])).rows[0].snapshot.tags[0].name,'SYNTHETIC second allowed draft change');
  });
  await test('expired revoked and malformed approvals cannot authorize publication', async () => {
    const a = await article(); const id = await approve(a.id); await pool.query("SELECT raad_gate.revoke_approval($1,'SYNTHETIC revocation')", [id]);
    await assert.rejects(publish(a.id), /RAAD_APPROVAL_STALE/);
    await assert.rejects(approve(a.id,86400,pool,{...proof,final_agent:'al-muharrir'}), /RAAD_REVIEW_INCOMPLETE/);
    const b = await article(); await approve(b.id,1); await pool.query('SELECT pg_sleep(1.1)'); await assert.rejects(publish(b.id), /RAAD_APPROVAL_STALE/);
  });
  await test('approval snapshots and audit are immutable', async () => {
    const a = await article(); const id = await approve(a.id);
    await assert.rejects(pool.query("UPDATE raad_gate.approvals SET approved_at=clock_timestamp()-interval '1 day' WHERE id=$1", [id]), /RAAD_IMMUTABLE_REVIEW/);
    await assert.rejects(pool.query('DELETE FROM raad_gate.approvals WHERE id=$1', [id]), /RAAD_IMMUTABLE_REVIEW/);
    await assert.rejects(pool.query("UPDATE raad_gate.audit SET event='forged' WHERE article_id=$1", [a.id]), /RAAD_IMMUTABLE_REVIEW/);
  });
  await test('approval created after an attempted publication cannot backdate authorization', async () => {
    const a = await article();
    await assert.rejects(transaction(async c => {
      await publish(a.id,c); await c.query("UPDATE public.articles SET status='draft' WHERE id=$1", [a.id]);
      await approve(a.id,86400,c); await publish(a.id,c);
    }), /RAAD_APPROVAL_MUST_PRECEDE_PUBLICATION/);
    assert.equal((await state(a.id)).status, 'draft');
  });
  await test('publisher cannot mint approvals and approver cannot publish', async () => {
    const a = await article();
    await assert.rejects(transaction(c=>approve(a.id,86400,c),'raad_gate_publisher'), /permission denied/);
    await assert.rejects(transaction(c=>c.query('DELETE FROM raad_gate.approvals'),'raad_gate_publisher'), /permission denied/);
    await approve(a.id);
    await assert.rejects(transaction(c=>publish(a.id,c),'raad_gate_approver'), /permission denied/);
    await transaction(c=>publish(a.id,c),'raad_gate_publisher'); assert.equal((await state(a.id)).status,'published');
  });
  await test('publication and concurrent dependency changes serialize without write skew', async () => {
    const a = await article(); await approve(a.id); const first = await pool.connect(), second = await pool.connect();
    try {
      await first.query('BEGIN'); await publish(a.id,first);
      const pending = second.query('UPDATE public.tags SET name=$2 WHERE id=$1', [a.tagId,'SYNTHETIC race']).then(()=>null,e=>e);
      let blocked=false; for(let i=0;i<20;i++){const r=await pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[second.processID]);if(r.rows[0].blocked){blocked=true;break;}await pool.query('SELECT pg_sleep(0.01)');}
      assert.equal(blocked,true); await first.query('COMMIT'); assert.match((await pending).message,/RAAD_PUBLIC_DEPENDENCY_BLOCKED/);
    } finally { await first.query('ROLLBACK'); first.release(); second.release(); }
  });
  await test('publication and creation times cannot be rewritten and truncate is blocked', async () => {
    const a = await article(); await approve(a.id); await publish(a.id);
    await assert.rejects(pool.query("UPDATE public.articles SET published_at=clock_timestamp()+interval '1 day' WHERE id=$1",[a.id]),/RAAD_PUBLICATION_DATE_IMMUTABLE/);
    await assert.rejects(pool.query("UPDATE public.articles SET created_at=clock_timestamp() WHERE id=$1",[a.id]),/RAAD_CREATION_DATE_IMMUTABLE/);
    await assert.rejects(pool.query('TRUNCATE public.article_tags'),/RAAD_TRUNCATE_BLOCKED/);
  });
  await test('installation rejects an existing group that owns a protected table', async () => {
    const sql = await readFile(new URL('../../db/raad/publication-gate.sql', import.meta.url), 'utf8');
    for (const role of ['raad_gate_publisher','raad_gate_approver']) {
      await assert.rejects(transaction(async c => {
        await c.query(`ALTER TABLE public.articles OWNER TO ${role}`);
        await c.query(sql);
      }), /RAAD_ROLE_CONFLICT/);
    }
    assert.equal((await pool.query("SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='articles'")).rows[0].tableowner,'raad_test');
  });
  await test('legacy is unreviewed baseline only and republishing requires a new review', async () => {
    assert.equal((await pool.query('SELECT raad_gate.approval_status($1) AS state',[legacy.id])).rows[0].state.state,'legacy');
    assert.equal((await pool.query('SELECT 1 FROM raad_gate.approvals WHERE article_id=$1',[legacy.id])).rowCount,0);
    await pool.query('UPDATE public.articles SET views=views+1 WHERE id=$1',[legacy.id]);
    await pool.query("UPDATE public.articles SET status='draft' WHERE id=$1",[legacy.id]);
    await assert.rejects(publish(legacy.id),/RAAD_APPROVAL_REQUIRED/);
    await approve(legacy.id); await publish(legacy.id); assert.equal((await state(legacy.id)).published_at.toISOString(),legacy.published_at.toISOString());
  });
  console.log(JSON.stringify({synthetic:true,database:'raad_gate_test',passed:tests.length,failed:0,tests}));
} catch(error) {
  console.log(JSON.stringify({synthetic:true,passed:tests.length,failed:1,failedTest:current,code:error.code??'GATE_TEST_FAILED',message:error.message}));
  process.exitCode=1;
} finally { await pool.end(); }
