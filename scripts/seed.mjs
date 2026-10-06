// Seeds the database with demo users, categories and the scraped articles. Usage: node scripts/seed.mjs [--reset]
import Database from "better-sqlite3";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dataDir = new URL("../data/", import.meta.url);
mkdirSync(dataDir, { recursive: true });
const dbFile = fileURLToPath(new URL("shurfa.db", dataDir));
const password = process.env.ADMIN_PASSWORD;

if (!password || password.length < 12 || Buffer.byteLength(password, "utf8") > 1024) {
  console.error("Set ADMIN_PASSWORD to a value between 12 and 1024 bytes before seeding.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Demo seeding is disabled in production.");
  process.exit(1);
}

if (process.argv.includes("--reset")) {
  for (const ext of ["", "-wal", "-shm"]) if (existsSync(dbFile + ext)) rmSync(dbFile + ext);
}

const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8"));

if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) {
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
const insUser = db.prepare("INSERT INTO users (name, email, password_hash, role, bio, created_at) VALUES (?, ?, ?, ?, ?, ?)");
const userIds = users.map(([name, email, role, bio]) => insUser.run(name, email, hash(password), role, bio, iso(now)).lastInsertRowid);
const author = { local: userIds[2], sports: userIds[2], culture: userIds[3], tech: userIds[3], politics: userIds[4] };

const cats = [
  ["local", "الأخبار المحلية", "أخبار المملكة والمناطق والخدمات."],
  ["politics", "السياسة", "تطورات المشهد السياسي إقليمياً ودولياً."],
  ["sports", "الرياضة", "أخبار الأندية والمنتخبات والبطولات."],
  ["culture", "ثقافة وفن", "الثقافة والفنون والمشاهير."],
  ["tech", "تقنية", "التقنية والذكاء الاصطناعي والأمن الرقمي."],
];
const insCat = db.prepare("INSERT INTO categories (slug, name, description, sort_order) VALUES (?, ?, ?, ?)");
const catId = {};
cats.forEach(([slug, name, desc], i) => (catId[slug] = insCat.run(slug, name, desc, i).lastInsertRowid));

const tagId = (name) => {
  const row = db.prepare("SELECT id FROM tags WHERE name = ?").get(name);
  return row ? row.id : db.prepare("INSERT INTO tags (name) VALUES (?)").run(name).lastInsertRowid;
};

const news = JSON.parse(readFileSync(new URL("seed-news.json", dataDir), "utf8"));
const order = [...news].sort((a, b) => b.date.localeCompare(a.date));
const seen = {};
const insArticle = db.prepare(
  `INSERT INTO articles (title, excerpt, body, image, category_id, author_id, status, featured, exclusive, source_url, views, published_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?)`,
);
const insTag = db.prepare("INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)");

for (const a of news) {
  seen[a.category] = (seen[a.category] ?? -1) + 1;
  const i = seen[a.category];
  const featured = a.category === "local" && i === 0 ? 1 : 0;
  const exclusive = (a.category === "culture" && i === 1) || (a.category === "tech" && i === 1) || (a.category === "politics" && i === 2) ? 1 : 0;
  const at = iso(now - (order.indexOf(a) + 1) * 45 * 60_000);
  const id = insArticle.run(
    a.title, a.excerpt, a.body, a.image, catId[a.category], author[a.category], featured, exclusive, a.url,
    Math.floor(Math.random() * 900) + 50, at, at, at,
  ).lastInsertRowid;
  for (const t of a.tags ?? []) insTag.run(id, tagId(t));
}

// Sample items in other workflow states
const sample = [
  ["pending", "تقرير أولي: جاهزية المرافق الرياضية للموسم الجديد", userIds[2], "sports", ""],
  ["draft", "مسودة: مهرجان ثقافي مرتقب في الرياض", userIds[3], "culture", ""],
  ["rejected", "تحليل: مستقبل الشراكات التقنية الإقليمية", userIds[4], "tech", "المقال يحتاج إلى مصادر موثقة وأرقام دقيقة قبل النشر."],
];
const insSample = db.prepare(
  `INSERT INTO articles (title, excerpt, body, category_id, author_id, status, reject_reason, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const [status, title, uid, cat, reason] of sample) {
  insSample.run(title, "نص تجريبي لعرض دورة العمل في لوحة التحكم.", "هذا نص تجريبي.\n\nيمكن للمراجع قبوله أو رفضه أو تعديله.", catId[cat], uid, status, reason, iso(now), iso(now));
}

console.log(`Seeded ${news.length} articles.`);
console.log("Demo accounts use ADMIN_PASSWORD.");
