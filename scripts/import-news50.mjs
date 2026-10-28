// Imports the latest posts per category from news50.sa (WordPress REST API) into
// PostgreSQL + Supabase Storage as DRAFTS. Editorial approval is a separate step.
// Usage: node scripts/import-news50.mjs [--per-category=10] [--dry-run]
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { pgConnectionOptions } from "./pg-options.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const perCategory = Number((args.find((a) => a.startsWith("--per-category=")) || "").split("=")[1]) || 10;

const CATS = { local: 200, politics: 20, sports: 21, culture: 18, tech: 22 };
const AUTHORS = {
  local: "khaled@shurfa.local",
  sports: "khaled@shurfa.local",
  culture: "noura@shurfa.local",
  tech: "noura@shurfa.local",
  politics: "faisal@shurfa.local",
};

const API = "https://news50.sa/wp-json/wp/v2";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; ShurfaImporter/1.0)" };
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "article-images";

const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', hellip: "…" };
const decodeEntities = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(nbsp|amp|lt|gt|quot|hellip);/gi, (_, n) => NAMED[n.toLowerCase()] ?? _);

const plain = (html) =>
  decodeEntities(String(html ?? "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

const bodyText = (html) =>
  String(html ?? "")
    .split(/<\/p>|<\/h2>|<\/h3>|<\/li>|<br\s*\/?>/i)
    .map(plain)
    .filter((p) => p && !/^(اقرأ أيضا|اقرأ أيضًا|المصدر)/.test(p))
    .join("\n\n");

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`WP fetch failed (${res.status}) for ${url}`);
  return res.json();
}

const supaHeaders = () => ({
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

async function uploadImage(postId, media) {
  if (!media) return "";
  const sizes = media.media_details?.sizes ?? {};
  const src = (sizes.large ?? sizes.medium_large ?? sizes.full)?.source_url ?? media.source_url;
  if (!src) return "";
  const res = await fetch(src, { headers: UA });
  if (!res.ok) return "";
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXT[mime];
  if (!ext) return "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return "";
  const name = `n50-${postId}-${randomBytes(12).toString("hex")}.${ext}`;
  const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: "POST",
    headers: { ...supaHeaders(), "content-type": mime, "x-upsert": "false" },
    body: new Uint8Array(buf),
  });
  if (!up.ok) throw new Error(`Storage upload failed (${up.status}) for ${name}`);
  return name;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client(pgConnectionOptions());
await client.connect();

try {
  const catRows = await client.query("SELECT id, slug FROM categories");
  const catId = Object.fromEntries(catRows.rows.map((r) => [r.slug, r.id]));
  const userRows = await client.query("SELECT id, email FROM users WHERE email = ANY($1)", [
    ["khaled@shurfa.local", "noura@shurfa.local", "faisal@shurfa.local"],
  ]);
  const userId = Object.fromEntries(userRows.rows.map((r) => [r.email, r.id]));
  const existing = new Set(
    (await client.query("SELECT source_url FROM articles WHERE source_url != ''")).rows.map((r) => r.source_url),
  );

  const summary = [];
  const seedOut = [];

  for (const [slug, wpCat] of Object.entries(CATS)) {
    const posts = await getJson(
      `${API}/posts?categories=${wpCat}&per_page=${perCategory}&_embed=wp:featuredmedia&_fields=id,date,link,title,excerpt,content,tags,_links,_embedded`,
    );
    let inserted = 0,
      invalid = 0,
      skippedExisting = 0,
      noImage = 0;
    const titles = [];

    // fetch tag names once for this category's posts
    const tagIds = [...new Set(posts.flatMap((p) => p.tags ?? []))];
    const tagNames = new Map();
    if (tagIds.length) {
      for (const t of await getJson(`${API}/tags?include=${tagIds.join(",")}&per_page=100&_fields=id,name`))
        tagNames.set(t.id, t.name);
    }

    const items = [];
    for (const p of posts) {
      const title = plain(p.title?.rendered);
      const body = bodyText(p.content?.rendered);
      if (!title || body.length < 200) {
        invalid++;
        continue;
      }
      const tags = (p.tags ?? []).map((id) => tagNames.get(id)).filter((n) => n && n !== "Featured");
      items.push({
        category: slug,
        url: p.link,
        title,
        excerpt: plain(p.excerpt?.rendered) || body.slice(0, 200),
        image: "",
        date: (p.date ?? "").slice(0, 10),
        iso: p.date ? new Date(p.date).toISOString() : new Date().toISOString(),
        tags,
        body,
        postId: p.id,
        media: p._embedded?.["wp:featuredmedia"]?.[0],
        skipExisting: existing.has(p.link),
      });
      titles.push(title);
    }

    if (dryRun) {
      console.log(`\n${slug} (${items.length} posts):`);
      titles.forEach((t) => console.log(`  - ${t}`));
    } else {
      for (const it of items) {
        if (it.skipExisting || existing.has(it.url)) {
          skippedExisting++;
          continue;
        }
        await client.query("BEGIN");
        try {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [it.url]);
        if ((await client.query("SELECT 1 FROM articles WHERE source_url=$1", [it.url])).rowCount) {
          await client.query("COMMIT"); existing.add(it.url); skippedExisting++; continue;
        }
        let image = "";
        try {
          image = await uploadImage(it.postId, it.media);
        } catch (e) {
          console.error(`  upload failed for ${it.postId}: ${e.message}`);
        }
        if (!image) noImage++;
        const r = await client.query(
          `INSERT INTO articles (title, excerpt, body, image, category_id, author_id, status, featured, exclusive, source_url, views, published_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft', false, false, $7, 0, NULL, $8, $8) RETURNING id`,
          [
            it.title, it.excerpt, it.body, image, catId[slug], userId[AUTHORS[slug]],
            it.url, new Date().toISOString(),
          ],
        );
        for (const t of it.tags) {
          await client.query("INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [t]);
          const tr = await client.query("SELECT id FROM tags WHERE name = $1", [t]);
          if (tr.rows[0])
            await client.query("INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
              r.rows[0].id,
              tr.rows[0].id,
            ]);
        }
        await client.query("COMMIT");
        existing.add(it.url);
        it.image = image;
        inserted++;
        } catch (error) { await client.query("ROLLBACK"); throw error; }
      }
      seedOut.push(...items.map(({ postId, media, skipExisting, iso, ...rest }) => rest));
    }
    summary.push({
      category: slug,
      fetched: posts.length,
      inserted: dryRun ? 0 : inserted,
      "skipped-existing": skippedExisting,
      "skipped-invalid": invalid,
      "no-image": dryRun ? 0 : noImage,
    });
  }

  if (!dryRun) {
    writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "seed-news.json"), JSON.stringify(seedOut, null, 2));
    console.log(`\nWrote data/seed-news.json (${seedOut.length} items)`);
  }
  console.log("\nSummary:");
  console.table(summary);
} finally {
  await client.end();
}
