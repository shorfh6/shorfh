// Seeds PostgreSQL with demo users and categories. Pass --demo-articles to also load the
// scraped articles from data/seed-news.json. Usage: node scripts/seed.mjs [--demo-articles] [--reset]
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgConnectionOptions } from "./pg-options.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {}

const password = process.env.ADMIN_PASSWORD;

if (!password || password.length < 12 || Buffer.byteLength(password, "utf8") > 1024) {
  console.error("Set ADMIN_PASSWORD to a value between 12 and 1024 bytes before seeding.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Demo seeding is disabled in production.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const reset = process.argv.includes("--reset");
const withArticles = process.argv.includes("--demo-articles");

const client = new pg.Client(pgConnectionOptions());
await client.connect();

try {
  if (reset) {
    await client.query(
      "TRUNCATE activity, article_tags, articles, social_links, sessions, users, categories, tags RESTART IDENTITY",
    );
    console.log("All tables truncated.");
  }

  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM users");
  if (rows[0].n > 0) {
    console.log("Database already seeded. Use --reset to start over.");
    process.exit(0);
  }

  const hash = (pw) => {
    const salt = randomBytes(16).toString("hex");
    return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString("hex")}`;
  };

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  const users = [
    ["مدير النظام", "admin@shurfa.local", "admin", "مسؤول منصة شُرفة."],
    ["سارة العتيبي", "editor@shurfa.local", "editor", "محررة الأخبار ومراجعة المحتوى."],
    ["خالد الدوسري", "khaled@shurfa.local", "author", "كاتب في الشؤون المحلية والرياضة."],
    ["نورة القحطاني", "noura@shurfa.local", "author", "كاتبة في الثقافة والفن والتقنية."],
    ["فيصل الحربي", "faisal@shurfa.local", "author", "كاتب في الشؤون السياسية والدولية."],
  ];
  const userIds = [];
  for (const [name, email, role, bio] of users) {
    const r = await client.query(
      "INSERT INTO users (name, email, password_hash, role, bio, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [name, email, hash(password), role, bio, iso(now)],
    );
    userIds.push(r.rows[0].id);
  }
  const author = { local: userIds[2], sports: userIds[2], culture: userIds[3], tech: userIds[3], politics: userIds[4] };

  const cats = [
    ["local", "الأخبار المحلية", "أخبار المملكة والمناطق والخدمات."],
    ["politics", "السياسة", "تطورات المشهد السياسي إقليمياً ودولياً."],
    ["sports", "الرياضة", "أخبار الأندية والمنتخبات والبطولات."],
    ["culture", "ثقافة وفن", "الثقافة والفنون والمشاهير."],
    ["tech", "تقنية", "التقنية والذكاء الاصطناعي والأمن الرقمي."],
  ];
  const catId = {};
  for (const [i, [slug, name, desc]] of cats.entries()) {
    const r = await client.query("INSERT INTO categories (slug, name, description, sort_order) VALUES ($1, $2, $3, $4) RETURNING id", [
      slug,
      name,
      desc,
      i,
    ]);
    catId[slug] = r.rows[0].id;
  }

  if (withArticles) {
    const tagId = async (name) => {
      const found = await client.query("SELECT id FROM tags WHERE name = $1", [name]);
      if (found.rows[0]) return found.rows[0].id;
      const r = await client.query("INSERT INTO tags (name) VALUES ($1) RETURNING id", [name]);
      return r.rows[0].id;
    };

    const news = JSON.parse(readFileSync(new URL("../data/seed-news.json", import.meta.url), "utf8"));
    const order = [...news].sort((a, b) => b.date.localeCompare(a.date));
    const seen = {};
    for (const a of news) {
      seen[a.category] = (seen[a.category] ?? -1) + 1;
      const i = seen[a.category];
      const featured = a.category === "local" && i === 0;
      const exclusive = (a.category === "culture" && i === 1) || (a.category === "tech" && i === 1) || (a.category === "politics" && i === 2);
      const at = iso(now - (order.indexOf(a) + 1) * 45 * 60_000);
      const r = await client.query(
        `INSERT INTO articles (title, excerpt, body, image, category_id, author_id, status, featured, exclusive, source_url, views, published_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'published', $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [a.title, a.excerpt, a.body, a.image, catId[a.category], author[a.category], featured, exclusive, a.url, Math.floor(Math.random() * 900) + 50, at, at, at],
      );
      for (const t of a.tags ?? []) {
        await client.query("INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
          r.rows[0].id,
          await tagId(t),
        ]);
      }
    }

    // Sample items in other workflow states
    const sample = [
      ["pending", "تقرير أولي: جاهزية المرافق الرياضية للموسم الجديد", userIds[2], "sports", ""],
      ["draft", "مسودة: مهرجان ثقافي مرتقب في الرياض", userIds[3], "culture", ""],
      ["rejected", "تحليل: مستقبل الشراكات التقنية الإقليمية", userIds[4], "tech", "المقال يحتاج إلى مصادر موثقة وأرقام دقيقة قبل النشر."],
    ];
    for (const [status, title, uid, cat, reason] of sample) {
      await client.query(
        `INSERT INTO articles (title, excerpt, body, category_id, author_id, status, reject_reason, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [title, "نص تجريبي لعرض دورة العمل في لوحة التحكم.", "هذا نص تجريبي.\n\nيمكن للمراجع قبوله أو رفضه أو تعديله.", catId[cat], uid, status, reason, iso(now), iso(now)],
      );
    }
    console.log(`Seeded ${news.length} demo articles.`);
  }

  console.log("Seeded users and categories. Demo accounts use ADMIN_PASSWORD.");
} finally {
  await client.end();
}
