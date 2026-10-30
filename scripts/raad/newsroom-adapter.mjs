import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { contentHash, assertNoSecrets } from './envelope.mjs';
import { canonicalOkazArticle } from './rss-discovery.mjs';
import { readOriginalCard } from '../../lib/original-card.mjs';

const check = (ok, code) => { if (!ok) throw Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const ORIGINAL_CAPTION = 'الصورة بطاقة توضيحية أصلية من شُرفة تعرض عنوان الخبر، وليست صورة للحدث.';
export const PRODUCTION_SITE = 'https://www.shurfh.com';
export const PRODUCTION_PROJECT = 'edfbsgnrsbbjngbudpfk';
export const STAGING_PROJECT = 'eotfvclpiflwikvqzhqt';

function safeDirectory(directory, create = false) {
  check(path.isAbsolute(directory), 'NEWSROOM_ADAPTER_ABSOLUTE_PATH_REQUIRED');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const s = fs.lstatSync(current);
    check(s.isDirectory() && !s.isSymbolicLink(), 'NEWSROOM_ADAPTER_UNSAFE_PATH');
  }
}
function readJSON(file) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024, 'NEWSROOM_ADAPTER_UNSAFE_FILE');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function saveJSON(file, data) {
  assertNoSecrets(data);
  if (fs.existsSync(file)) check(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'NEWSROOM_ADAPTER_UNSAFE_FILE');
  const pending = file + '.pending';
  const fd = fs.openSync(pending, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(pending, file);
}

// Trusted code only: story/title data is exclusively JSON in InputFile, not script text.
export function safePowerShell(script, { timeoutMs = 60000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from("$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" + script, 'utf16le').toString('base64')],
    { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); reject(Error(error)); } else resolve(); };
    const timer = setTimeout(() => finish('NEWSROOM_CARD_TIMEOUT'), timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { bytes += part.length; if (bytes > 128 * 1024) finish('NEWSROOM_CARD_OUTPUT_LIMIT'); });
    child.on('error', () => finish('NEWSROOM_CARD_PROCESS_FAILED'));
    child.on('close', code => finish(code === 0 ? null : 'NEWSROOM_CARD_PROCESS_FAILED'));
  });
}

function sourceMatches(rows, url) {
  return rows.filter(row => { try { return canonicalOkazArticle(row.source_url) === url; } catch { return false; } });
}

export function createNewsroomAdapters({ mode, site, projectRef, projectDirectory, runtimeDirectory,
  withClient, fetchImpl = fetch, powershell = safePowerShell, requestHeaders = async () => ({}), now = () => new Date().toISOString() }) {
  check(['production', 'staging'].includes(mode), 'NEWSROOM_ADAPTER_MODE_REQUIRED');
  const target = new URL(site);
  check(target.protocol === 'https:' && !target.username && !target.password && target.origin === site && !target.search && !target.hash && target.pathname === '/', 'NEWSROOM_ADAPTER_HTTPS_SITE_REQUIRED');
  check(mode === 'production' ? site === PRODUCTION_SITE && projectRef === PRODUCTION_PROJECT :
    /^shorfh-raad-staging(?:-[a-z0-9]+)?\.onrender\.com$/.test(target.hostname) && !target.port && projectRef === STAGING_PROJECT, 'NEWSROOM_ADAPTER_TARGET_MISMATCH');
  check(typeof withClient === 'function', 'NEWSROOM_ADAPTER_CONNECTION_REQUIRED');
  safeDirectory(projectDirectory); safeDirectory(runtimeDirectory);
  check(path.resolve(runtimeDirectory).startsWith(path.resolve(projectDirectory, '.raad-local') + path.sep), 'NEWSROOM_ADAPTER_PRIVATE_DIRECTORY_REQUIRED');
  const mediaDirectory = path.join(projectDirectory, 'docs', 'raad', 'media');
  const evidenceDirectory = path.join(projectDirectory, 'docs', 'raad', 'evidence');
  safeDirectory(mediaDirectory, true); safeDirectory(evidenceDirectory, true);
  const generator = path.join(projectDirectory, 'scripts', 'raad', 'create-news-card.ps1');
  check(fs.lstatSync(generator).isFile() && !fs.lstatSync(generator).isSymbolicLink(), 'NEWSROOM_CARD_GENERATOR_REQUIRED');
  const ownerFile = key => { check(/^[a-f0-9]{64}$/.test(key), 'NEWSROOM_ADAPTER_SOURCE_KEY'); return path.join(runtimeDirectory, `owner-${key}.json`); };
  function owned(key, articleId, url) {
    const owner = readJSON(ownerFile(key));
    check(owner.articleId === articleId && owner.sourceUrl === url && owner.projectRef === projectRef && owner.site === site, 'NEWSROOM_ADAPTER_OWNERSHIP_REQUIRED');
    return owner;
  }
  async function connection(kind, callback) {
    return withClient(kind, async (client, identity) => {
      check(identity?.tlsAuthorized === true && identity.projectRef === projectRef &&
        identity.role === (mode === 'production' ? `raad_${kind}` : `raad_stage_${kind}`), 'NEWSROOM_ADAPTER_DATABASE_IDENTITY');
      return callback(client);
    });
  }
  async function locked(client, source, callback) {
    await client.query('BEGIN'); let committing = false;
    try {
      await client.query("SET LOCAL lock_timeout='10s'");
      await client.query('SELECT raad_gate.lock_publication_scope()');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['raad-newsroom-source:' + source]);
      const result = await callback(client);
      committing = true; await client.query('COMMIT'); return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve unknown transaction outcome. */ }
      if (committing) throw Error('NEWSROOM_ADAPTER_COMMIT_UNKNOWN');
      throw error;
    }
  }
  async function snapshot(client, id) {
    const p = (await client.query('SELECT raad_gate.article_snapshot($1) AS snapshot', [id])).rows[0]?.snapshot;
    check(p?.id === id, 'NEWSROOM_ADAPTER_SNAPSHOT_REQUIRED'); return p;
  }
  async function rows(client) { return (await client.query('SELECT id,source_url,status FROM public.articles ORDER BY id')).rows; }
  async function verifyOwnedDraft(client, owner) {
    const row = (await client.query('SELECT id,status,source_url FROM public.articles WHERE id=$1 FOR UPDATE', [owner.articleId])).rows[0];
    check(row?.status === 'draft' && row.source_url === owner.sourceUrl, 'NEWSROOM_ADAPTER_OWNED_DRAFT_REQUIRED');
    const current = await snapshot(client, owner.articleId);
    check(contentHash(current) === contentHash(owner.snapshot), 'NEWSROOM_ADAPTER_DRAFT_CHANGED');
    return current;
  }
  async function headers() {
    const additional = await requestHeaders();
    check(additional && Object.keys(additional).every(k => mode === 'staging' && k.toLowerCase() === 'authorization'), 'NEWSROOM_ADAPTER_HEADERS_REJECTED');
    return additional;
  }
  async function boundedResponse(response, limit) {
    check(response.status === 200 && response.body && Number(response.headers.get('content-length') ?? 0) <= limit, 'NEWSROOM_ADAPTER_HTTP_FAILED');
    const reader = response.body.getReader(), parts = []; let size = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; check(size <= limit, 'NEWSROOM_ADAPTER_RESPONSE_LIMIT'); parts.push(part.value); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(parts);
  }
  async function withWorkerKey(callback) {
    let secret;
    await connection('web', async c => {
      const config = (await c.query('SELECT raad_queue.worker_configuration($1) AS configuration', [site])).rows[0]?.configuration;
      check(config?.enabled === true && typeof config.secret === 'string' && config.secret.length > 0, 'NEWSROOM_ADAPTER_MEDIA_ACCESS_REQUIRED');
      secret = config.secret;
    });
    try { return await callback(secret); } finally { secret = ''; }
  }
  async function upload(articleId, data) {
    return withWorkerKey(async secret => {
      const response = await fetchImpl(site + '/api/raad/media', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { ...await headers(), 'content-type': 'image/png', 'x-raad-worker-key': secret, 'x-raad-article-id': String(articleId) }, body: data });
      return JSON.parse((await boundedResponse(response, 8192)).toString('utf8'));
    });
  }
  async function remoteImage(imageName, articleId) {
    const match = /^raad-([1-9]\d{0,9})-([a-f0-9]{24})\.png$/.exec(imageName);
    check(match && Number.isSafeInteger(articleId) && articleId > 0 && articleId <= 2147483647 && Number(match[1]) === articleId, 'NEWSROOM_ADAPTER_IMAGE_NAME');
    return withWorkerKey(async secret => {
      // Draft uploads are CMS-protected. Read only through the authenticated worker endpoint.
      const response = await fetchImpl(site + '/api/raad/media', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { ...await headers(), 'x-raad-worker-key': secret, 'x-raad-article-id': String(articleId) } });
      check(response.headers.get('content-type')?.split(';')[0] === 'image/png', 'NEWSROOM_ADAPTER_IMAGE_TYPE');
      const data = await boundedResponse(response, 262144);
      check(sha(data).startsWith(match[2]), 'NEWSROOM_ADAPTER_IMAGE_NAME_HASH_MISMATCH');
      return data;
    });
  }

  return {
    async reserveDraft({ sourceKey, notice, operationId }) {
      const url = canonicalOkazArticle(notice.url);
      return connection('web', client => locked(client, url, async c => {
        const matches = sourceMatches(await rows(c), url);
        const categories = (await c.query('SELECT id,name,slug FROM public.categories ORDER BY sort_order,id')).rows;
        check(categories.length > 0, 'NEWSROOM_ADAPTER_CATEGORIES_REQUIRED');
        let owner;
        if (matches.length) {
          if (matches.length !== 1 || !fs.existsSync(ownerFile(sourceKey))) return { duplicate: true };
          owner = owned(sourceKey, matches[0].id, url);
          await verifyOwnedDraft(c, owner); // Recover our exact existing draft, never overwrite unrelated work.
        } else {
          check(!fs.existsSync(ownerFile(sourceKey)), 'NEWSROOM_ADAPTER_MISSING_OWNED_DRAFT');
          const row = (await c.query("INSERT INTO public.articles(title,excerpt,body,image,category_id,author_id,status,featured,exclusive,source_url) VALUES($1,$2,$3,'',$4,NULL,'draft',false,false,$5) RETURNING id",
            ['مسودة بحثية غير جاهزة للنشر', 'بانتظار التحقق والتحرير ومراجعة الصورة والاعتماد.', 'مسودة بحثية غير جاهزة للنشر. لا تمثل خبراً معتمداً.', categories[0].id, url])).rows[0];
          check(Number.isSafeInteger(row?.id), 'NEWSROOM_ADAPTER_DRAFT_INSERT_FAILED');
          owner = { version: 1, sourceKey, sourceUrl: url, articleId: row.id, projectRef, site, operationId, snapshot: await snapshot(c, row.id) };
          saveJSON(ownerFile(sourceKey), owner); // An ambiguous commit is reconciled against this exact snapshot.
        }
        return { articleId: owner.articleId, site, categories, categoryProof: { projectRef, observedAt: now(), source: 'public.categories via dedicated TLS web login' },
          originalIllustrationCaption: ORIGINAL_CAPTION,
          cmsMetadata: { seoTitle: 'Must equal title', metaDescription: 'Must equal excerpt', author: null,
            canonicalPattern: site + '/article/{articleId}', internalLinks: [],
            rendering: 'Plain source URL and ## headings; no fabricated internal links. Include the exact originalIllustrationCaption as its own body paragraph so deployed articleImageAlt uses it.',
            publicationDates: 'Actual server publication time after approval; never backdate to RSS/source time.' } };
      }));
    },

    async prepareMediaAndDraft({ sourceKey, notice, operationId, articleId, edited }) {
      const url = canonicalOkazArticle(notice.url), owner = owned(sourceKey, articleId, url);
      check(edited.body.includes(ORIGINAL_CAPTION) && edited.body.includes(url), 'NEWSROOM_ADAPTER_CAPTION_SOURCE_REQUIRED');
      check(edited.seoTitle === edited.title && edited.metaDescription === edited.excerpt && !/^(?:بحسب|وفق|نقل[ًاا]+\s+عن|عكاظ\s*[:：-])/u.test(edited.title.trim()), 'NEWSROOM_ADAPTER_ORIGINAL_SEO_REQUIRED');
      const scope = `newsroom-${articleId}-${sha(Buffer.from(operationId)).slice(0,16)}`;
      const inputFile = path.join(runtimeDirectory, scope + '-card.json'), outputFile = path.join(mediaDirectory, scope + '.png');
      check(!fs.existsSync(inputFile) && !fs.existsSync(outputFile), 'NEWSROOM_ADAPTER_CARD_ALREADY_EXISTS');
      saveJSON(inputFile, { title: edited.title });
      const quote = value => "'" + value.replaceAll("'", "''") + "'";
      // -File is blocked by local execution policy. Execute the trusted scriptblock with JSON file arguments.
      await powershell(`$code=[IO.File]::ReadAllText(${quote(generator)},[Text.Encoding]::UTF8);& ([ScriptBlock]::Create($code)) -InputFile ${quote(inputFile)} -OutputFile ${quote(outputFile)}`);
      const imageStat = fs.lstatSync(outputFile);
      check(imageStat.isFile() && !imageStat.isSymbolicLink() && imageStat.size <= 262144, 'NEWSROOM_ADAPTER_CARD_FILE_REJECTED');
      const data = fs.readFileSync(outputFile);
      const card = await readOriginalCard(new Request('https://card.invalid', { method: 'POST', headers: { 'content-type': 'image/png', 'x-raad-article-id': String(articleId) }, body: data }));
      const originalMediaProof = { version: 1, origin: 'Commissioned original SHURFA title illustration generated locally; no publisher photograph or copied article body',
        generator: 'scripts/raad/create-news-card.ps1', generatorSha256: sha(fs.readFileSync(generator)),
        inputTitle: edited.title, inputSha256: sha(fs.readFileSync(inputFile)), localPath: path.relative(projectDirectory, outputFile).split(path.sep).join('/'),
        sha256: card.sha256, bytes: data.length, width: 1200, height: 675, rightsStatus: 'confirmed', owner: 'شُرفة',
        useScope: 'Commissioned original illustration for this SHURFA article, website metadata and social preview', alt: { text: ORIGINAL_CAPTION }, generatedAt: now() };
      const proofFile = path.join(runtimeDirectory, scope + '-provenance.json'); saveJSON(proofFile, originalMediaProof);
      await connection('web', client => locked(client, url, async c => {
        await verifyOwnedDraft(c, owner);
        check(sourceMatches(await rows(c), url).every(row => row.id === articleId), 'NEWSROOM_ADAPTER_SOURCE_DUPLICATE');
        const changed = await c.query("UPDATE public.articles SET title=$1,excerpt=$2,body=$3,image='',category_id=$4,author_id=NULL,featured=false,exclusive=false,updated_at=clock_timestamp() WHERE id=$5 AND status='draft' AND source_url=$6 RETURNING id",
          [edited.title, edited.excerpt, edited.body, edited.categoryId, articleId, url]);
        check(changed.rows[0]?.id === articleId, 'NEWSROOM_ADAPTER_DRAFT_UPDATE_FAILED');
        await c.query('DELETE FROM public.article_tags WHERE article_id=$1', [articleId]);
        for (const name of edited.tagNames) {
          const tag = (await c.query('INSERT INTO public.tags(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [name])).rows[0];
          await c.query('INSERT INTO public.article_tags(article_id,tag_id) VALUES($1,$2)', [articleId, tag.id]);
        }
        owner.snapshot = await snapshot(c, articleId); owner.operationId = operationId;
        saveJSON(ownerFile(sourceKey), owner);
      }));
      const uploaded = await upload(articleId, data);
      check(uploaded.articleId === articleId && uploaded.imageName === card.imageName && uploaded.sha256 === card.sha256 && uploaded.bytes === data.length, 'NEWSROOM_ADAPTER_UPLOAD_MISMATCH');
      check(sha(await remoteImage(card.imageName, articleId)) === card.sha256, 'NEWSROOM_ADAPTER_UPLOAD_READBACK_MISMATCH');
      const actual = await connection('web', client => locked(client, url, async c => {
        const row = (await c.query('SELECT id,status,source_url FROM public.articles WHERE id=$1 FOR UPDATE', [articleId])).rows[0];
        check(row?.status === 'draft' && row.source_url === url, 'NEWSROOM_ADAPTER_OWNED_DRAFT_REQUIRED');
        const p = await snapshot(c, articleId);
        check(contentHash({ ...p, image: '' }) === contentHash(owner.snapshot) && p.image === card.imageName, 'NEWSROOM_ADAPTER_DRAFT_CHANGED');
        owner.snapshot = p; owner.media = { ...originalMediaProof, imageName: card.imageName }; saveJSON(ownerFile(sourceKey), owner); return p;
      }));
      return { publicationSnapshot: actual,
        publicationCandidate: { articleId, title: actual.title, excerpt: actual.excerpt, body: actual.body, seoTitle: actual.title, metaDescription: actual.excerpt,
          imageName: actual.image, imageLocalSha256: card.sha256, categoryId: actual.category.id, categoryName: actual.category.name,
          authorDisplayName: null, featured: false, exclusive: false, tagNames: actual.tags.map(t => t.name), sourceUrl: url },
        originalMediaProof,
        metadataProjection: { canonical: site + '/article/' + articleId, seoTitle: actual.title, metaDescription: actual.excerpt, imageUrl: site + '/uploads/' + actual.image, imageAlt: ORIGINAL_CAPTION, structuredDataType: 'NewsArticle', dates: 'Actual server time only after approval' },
        allowedReadPaths: [originalMediaProof.localPath, 'scripts/raad/create-news-card.ps1', 'lib/format.ts'] };
    },

    async preflight({ sourceKey, notice, articleId, prepared }) {
      const owner = owned(sourceKey, articleId, canonicalOkazArticle(notice.url));
      const actual = await connection('web', client => locked(client, owner.sourceUrl, async c => {
        const p = await verifyOwnedDraft(c, owner);
        const matches = sourceMatches(await rows(c), owner.sourceUrl);
        check(matches.length === 1 && matches[0].id === articleId, 'NEWSROOM_ADAPTER_SOURCE_DUPLICATE');
        return p;
      }));
      check(contentHash(actual) === contentHash(prepared.publicationSnapshot), 'NEWSROOM_ADAPTER_PREFLIGHT_SNAPSHOT_CHANGED');
      check(owner.media?.sha256 === prepared.publicationCandidate.imageLocalSha256 && contentHash(prepared.originalMediaProof) === contentHash(Object.fromEntries(Object.entries(owner.media).filter(([k]) => k !== 'imageName'))), 'NEWSROOM_ADAPTER_PROVENANCE_CHANGED');
      const local = path.resolve(projectDirectory, owner.media.localPath);
      check(path.dirname(local) === mediaDirectory && !fs.lstatSync(local).isSymbolicLink(), 'NEWSROOM_ADAPTER_UNSAFE_PATH');
      check(sha(fs.readFileSync(local)) === owner.media.sha256 && sha(fs.readFileSync(generator)) === owner.media.generatorSha256, 'NEWSROOM_ADAPTER_LOCAL_MEDIA_CHANGED');
      const remote = await remoteImage(actual.image, articleId);
      const checked = await readOriginalCard(new Request('https://card.invalid', { method: 'POST', headers: { 'content-type': 'image/png', 'x-raad-article-id': String(articleId) }, body: remote }));
      check(checked.sha256 === owner.media.sha256, 'NEWSROOM_ADAPTER_REMOTE_MEDIA_CHANGED');
      const clockReadPath = `docs/raad/evidence/newsroom-${articleId}-clock.json`;
      return { sourceUnique: true, snapshotHash: contentHash(actual), imageSha256: checked.sha256, checkedAt: now(), projectRef,
        reviewClock: { clockReadPath, source: 'Live coordinator system UTC refreshed once per second during final review', instruction: 'Read clockReadPath immediately before recording decision.reviewedAt; use observedUtc. Do not use the earlier static request timestamp.' } };
    },

    async withReviewClock(task, callback) {
      if (task.agent !== 'al-mutamid') return callback();
      const clockReadPath = `docs/raad/evidence/newsroom-${task.input.articleId}-clock.json`;
      check(task.input.reviewClock?.clockReadPath === clockReadPath, 'NEWSROOM_ADAPTER_LIVE_CLOCK_REQUIRED');
      const file = path.join(projectDirectory, clockReadPath);
      const update = () => saveJSON(file, { observedUtc: now(), source: 'Measured coordinator system UTC' });
      // Claim only our own new clock file; never overwrite/delete a pre-existing file.
      const fd = fs.openSync(file, 'wx', 0o600); fs.closeSync(fd);
      let clockError, timer;
      try {
        const startedAt = Date.parse(now()); update();
        timer = setInterval(() => { try { update(); } catch { clockError = true; } }, 1000);
        const result = await callback();
        check(!clockError, 'NEWSROOM_ADAPTER_LIVE_CLOCK_FAILED');
        if (result.result?.status === 'completed') {
          const reviewedAt = Date.parse(result.result.decision?.reviewedAt);
          check(Number.isFinite(reviewedAt) && reviewedAt >= startedAt && reviewedAt <= Date.parse(now()), 'NEWSROOM_ADAPTER_DECISION_CLOCK_MISMATCH');
          const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
          check(Object.entries(result.reviewProof?.documentReadCounts ?? {}).some(([readFile, count]) => normalize(readFile) === normalize(file) && count === 1), 'NEWSROOM_ADAPTER_CLOCK_READ_REQUIRED');
        }
        return result;
      } finally { clearInterval(timer); fs.unlinkSync(file); }
    },
    withApprover: callback => connection('approver', callback),
  };
}
