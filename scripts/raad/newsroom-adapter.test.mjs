import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { createNewsroomAdapters, safePowerShell, STAGING_PROJECT, ORIGINAL_CAPTION } from './newsroom-adapter.mjs';
import { contentHash } from './envelope.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
const now = '2026-10-30T10:00:00.000Z';
function png() {
  const crc = data => { let n = 0xffffffff; for (const b of data) { n ^= b; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (type, data = Buffer.alloc(0)) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; };
  const h = Buffer.alloc(13); h.writeUInt32BE(1200); h.writeUInt32BE(675, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', h), chunk('IDAT', deflateSync(Buffer.alloc(675 * 4801))), chunk('IEND')]);
}

function fixture(t, options = {}) {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-adapter-offline-'));
  t.after(() => fs.rmSync(projectDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const runtimeDirectory = path.join(projectDirectory, '.raad-local', 'newsroom-staging');
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  fs.mkdirSync(path.join(projectDirectory, 'scripts', 'raad'), { recursive: true });
  fs.writeFileSync(path.join(projectDirectory, 'scripts', 'raad', 'create-news-card.ps1'), '# OFFLINE TEST ONLY');
  const site = 'https://shorfh-raad-staging.onrender.com', source = 'https://www.okaz.com.sa/local/na/2222222';
  const sourceKey = digest('okaz\n' + source), notice = { url: source };
  let article = null, snapshot = null, media = null;
  const sql = [], requests = [], categories = [{ id: 1, name: 'Offline category', slug: 'offline' }];
  const client = { query: async (query, values = []) => {
    sql.push({ query, values });
    if (query.includes('worker_configuration')) return { rows: [{ configuration: { enabled: true, secret: 'OFFLINE-ONLY-MEMORY-KEY' } }] };
    if (query.includes('SELECT id,source_url,status')) return { rows: article ? [{ ...article }] : [] };
    if (query.includes('SELECT id,name,slug')) return { rows: categories };
    if (query.includes('article_snapshot')) return { rows: [{ snapshot: structuredClone(snapshot) }] };
    if (query.includes('SELECT id,status,source_url')) return { rows: article ? [{ ...article }] : [] };
    if (query.startsWith('INSERT INTO public.articles')) {
      article = { id: 7001, status: 'draft', source_url: values[4] };
      snapshot = { version: 1, id: 7001, title: values[0], excerpt: values[1], body: values[2], image: '', category: categories[0], author: null, tags: [], sourceUrl: values[4], featured: false, exclusive: false, createdAt: now };
      return { rows: [{ id: 7001 }] };
    }
    if (query.startsWith('UPDATE public.articles')) {
      snapshot = { ...snapshot, title: values[0], excerpt: values[1], body: values[2], image: '', category: categories.find(c => c.id === values[3]), tags: [] };
      return { rows: [{ id: 7001 }] };
    }
    return { rows: [] };
  } };
  const config = { mode: 'staging', site, projectRef: STAGING_PROJECT, projectDirectory, runtimeDirectory, now: () => now,
    withClient: (kind, callback) => callback(client, { tlsAuthorized: true, projectRef: STAGING_PROJECT, role: `raad_stage_${kind}` }),
    powershell: async script => {
      assert.equal(script.includes('ScriptBlock'), true);
      const file = script.match(/-OutputFile '([^']+)'$/)[1];
      fs.writeFileSync(file, png());
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      assert.equal(init.redirect, 'error');
      assert.equal(url, site + '/api/raad/media');
      assert.equal(init.headers['x-raad-worker-key'], 'OFFLINE-ONLY-MEMORY-KEY');
      assert.equal(init.headers['x-raad-article-id'], '7001');
      if (init.method === 'POST') {
        media = Buffer.from(init.body);
        const sha256 = digest(media), imageName = `raad-7001-${sha256.slice(0,24)}.png`;
        snapshot.image = imageName;
        return Response.json({ articleId: 7001, imageName, sha256, bytes: media.length });
      }
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
      return new Response(media, { headers: { 'content-type': 'image/png' } });
    }, ...options,
  };
  const adapters = createNewsroomAdapters(config);
  const context = { sourceKey, notice, operationId: `${sourceKey}:1:reserve` };
  const edited = { title: 'خبر اصطناعي للاختبار فقط', excerpt: 'موجز قصير.', body: `حقيقة موجزة للاختبار فقط.\n\n${source}\n\n${ORIGINAL_CAPTION}`, seoTitle: 'خبر اصطناعي للاختبار فقط', metaDescription: 'موجز قصير.', categoryId: 1, tagNames: [], claimMap: [{ claimId: 'c1' }] };
  const reserve = () => adapters.reserveDraft(context);
  const prepare = () => adapters.prepareMediaAndDraft({ ...context, operationId: `${sourceKey}:5:prepare`, articleId: 7001, edited });
  const preflight = prepared => adapters.preflight({ ...context, articleId: 7001, prepared });
  return { config, adapters, context, reserve, prepare, preflight, edited, requests, sql, runtimeDirectory,
    get snapshot() { return snapshot; }, get article() { return article; }, setArticle(row) { article = row; } };
}

test('offline adapter reserves real-schema draft, generates/uploads card and verifies exact snapshot/image preflight', async t => {
  const f = fixture(t);
  const reserved = await f.reserve();
  assert.equal(reserved.articleId, 7001); assert.equal(reserved.originalIllustrationCaption, ORIGINAL_CAPTION);
  const prepared = await f.prepare();
  assert.equal(prepared.publicationSnapshot.title, f.edited.title);
  assert.equal(prepared.publicationCandidate.seoTitle, f.edited.title);
  assert.equal(prepared.originalMediaProof.width, 1200);
  assert.equal(prepared.originalMediaProof.height, 675);
  const proof = await f.preflight(prepared);
  assert.equal(proof.sourceUnique, true); assert.equal(proof.snapshotHash, contentHash(f.snapshot));
  assert.equal(proof.imageSha256, prepared.publicationCandidate.imageLocalSha256);
  assert.equal(f.requests.filter(r => r.init.method === 'GET').length, 2);
  assert.equal(f.requests.some(r => r.url.includes('/uploads/')), false);
  const lock = f.sql.findIndex(s => s.query.includes('lock_publication_scope'));
  const sourceLock = f.sql.findIndex(s => s.query.includes('hashtextextended'));
  const insert = f.sql.findIndex(s => s.query.startsWith('INSERT INTO public.articles'));
  assert.ok(lock < sourceLock && sourceLock < insert);
  assert.match(f.sql[insert].query, /'draft',false,false/);
  assert.equal(f.sql.some(s => s.query.includes("status='published'")), false);
  for (const file of fs.readdirSync(f.runtimeDirectory)) assert.equal(fs.readFileSync(path.join(f.runtimeDirectory, file), 'utf8').includes('OFFLINE-ONLY-MEMORY-KEY'), false);
  assert.equal(JSON.stringify({ reserved, prepared, proof }).includes('OFFLINE-ONLY-MEMORY-KEY'), false);
});

test('reserve recovers exact owned draft without inserting a second row', async t => {
  const f = fixture(t); await f.reserve(); const next = await f.reserve();
  assert.equal(next.articleId, 7001);
  assert.equal(f.sql.filter(s => s.query.startsWith('INSERT INTO public.articles')).length, 1);
});

test('all existing articles are compared by canonical source URL, including tracking variants', async t => {
  const f = fixture(t); f.setArticle({ id: 88, source_url: f.context.notice.url + '?utm_source=other', status: 'published' });
  assert.deepEqual(await f.reserve(), { duplicate: true });
  assert.equal(f.sql.some(s => s.query.startsWith('INSERT INTO public.articles')), false);
});

test('unowned or manually changed draft is never overwritten', async t => {
  const f = fixture(t); await f.reserve(); f.snapshot.body = 'User changed this';
  await assert.rejects(f.prepare(), /NEWSROOM_ADAPTER_DRAFT_CHANGED/);
  assert.equal(f.sql.some(s => s.query.startsWith('UPDATE public.articles')), false);
  assert.equal(f.requests.length, 0);
});

test('wrong database project/role/TLS identity is rejected before SQL', async t => {
  for (const identity of [{ projectRef: 'wrong', role: 'raad_stage_web', tlsAuthorized: true }, { projectRef: STAGING_PROJECT, role: 'postgres', tlsAuthorized: true }, { projectRef: STAGING_PROJECT, role: 'raad_stage_web', tlsAuthorized: false }]) {
    const f = fixture(t, { withClient: (kind, callback) => callback({ query: () => { throw Error('SQL should not run'); } }, identity) });
    await assert.rejects(f.reserve(), /NEWSROOM_ADAPTER_DATABASE_IDENTITY/);
  }
});

test('production/staging targets cannot be mixed or insecure', t => {
  const f = fixture(t);
  for (const config of [{ ...f.config, mode: 'production' }, { ...f.config, site: 'http://offline.invalid' }, { ...f.config, site: 'https://www.shurfh.com' }]) assert.throws(() => createNewsroomAdapters(config), /NEWSROOM_ADAPTER_/);
});

test('live clock is measured, scoped, refreshed and requires actual reviewer read and actual decision time', async t => {
  const f = fixture(t); await f.reserve(); const prepared = await f.prepare(); const preflight = await f.preflight(prepared);
  const task = { agent: 'al-mutamid', input: { articleId: 7001, reviewClock: preflight.reviewClock } };
  const file = path.join(f.config.projectDirectory, preflight.reviewClock.clockReadPath);
  assert.equal(fs.existsSync(file), false);
  const callback = async () => {
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).observedUtc, now);
    const proofPath = process.platform === 'win32' ? file.toUpperCase() : file;
    return { result: { status: 'completed', decision: { reviewedAt: now } }, reviewProof: { documentReadCounts: { [proofPath]: 1 } } };
  };
  assert.equal((await f.adapters.withReviewClock(task, callback)).result.decision.reviewedAt, now);
  assert.equal(fs.existsSync(file), false);
  await assert.rejects(f.adapters.withReviewClock(task, async () => ({ ...await callback(), reviewProof: { documentReadCounts: {} } })), /CLOCK_READ_REQUIRED/);
  assert.equal(fs.existsSync(file), false);
  await assert.rejects(f.adapters.withReviewClock(task, async () => ({ ...await callback(), result: { status: 'completed', decision: { reviewedAt: '2020-01-01T00:00:00Z' } } })), /DECISION_CLOCK_MISMATCH/);
  assert.equal(fs.existsSync(file), false);
});

test('clock cleanup runs on transport failure and preserves pre-existing files', async t => {
  const f = fixture(t); await f.reserve(); const prepared = await f.prepare(); const preflight = await f.preflight(prepared);
  const task = { agent: 'al-mutamid', input: { articleId: 7001, reviewClock: preflight.reviewClock } };
  const file = path.join(f.config.projectDirectory, preflight.reviewClock.clockReadPath);
  await assert.rejects(f.adapters.withReviewClock(task, async () => { throw Error('CLI_TIMEOUT'); }), /CLI_TIMEOUT/);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, 'Existing file is not owned by this review');
  await assert.rejects(f.adapters.withReviewClock(task, async () => { assert.fail('Must not dispatch'); }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'Existing file is not owned by this review');
});

test('draft image readback retains explicit staging authentication and rejects failed reads without leaking keys', async t => {
  const f = fixture(t, { requestHeaders: async () => ({ authorization: 'Basic OFFLINE-PREVIEW-ONLY' }) });
  await f.reserve(); await f.prepare();
  for (const request of f.requests) assert.equal(request.init.headers.authorization, 'Basic OFFLINE-PREVIEW-ONLY');
  const bad = createNewsroomAdapters({ ...f.config, fetchImpl: async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(url.endsWith('/api/raad/media'), true);
    assert.equal(init.headers['x-raad-worker-key'], 'OFFLINE-ONLY-MEMORY-KEY');
    return new Response('not found', { status: 404, headers: { 'content-type': 'image/png' } });
  } });
  // Use the same owned snapshot; only the authenticated read transport fails.
  const preparedOwner = JSON.parse(fs.readFileSync(path.join(f.runtimeDirectory, `owner-${f.context.sourceKey}.json`), 'utf8'));
  const prepared = { publicationSnapshot: f.snapshot, publicationCandidate: { imageLocalSha256: preparedOwner.media.sha256 },
    originalMediaProof: Object.fromEntries(Object.entries(preparedOwner.media).filter(([k]) => k !== 'imageName')) };
  await assert.rejects(bad.preflight({ ...f.context, articleId: 7001, prepared }), error => error.message === 'NEWSROOM_ADAPTER_HTTP_FAILED' && !String(error).includes('OFFLINE-ONLY-MEMORY-KEY'));
});

test('deterministic draft image name must bind the requested article before readback', async t => {
  const f = fixture(t); await f.reserve(); const prepared = await f.prepare();
  const ownerFile = path.join(f.runtimeDirectory, `owner-${f.context.sourceKey}.json`);
  const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  const wrongName = f.snapshot.image.replace('raad-7001-', 'raad-7002-');
  f.snapshot.image = wrongName; prepared.publicationSnapshot.image = wrongName; prepared.publicationCandidate.imageName = wrongName;
  owner.snapshot.image = wrongName; fs.writeFileSync(ownerFile, JSON.stringify(owner));
  const count = f.requests.length;
  await assert.rejects(f.preflight(prepared), /NEWSROOM_ADAPTER_IMAGE_NAME/);
  assert.equal(f.requests.length, count);
});

test('preflight rejects changed draft, local image, remote image and provenance', async t => {
  for (const mutation of ['draft', 'local', 'remote', 'provenance']) {
    const f = fixture(t); await f.reserve(); const prepared = await f.prepare();
    if (mutation === 'draft') f.snapshot.body += ' unreviewed';
    if (mutation === 'local') fs.appendFileSync(path.join(f.config.projectDirectory, prepared.originalMediaProof.localPath), 'changed');
    if (mutation === 'remote') {
      f.config.fetchImpl = async () => new Response(png(), { headers: { 'content-type': 'image/png' } });
      // Replace with a different valid PNG byte stream (different zlib level).
      const other = Buffer.from(png()); other[other.length - 1] ^= 1;
      f.adapters = createNewsroomAdapters({ ...f.config, fetchImpl: async () => new Response(other, { headers: { 'content-type': 'image/png' } }) });
    }
    if (mutation === 'provenance') prepared.originalMediaProof.sha256 = '0'.repeat(64);
    await assert.rejects(() => f.adapters.preflight({ ...f.context, articleId: 7001, prepared }));
  }
});

test('encoded PowerShell invocation has no shell/File execution and never exposes captured stderr', async () => {
  let observed;
  await safePowerShell('trusted-script-only', { spawnProcess: (exe, args, options) => {
    observed = { exe, args, options };
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => child.emit('close', 0)); return child;
  } });
  assert.equal(observed.exe, 'powershell.exe'); assert.equal(observed.options.shell, false);
  assert.equal(observed.args.includes('-File'), false); assert.equal(observed.args.includes('-EncodedCommand'), true);
  assert.match(Buffer.from(observed.args.at(-1), 'base64').toString('utf16le'), /trusted-script-only/);
});

test('short factual story is accepted without minimum word padding', async () => {
  const { adoptEditing } = await import('./newsroom-content.mjs');
  const title = 'عنوان خبر قصير أصيل';
  const p = { title, excerpt: 'موجز.', body: 'حقيقتان مثبتتان فقط.', seoTitle: title, metaDescription: 'موجز.', categoryId: 1, tagNames: [], claimMap: [{ claimId: 'c1' }] };
  assert.equal(adoptEditing({ status: 'completed', output: { proposal: p } }, [{ id: 1 }]).body, p.body);
});

test('actual Windows encoded PowerShell produces a bounded original card from JSON data', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  const generator = path.join(f.config.projectDirectory, 'scripts', 'raad', 'create-news-card.ps1');
  fs.copyFileSync(new URL('./create-news-card.ps1', import.meta.url), generator);
  const adapters = createNewsroomAdapters({ ...f.config, powershell: safePowerShell });
  await adapters.reserveDraft(f.context);
  const prepared = await adapters.prepareMediaAndDraft({ ...f.context, articleId: 7001, operationId: 'offline-actual-card', edited: f.edited });
  assert.ok(prepared.originalMediaProof.bytes > 10000 && prepared.originalMediaProof.bytes <= 262144);
  assert.equal(prepared.originalMediaProof.generatorSha256, digest(fs.readFileSync(generator)));
});
