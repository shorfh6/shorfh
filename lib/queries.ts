import { db } from "./db";
import { PLATFORMS, type SocialLink } from "./social";

export type Category = { id: number; slug: string; name: string; description: string; sort_order: number };
export type Tag = { id: number; name: string };

export type ArticleRow = {
  id: number;
  title: string;
  excerpt: string;
  body: string;
  image: string;
  category_id: number;
  category_name: string;
  category_slug: string;
  author_id: number | null;
  author_name: string | null;
  status: "draft" | "pending" | "published" | "rejected";
  featured: number;
  exclusive: number;
  reject_reason: string;
  source_url: string;
  views: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

const BASE = `SELECT a.*, c.name AS category_name, c.slug AS category_slug, u.name AS author_name
  FROM articles a JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id`;

export type Filters = {
  status?: string;
  publicOnly?: boolean;
  categoryId?: number;
  categorySlug?: string;
  authorId?: number;
  tagId?: number;
  q?: string;
  exclusive?: boolean;
  featured?: boolean;
  excludeIds?: number[];
  limit?: number;
  offset?: number;
  order?: "published" | "updated";
};

export function listArticles(f: Filters = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.publicOnly) {
    where.push("a.status = 'published' AND a.published_at <= ?");
    params.push(new Date().toISOString());
  }
  if (f.status) (where.push("a.status = ?"), params.push(f.status));
  if (f.categoryId) (where.push("a.category_id = ?"), params.push(f.categoryId));
  if (f.categorySlug) (where.push("c.slug = ?"), params.push(f.categorySlug));
  if (f.authorId) (where.push("a.author_id = ?"), params.push(f.authorId));
  if (f.tagId) (where.push("a.id IN (SELECT article_id FROM article_tags WHERE tag_id = ?)"), params.push(f.tagId));
  if (f.exclusive !== undefined) (where.push("a.exclusive = ?"), params.push(f.exclusive ? 1 : 0));
  if (f.featured !== undefined) (where.push("a.featured = ?"), params.push(f.featured ? 1 : 0));
  if (f.excludeIds?.length) where.push(`a.id NOT IN (${f.excludeIds.map(() => "?").join(",")})`), params.push(...f.excludeIds);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(a.title LIKE ? ESCAPE '\\' OR a.excerpt LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const order = f.order === "updated" ? "a.updated_at DESC" : "COALESCE(a.published_at, a.created_at) DESC, a.id DESC";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM articles a JOIN categories c ON c.id = a.category_id${w}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`${BASE}${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, f.limit ?? 20, f.offset ?? 0) as ArticleRow[];
  return { rows, total };
}

export const getArticle = (id: number) => db.prepare(`${BASE} WHERE a.id = ?`).get(id) as ArticleRow | undefined;

export const getPublishedArticle = (id: number) =>
  db.prepare(`${BASE} WHERE a.id = ? AND a.status = 'published' AND a.published_at <= ?`).get(id, new Date().toISOString()) as
    | ArticleRow
    | undefined;

export const getArticleTags = (articleId: number) =>
  db
    .prepare("SELECT t.id, t.name FROM tags t JOIN article_tags at ON at.tag_id = t.id WHERE at.article_id = ? ORDER BY t.name")
    .all(articleId) as Tag[];

export const incrementViews = (id: number) => db.prepare("UPDATE articles SET views = views + 1 WHERE id = ?").run(id);

const PUBLIC = "a.status = 'published' AND a.published_at <= ?";

export function relatedArticles(a: ArticleRow, limit = 3) {
  return db
    .prepare(
      `${BASE} WHERE ${PUBLIC} AND a.id != ?
       AND (a.category_id = ? OR EXISTS (
         SELECT 1 FROM article_tags x JOIN article_tags y ON y.tag_id = x.tag_id WHERE x.article_id = a.id AND y.article_id = ?))
       ORDER BY (SELECT COUNT(*) FROM article_tags x WHERE x.article_id = a.id
                 AND x.tag_id IN (SELECT tag_id FROM article_tags WHERE article_id = ?)) DESC,
                (a.category_id = ?) DESC, a.published_at DESC LIMIT ?`,
    )
    .all(new Date().toISOString(), a.id, a.category_id, a.id, a.id, a.category_id, limit) as ArticleRow[];
}

export function adjacentArticles(a: ArticleRow) {
  const now = new Date().toISOString();
  const prev = db
    .prepare(`${BASE} WHERE ${PUBLIC} AND a.published_at < ? ORDER BY a.published_at DESC LIMIT 1`)
    .get(now, a.published_at) as ArticleRow | undefined;
  const next = db
    .prepare(`${BASE} WHERE ${PUBLIC} AND a.published_at > ? ORDER BY a.published_at ASC LIMIT 1`)
    .get(now, a.published_at) as ArticleRow | undefined;
  return { prev, next };
}

export const mostViewed = (limit = 5, excludeId = 0) =>
  db
    .prepare(`${BASE} WHERE ${PUBLIC} AND a.id != ? ORDER BY a.views DESC, a.published_at DESC LIMIT ?`)
    .all(new Date().toISOString(), excludeId, limit) as ArticleRow[];

export const authorPublishedCount = (authorId: number) =>
  (
    db.prepare("SELECT COUNT(*) AS n FROM articles a WHERE a.author_id = ? AND " + PUBLIC).get(authorId, new Date().toISOString()) as { n: number }
  ).n;

export const getCategories = () => db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all() as Category[];
export const getCategoryBySlug = (slug: string) => db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug) as Category | undefined;

export const sitemapCategories = () =>
  db.prepare(
    `SELECT c.slug FROM categories c WHERE EXISTS (
       SELECT 1 FROM articles a WHERE a.category_id = c.id AND a.status = 'published' AND a.published_at <= ?
     ) ORDER BY c.sort_order, c.id`,
  ).all(new Date().toISOString()) as { slug: string }[];

export const sitemapArticles = () =>
  db.prepare("SELECT id, updated_at FROM articles WHERE status = 'published' AND published_at <= ? ORDER BY id").all(new Date().toISOString()) as {
    id: number;
    updated_at: string;
  }[];

export const sitemapAuthors = () =>
  db.prepare(
    `SELECT u.id, MAX(a.updated_at) AS updated_at FROM users u JOIN articles a ON a.author_id = u.id
     WHERE u.status = 'active' AND a.status = 'published' AND a.published_at <= ? GROUP BY u.id`,
  ).all(new Date().toISOString()) as { id: number; updated_at: string }[];

export const sitemapTags = () =>
  db.prepare(
    `SELECT t.id, MAX(a.updated_at) AS updated_at FROM tags t JOIN article_tags at ON at.tag_id = t.id
     JOIN articles a ON a.id = at.article_id WHERE a.status = 'published' AND a.published_at <= ? GROUP BY t.id`,
  ).all(new Date().toISOString()) as { id: number; updated_at: string }[];

export const getTags = () =>
  db
    .prepare(
      `SELECT t.id, t.name, (SELECT COUNT(*) FROM article_tags WHERE tag_id = t.id) AS count
       FROM tags t ORDER BY t.name`,
    )
    .all() as (Tag & { count: number })[];
export const getTag = (id: number) => db.prepare("SELECT id, name FROM tags WHERE id = ?").get(id) as Tag | undefined;

export type Author = { id: number; name: string; bio: string; role: string; status: string; email: string; created_at: string };
export const getAuthor = (id: number) =>
  db.prepare("SELECT id, name, bio, role, status, email, created_at FROM users WHERE id = ?").get(id) as Author | undefined;

export const getAuthors = () =>
  db.prepare("SELECT id, name, role FROM users WHERE status = 'active' ORDER BY name").all() as { id: number; name: string; role: string }[];

export function homeData() {
  const pub = { publicOnly: true } as const;
  const featured =
    listArticles({ ...pub, featured: true, limit: 1 }).rows[0] ?? listArticles({ ...pub, exclusive: false, limit: 1 }).rows[0];
  const used = featured ? [featured.id] : [];
  const secondary = listArticles({ ...pub, exclusive: false, excludeIds: used, limit: 3 }).rows;
  used.push(...secondary.map((a) => a.id));
  const latest = listArticles({ ...pub, exclusive: false, excludeIds: used, limit: 5 }).rows;
  const exclusives = listArticles({ ...pub, exclusive: true, excludeIds: featured ? [featured.id] : [], limit: 3 }).rows;
  return { featured, secondary, latest, exclusives };
}

export function logActivity(user: { id: number; name: string }, action: string, target = "") {
  db.prepare("INSERT INTO activity (user_id, user_name, action, target, created_at) VALUES (?, ?, ?, ?, ?)").run(
    user.id,
    user.name,
    action,
    target,
    new Date().toISOString(),
  );
}

export function dashboardStats(authorId?: number) {
  const scope = authorId ? " WHERE author_id = ?" : "";
  const args = authorId ? [authorId] : [];
  const byStatus = Object.fromEntries(
    (db.prepare(`SELECT status, COUNT(*) AS n FROM articles${scope} GROUP BY status`).all(...args) as { status: string; n: number }[]).map((r) => [
      r.status,
      r.n,
    ]),
  );
  const views = (db.prepare(`SELECT COALESCE(SUM(views), 0) AS n FROM articles${scope}`).get(...args) as { n: number }).n;
  const perCategory = db
    .prepare(
      `SELECT c.name, COUNT(a.id) AS n FROM categories c LEFT JOIN articles a ON a.category_id = c.id${authorId ? " AND a.author_id = ?" : ""}
       GROUP BY c.id ORDER BY c.sort_order, c.id`,
    )
    .all(...args) as { name: string; n: number }[];
  const top = db
    .prepare(`${BASE}${authorId ? " WHERE a.author_id = ?" : ""} ORDER BY a.views DESC LIMIT 5`)
    .all(...args) as ArticleRow[];
  const counts = db
    .prepare("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM tags) AS tags")
    .get() as { users: number; categories: number; tags: number };
  const authors = db
    .prepare(
      `SELECT u.id, u.name, COUNT(a.id) AS n FROM users u LEFT JOIN articles a ON a.author_id = u.id AND a.status = 'published'
       WHERE u.role = 'author' GROUP BY u.id ORDER BY n DESC LIMIT 5`,
    )
    .all() as { id: number; name: string; n: number }[];
  return { byStatus, views, perCategory, top, counts, authors };
}

export const recentActivity = (limit = 10) =>
  db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number;
    user_name: string;
    action: string;
    target: string;
    created_at: string;
  }[];

export function getSocialLinks(): SocialLink[] {
  const rows = new Map(
    (db.prepare("SELECT platform, url, visible FROM social_links").all() as { platform: string; url: string; visible: number }[]).map(
      (r) => [r.platform, r],
    ),
  );
  return PLATFORMS.map((p) => {
    const row = rows.get(p.key);
    return { ...p, url: row?.url ?? p.home, visible: row ? !!row.visible : true };
  });
}

export const visibleSocialLinks = () => getSocialLinks().filter((l) => l.visible && l.url);
