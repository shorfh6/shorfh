// Copies data/shurfa.db (SQLite) into PostgreSQL. Usage:
//   node scripts/migrate-sqlite-to-pg.mjs [--articles] [--images] [--dry-run] [--force]
// Default copies users, categories, tags, social_links. --articles adds articles,
// article_tags and activity. --images uploads local files to Supabase Storage.
// Sessions are never copied.
import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {}

const args = process.argv.slice(2);
const withArticles = args.includes("--articles");
const withImages = args.includes("--images");
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

const root = path.dirname(fileURLToPath(import.meta.url));
const sqliteFile = path.join(root, "..", "data", "shurfa.db");
if (!existsSync(sqliteFile)) {
  console.error("SQLite source not found: data/shurfa.db");
  process.exit(1);
}

const sdb = new Database(sqliteFile, { readonly: true, fileMustExist: true });

const src = {
  users: sdb.prepare("SELECT * FROM users ORDER BY id").all(),
  categories: sdb.prepare("SELECT * FROM categories ORDER BY id").all(),
  tags: sdb.prepare("SELECT * FROM tags ORDER BY id").all(),
  social_links: sdb.prepare("SELECT * FROM social_links ORDER BY platform").all(),
  articles: withArticles ? sdb.prepare("SELECT * FROM articles ORDER BY id").all() : [],
  article_tags: withArticles ? sdb.prepare("SELECT * FROM article_tags ORDER BY article_id, tag_id").all() : [],
  activity: withArticles ? sdb.prepare("SELECT * FROM activity ORDER BY id").all() : [],
};

console.log("Source (SQLite) row counts:");
for (const [t, rows] of Object.entries(src)) console.log(`  ${t}: ${rows.length}`);
console.log("  sessions: skipped (never migrated)");

if (dryRun) {
  console.log("Dry run — nothing was written.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
});
await client.connect();

const conflict = force ? " ON CONFLICT (id) DO NOTHING" : "";
const verify = [];

try {
  const existing = await client.query("SELECT COUNT(*)::int AS n FROM users");
  if (existing.rows[0].n > 0 && !force) {
    console.error("Target already has users. Re-run with --force to insert only missing ids.");
    process.exit(1);
  }

  await client.query("BEGIN");

  for (const u of src.users) {
    await client.query(
      `INSERT INTO users (id, name, email, password_hash, role, status, bio, created_at, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)${conflict}`,
      [u.id, u.name, u.email, u.password_hash, u.role, u.status, u.bio ?? "", u.created_at, u.last_login],
    );
  }
  for (const c of src.categories) {
    await client.query(
      `INSERT INTO categories (id, slug, name, description, sort_order) VALUES ($1, $2, $3, $4, $5)${conflict}`,
      [c.id, c.slug, c.name, c.description ?? "", c.sort_order ?? 0],
    );
  }
  for (const t of src.tags) {
    await client.query(`INSERT INTO tags (id, name) VALUES ($1, $2)${conflict}`, [t.id, t.name]);
  }
  for (const l of src.social_links) {
    await client.query(
      "INSERT INTO social_links (platform, url, visible) VALUES ($1, $2, $3) ON CONFLICT (platform) DO NOTHING",
      [l.platform, l.url ?? "", !!l.visible],
    );
  }
  for (const a of src.articles) {
    await client.query(
      `INSERT INTO articles (id, title, excerpt, body, image, category_id, author_id, status, featured, exclusive,
        reject_reason, source_url, views, published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)${conflict}`,
      [
        a.id, a.title, a.excerpt ?? "", a.body ?? "", a.image ?? "", a.category_id, a.author_id, a.status,
        !!a.featured, !!a.exclusive, a.reject_reason ?? "", a.source_url ?? "", a.views ?? 0,
        a.published_at, a.created_at, a.updated_at,
      ],
    );
  }
  for (const at of src.article_tags) {
    await client.query("INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      at.article_id,
      at.tag_id,
    ]);
  }
  for (const r of src.activity) {
    await client.query(
      `INSERT INTO activity (id, user_id, user_name, action, target, created_at) VALUES ($1, $2, $3, $4, $5, $6)${conflict}`,
      [r.id, r.user_id, r.user_name, r.action, r.target ?? "", r.created_at],
    );
  }

  for (const t of ["users", "categories", "tags", "articles", "activity"]) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`);
  }

  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
  await client.end();
  process.exit();
}

// Image upload to Supabase Storage (after the DB commit — storage ops are not transactional).
if (withImages) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "article-images";
  if (!base || !key) {
    console.error("--images requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exitCode = 1;
  } else {
    const uploadsDir = path.join(root, "..", "data", "uploads");
    const names = [
      ...new Set(
        (withArticles ? src.articles : sdb.prepare("SELECT image FROM articles").all())
          .map((a) => a.image)
          .filter((n) => n && !/^https?:\/\//.test(n))
          .sort(),
      ),
    ];
    const headers = { Authorization: `Bearer ${key}`, apikey: key };
    const mime = (n) => ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" })[
      path.extname(n).toLowerCase()
    ];
    for (const name of names) {
      const file = path.join(uploadsDir, name);
      if (!existsSync(file)) {
        console.log(`  ${name}: fail (missing local file)`);
        continue;
      }
      try {
        const head = await fetch(`${base}/storage/v1/object/authenticated/${bucket}/${name}`, { headers });
        if (head.ok) {
          console.log(`  ${name}: skip (already exists)`);
          continue;
        }
        const res = await fetch(`${base}/storage/v1/object/${bucket}/${name}`, {
          method: "POST",
          headers: { ...headers, "content-type": mime(name) ?? "application/octet-stream", "x-upsert": "false" },
          body: readFileSync(file),
        });
        console.log(`  ${name}: ${res.ok ? "ok" : `fail (${res.status})`}`);
      } catch {
        console.log(`  ${name}: fail`);
      }
    }
  }
}

// Verification: source vs target counts.
for (const [t, rows] of Object.entries(src)) {
  const target = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
  verify.push({ table: t, source: rows.length, target: target.rows[0].n });
}
console.log("\nVerification (source vs target):");
console.table(verify);

await client.end();
