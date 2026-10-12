import { exec, one, query, type SqlValue } from "./db";
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
  featured: boolean;
  exclusive: boolean;
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

export async function listArticles(f: Filters = {}) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  const p = (v: SqlValue) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.publicOnly) where.push("a.status = 'published' AND a.published_at <= now()");
  if (f.status) where.push(`a.status = ${p(f.status)}`);
  if (f.categoryId) where.push(`a.category_id = ${p(f.categoryId)}`);
  if (f.categorySlug) where.push(`c.slug = ${p(f.categorySlug)}`);
  if (f.authorId) where.push(`a.author_id = ${p(f.authorId)}`);
  if (f.tagId) where.push(`a.id IN (SELECT article_id FROM article_tags WHERE tag_id = ${p(f.tagId)})`);
  if (f.exclusive !== undefined) where.push(`a.exclusive = ${p(f.exclusive)}`);
  if (f.featured !== undefined) where.push(`a.featured = ${p(f.featured)}`);
  if (f.excludeIds?.length) where.push(`a.id NOT IN (${f.excludeIds.map((id) => p(id)).join(",")})`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, "\\$&")}%`;
    where.push(`(a.title ILIKE ${p(like)} ESCAPE '\\' OR a.excerpt ILIKE ${p(like)} ESCAPE '\\' OR a.body ILIKE ${p(like)} ESCAPE '\\')`);
  }
  const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const order = f.order === "updated" ? "a.updated_at DESC" : "COALESCE(a.published_at, a.created_at) DESC, a.id DESC";
  const total =
    (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM articles a JOIN categories c ON c.id = a.category_id${w}`, params))?.n ?? 0;
  const rows = await query<ArticleRow>(`${BASE}${w} ORDER BY ${order} LIMIT ${p(f.limit ?? 20)} OFFSET ${p(f.offset ?? 0)}`, params);
  return { rows, total };
}

export const getArticle = (id: number) => one<ArticleRow>(`${BASE} WHERE a.id = $1`, [id]);

export const getPublishedArticle = (id: number) =>
  one<ArticleRow>(`${BASE} WHERE a.id = $1 AND a.status = 'published' AND a.published_at <= now()`, [id]);

export const getArticleTags = (articleId: number) =>
  query<Tag>("SELECT t.id, t.name FROM tags t JOIN article_tags at ON at.tag_id = t.id WHERE at.article_id = $1 ORDER BY t.name", [
    articleId,
  ]);

export const incrementViews = (id: number) => exec("UPDATE articles SET views = views + 1 WHERE id = $1", [id]);

const PUBLIC = "a.status = 'published' AND a.published_at <= now()";

export function relatedArticles(a: ArticleRow, limit = 3) {
  return query<ArticleRow>(
    `${BASE} WHERE ${PUBLIC} AND a.id != $1
     AND (a.category_id = $2 OR EXISTS (
       SELECT 1 FROM article_tags x JOIN article_tags y ON y.tag_id = x.tag_id WHERE x.article_id = a.id AND y.article_id = $3))
     ORDER BY (SELECT COUNT(*) FROM article_tags x WHERE x.article_id = a.id
               AND x.tag_id IN (SELECT tag_id FROM article_tags WHERE article_id = $4)) DESC,
              (a.category_id = $5) DESC, a.published_at DESC LIMIT $6`,
    [a.id, a.category_id, a.id, a.id, a.category_id, limit],
  );
}

export async function adjacentArticles(a: ArticleRow) {
  const prev = await one<ArticleRow>(
    `${BASE} WHERE ${PUBLIC} AND a.published_at < $1 ORDER BY a.published_at DESC LIMIT 1`,
    [a.published_at],
  );
  const next = await one<ArticleRow>(
    `${BASE} WHERE ${PUBLIC} AND a.published_at > $1 ORDER BY a.published_at ASC LIMIT 1`,
    [a.published_at],
  );
  return { prev, next };
}

export const mostViewed = (limit = 5, excludeId = 0) =>
  query<ArticleRow>(`${BASE} WHERE ${PUBLIC} AND a.id != $1 ORDER BY a.views DESC, a.published_at DESC LIMIT $2`, [excludeId, limit]);

export const authorPublishedCount = async (authorId: number) =>
  (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM articles a WHERE a.author_id = $1 AND ${PUBLIC}`, [authorId]))?.n ?? 0;

export const getCategories = () => query<Category>("SELECT * FROM categories ORDER BY sort_order, id");
export const getCategoryBySlug = (slug: string) => one<Category>("SELECT * FROM categories WHERE slug = $1", [slug]);

export const sitemapCategories = () =>
  query<{ slug: string }>(
    `SELECT c.slug FROM categories c WHERE EXISTS (
       SELECT 1 FROM articles a WHERE a.category_id = c.id AND ${PUBLIC}
     ) ORDER BY c.sort_order, c.id`,
  );

export const sitemapArticles = () =>
  query<{ id: number; updated_at: string }>(
    "SELECT id, updated_at FROM articles WHERE status = 'published' AND published_at <= now() ORDER BY id",
  );

export const sitemapAuthors = () =>
  query<{ id: number; updated_at: string }>(
    `SELECT u.id, MAX(a.updated_at) AS updated_at FROM users u JOIN articles a ON a.author_id = u.id
     WHERE u.status = 'active' AND a.status = 'published' AND a.published_at <= now() GROUP BY u.id`,
  );

export const sitemapTags = () =>
  query<{ id: number; updated_at: string }>(
    `SELECT t.id, MAX(a.updated_at) AS updated_at FROM tags t JOIN article_tags at ON at.tag_id = t.id
     JOIN articles a ON a.id = at.article_id WHERE a.status = 'published' AND a.published_at <= now() GROUP BY t.id`,
  );

export const getTags = () =>
  query<Tag & { count: number }>(
    `SELECT t.id, t.name, (SELECT COUNT(*)::int FROM article_tags WHERE tag_id = t.id) AS count
     FROM tags t ORDER BY t.name`,
  );
export const getTag = (id: number) => one<Tag>("SELECT id, name FROM tags WHERE id = $1", [id]);

export type Author = { id: number; name: string; bio: string; role: string; status: string; email: string; created_at: string };
export const getAuthor = (id: number) =>
  one<Author>("SELECT id, name, bio, role, status, email, created_at FROM users WHERE id = $1", [id]);

export const getAuthors = () =>
  query<{ id: number; name: string; role: string }>("SELECT id, name, role FROM users WHERE status = 'active' ORDER BY name");

export async function homeData() {
  const pub = { publicOnly: true } as const;
  const featured =
    (await listArticles({ ...pub, featured: true, limit: 1 })).rows[0] ??
    (await listArticles({ ...pub, exclusive: false, limit: 1 })).rows[0];
  const used = featured ? [featured.id] : [];
  const secondary = (await listArticles({ ...pub, exclusive: false, excludeIds: used, limit: 3 })).rows;
  used.push(...secondary.map((a) => a.id));
  const latest = (await listArticles({ ...pub, exclusive: false, excludeIds: used, limit: 5 })).rows;
  const exclusives = (await listArticles({ ...pub, exclusive: true, excludeIds: featured ? [featured.id] : [], limit: 3 })).rows;
  return { featured, secondary, latest, exclusives };
}

export function logActivity(user: { id: number; name: string }, action: string, target = "") {
  return exec("INSERT INTO activity (user_id, user_name, action, target) VALUES ($1, $2, $3, $4)", [user.id, user.name, action, target]);
}

export async function dashboardStats(authorId?: number) {
  const scope = authorId ? " WHERE author_id = $1" : "";
  const args: SqlValue[] = authorId ? [authorId] : [];
  const byStatus = Object.fromEntries(
    (await query<{ status: string; n: number }>(`SELECT status, COUNT(*)::int AS n FROM articles${scope} GROUP BY status`, args)).map(
      (r) => [r.status, r.n],
    ),
  );
  const views = (await one<{ n: number }>(`SELECT COALESCE(SUM(views), 0)::int AS n FROM articles${scope}`, args))?.n ?? 0;
  const perCategory = await query<{ name: string; n: number }>(
    `SELECT c.name, COUNT(a.id)::int AS n FROM categories c LEFT JOIN articles a ON a.category_id = c.id${
      authorId ? " AND a.author_id = $1" : ""
    }
     GROUP BY c.id ORDER BY c.sort_order, c.id`,
    args,
  );
  const top = await query<ArticleRow>(`${BASE}${authorId ? " WHERE a.author_id = $1" : ""} ORDER BY a.views DESC LIMIT 5`, args);
  const counts = await one<{ users: number; categories: number; tags: number }>(
    "SELECT (SELECT COUNT(*)::int FROM users) AS users, (SELECT COUNT(*)::int FROM categories) AS categories, (SELECT COUNT(*)::int FROM tags) AS tags",
  );
  const authors = await query<{ id: number; name: string; n: number }>(
    `SELECT u.id, u.name, COUNT(a.id)::int AS n FROM users u LEFT JOIN articles a ON a.author_id = u.id AND a.status = 'published'
     WHERE u.role = 'author' GROUP BY u.id ORDER BY n DESC LIMIT 5`,
  );
  return { byStatus, views, perCategory, top, counts: counts ?? { users: 0, categories: 0, tags: 0 }, authors };
}

export const recentActivity = (limit = 10) =>
  query<{ id: number; user_name: string; action: string; target: string; created_at: string }>(
    "SELECT * FROM activity ORDER BY id DESC LIMIT $1",
    [limit],
  );

export async function getSocialLinks(): Promise<SocialLink[]> {
  const rows = new Map(
    (await query<{ platform: string; url: string; visible: boolean }>("SELECT platform, url, visible FROM social_links")).map((r) => [
      r.platform,
      r,
    ]),
  );
  return PLATFORMS.map((p) => {
    const row = rows.get(p.key);
    return { ...p, url: row?.url ?? p.home, visible: row ? !!row.visible : true };
  });
}

export const visibleSocialLinks = async () => (await getSocialLinks()).filter((l) => l.visible && l.url);

export async function categoryArticleCounts(): Promise<Record<number, number>> {
  const rows = await query<{ category_id: number; n: number }>(
    "SELECT category_id, COUNT(*)::int AS n FROM articles GROUP BY category_id",
  );
  return Object.fromEntries(rows.map((r) => [r.category_id, r.n]));
}

export type AdminUserRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  last_login: string | null;
  articles: number;
};

export const listUsers = (role?: string) =>
  query<AdminUserRow>(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, u.last_login,
     (SELECT COUNT(*)::int FROM articles WHERE author_id = u.id) AS articles
     FROM users u ${role ? "WHERE u.role = $1" : ""} ORDER BY u.role, u.name`,
    role ? [role] : [],
  );

export const userArticleStatusCounts = (id: number) =>
  query<{ status: string; n: number }>("SELECT status, COUNT(*)::int AS n FROM articles WHERE author_id = $1 GROUP BY status", [id]);

export const userLastLogin = async (id: number) =>
  (await one<{ last_login: string | null }>("SELECT last_login FROM users WHERE id = $1", [id]))?.last_login;
