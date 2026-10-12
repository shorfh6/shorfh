"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import {
  canDeleteArticle,
  canEditArticle,
  canReview,
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import { exec, one, tx, type Q } from "@/lib/db";
import { getArticle, logActivity } from "@/lib/queries";
import { PLATFORMS } from "@/lib/social";
import { deleteImage, putImage } from "@/lib/storage";

const str = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);
const num = (fd: FormData, k: string) => Number(fd.get(k)) || 0;
const now = () => new Date().toISOString();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ---------- auth ---------- */

const g = globalThis as unknown as { __loginAttempts?: Map<string, { startedAt: number; count: number }> };
const DUMMY_HASH = hashPassword("dummy-password-for-timing");
const MAX_LOGINS_PER_MINUTE = 10;

export async function login(_prev: { error?: string } | undefined, fd: FormData): Promise<{ error?: string }> {
  const email = str(fd, "email", 200).toLowerCase();
  const password = String(fd.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const timestamp = Date.now();
  const attempts = (g.__loginAttempts ??= new Map());
  if (attempts.size > 1000) {
    for (const [key, entry] of attempts) {
      if (timestamp - entry.startedAt >= 60_000) attempts.delete(key);
    }
  }
  let window = attempts.get(ip);
  if (!window || timestamp - window.startedAt >= 60_000) {
    window = { startedAt: timestamp, count: 0 };
    attempts.set(ip, window);
  }
  if (window.count >= MAX_LOGINS_PER_MINUTE) return { error: "محاولات كثيرة، حاول مرة أخرى بعد دقيقة" };

  const user = await one<{ id: number; password_hash: string; status: string }>(
    "SELECT id, password_hash, status FROM users WHERE email = $1",
    [email],
  );
  const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && user && user.status === "active";
  if (!ok || !user) {
    window.count++;
    return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  }
  await exec("UPDATE users SET last_login = $1 WHERE id = $2", [now(), user.id]);
  await createSession(user.id);
  redirect("/admin");
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}

/* ---------- articles ---------- */

export type ArticleFormState = { error?: string; values?: Record<string, string>; tagIds?: number[] } | undefined;

const MIME_BY_EXT: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

async function saveUpload(file: File): Promise<string | null> {
  if (file.size === 0) return "";
  if (file.size > 5 * 1024 * 1024) return null;
  const buf = Buffer.from(await file.arrayBuffer());
  let ext = "";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = ".jpg";
  else if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ext = ".png";
  else if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") ext = ".webp";
  if (!ext) return null;
  const name = `${randomBytes(12).toString("hex")}${ext}`;
  await putImage(name, buf, MIME_BY_EXT[ext]);
  return name;
}

async function removeUploadIfUnused(name: string) {
  if (!name || /^https?:\/\//.test(name) || !/^[\w.-]+$/.test(name)) return;
  if (await one("SELECT 1 FROM articles WHERE image = $1", [name])) return;
  try {
    await deleteImage(name);
  } catch {}
}

async function syncTags(q: Q, articleId: number, tagIds: number[], newTags: string) {
  const ids = new Set<number>();
  for (const id of tagIds) {
    if (await q.one("SELECT 1 FROM tags WHERE id = $1", [id])) ids.add(id);
  }
  for (const raw of newTags.split(/[,،]/)) {
    const name = raw.trim().replace(/^#/, "").slice(0, 40);
    if (!name) continue;
    await q.exec("INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
    const row = await q.one<{ id: number }>("SELECT id FROM tags WHERE name = $1", [name]);
    if (row) ids.add(row.id);
  }
  await q.exec("DELETE FROM article_tags WHERE article_id = $1", [articleId]);
  for (const t of ids) await q.exec("INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2)", [articleId, t]);
}

export async function saveArticle(_prev: ArticleFormState, fd: FormData): Promise<ArticleFormState> {
  const user = await requireUser();
  const id = num(fd, "id");
  const intent = str(fd, "intent", 20);
  const existing = id ? await getArticle(id) : undefined;
  if (id && !existing) redirect("/admin/articles?e=notfound");
  if (existing && !canEditArticle(user, existing)) redirect("/admin/articles?e=forbidden");

  const values = {
    title: str(fd, "title", 200),
    excerpt: str(fd, "excerpt", 500),
    body: String(fd.get("body") ?? "").trim().slice(0, 200_000),
    image: str(fd, "image", 500),
    category: str(fd, "category", 10),
    author: str(fd, "author", 10),
    newTags: str(fd, "newTags", 200),
    featured: fd.get("featured") ? "1" : "",
    exclusive: fd.get("exclusive") ? "1" : "",
  };
  const tagIds = fd.getAll("tags").map(Number).filter(Boolean);
  const fail = (error: string): ArticleFormState => ({ error, values, tagIds });

  if (!values.title) return fail("العنوان مطلوب");
  if (!values.body) return fail("نص الخبر مطلوب");
  const categoryId = Number(values.category);
  if (!(await one("SELECT 1 FROM categories WHERE id = $1", [categoryId]))) return fail("اختر تصنيفاً صحيحاً");

  let image = values.image;
  if (image && !/^https:\/\//.test(image) && !/^[\w.-]+\.(jpg|png|webp)$/i.test(image)) return fail("رابط الصورة يجب أن يبدأ بـ https");
  const file = fd.get("imageFile");
  if (file instanceof File && file.size > 0) {
    const saved = await saveUpload(file);
    if (!saved) return fail("الصورة غير صالحة: استخدم JPG أو PNG أو WEBP بحجم لا يتجاوز 5 ميجابايت");
    image = saved;
  }

  const reviewer = canReview(user.role);
  let authorId = existing?.author_id ?? user.id;
  if (reviewer && (await one("SELECT 1 FROM users WHERE id = $1", [Number(values.author)]))) authorId = Number(values.author);

  let status: string = existing?.status ?? "draft";
  let publishedAt = existing?.published_at ?? null;
  if (reviewer) {
    if (intent === "publish") status = "published";
    else if (intent === "draft") status = "draft";
    else if (intent === "pending") status = "pending";
  } else {
    status = intent === "submit" ? "pending" : "draft";
  }
  if (status === "published" && !publishedAt) publishedAt = now();
  const featured = reviewer ? !!values.featured : (existing?.featured ?? false);
  const exclusive = reviewer ? !!values.exclusive : (existing?.exclusive ?? false);
  const rejectReason = status === "draft" || status === "rejected" ? (existing?.reject_reason ?? "") : "";

  let articleId = id;
  await tx(async (q) => {
    if (existing) {
      await q.exec(
        `UPDATE articles SET title=$1, excerpt=$2, body=$3, image=$4, category_id=$5, author_id=$6, status=$7, featured=$8, exclusive=$9,
         reject_reason=$10, published_at=$11, updated_at=$12 WHERE id=$13`,
        [values.title, values.excerpt, values.body, image, categoryId, authorId, status, featured, exclusive, rejectReason, publishedAt, now(), id],
      );
    } else {
      const row = await q.one<{ id: number }>(
        `INSERT INTO articles (title, excerpt, body, image, category_id, author_id, status, featured, exclusive, published_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [values.title, values.excerpt, values.body, image, categoryId, authorId, status, featured, exclusive, publishedAt, now(), now()],
      );
      articleId = row?.id ?? 0;
    }
    await syncTags(q, articleId, tagIds, values.newTags);
  });
  if (existing && existing.image && existing.image !== image) await removeUploadIfUnused(existing.image);

  await logActivity(user, existing ? "عدّل الخبر" : "أنشأ الخبر", values.title);
  redirect(`/admin/articles/${articleId}?m=${status === "pending" && !reviewer ? "submitted" : existing ? "saved" : "created"}`);
}

export async function approveArticle(fd: FormData) {
  const user = await requireUser(["admin", "editor"]);
  const a = await getArticle(num(fd, "id"));
  if (!a) redirect("/admin/articles?e=notfound");
  await exec(
    "UPDATE articles SET status='published', published_at=COALESCE(published_at, $1), reject_reason='', updated_at=$2 WHERE id=$3",
    [now(), now(), a.id],
  );
  await logActivity(user, "اعتمد الخبر", a.title);
  const back = String(fd.get("back") ?? "");
  redirect(`${back.startsWith("/admin/") && !back.includes("?") ? back : "/admin/articles"}?m=approved`);
}

export async function rejectArticle(fd: FormData) {
  const user = await requireUser(["admin", "editor"]);
  const a = await getArticle(num(fd, "id"));
  if (!a) redirect("/admin/articles?e=notfound");
  const reason = str(fd, "reason", 500);
  if (!reason) redirect(`/admin/articles/${a.id}?e=reason`);
  await exec("UPDATE articles SET status='rejected', reject_reason=$1, updated_at=$2 WHERE id=$3", [reason, now(), a.id]);
  await logActivity(user, "رفض الخبر", a.title);
  redirect("/admin/articles?m=rejected");
}

export async function deleteArticle(fd: FormData) {
  const user = await requireUser();
  const a = await getArticle(num(fd, "id"));
  if (!a) redirect("/admin/articles?e=notfound");
  if (!canDeleteArticle(user, a)) redirect("/admin/articles?e=forbidden");
  await exec("DELETE FROM articles WHERE id = $1", [a.id]);
  await removeUploadIfUnused(a.image);
  await logActivity(user, "حذف الخبر", a.title);
  redirect("/admin/articles?m=deleted");
}

/* ---------- users ---------- */

const ROLES = ["admin", "editor", "author"];

const activeAdmins = async (excludeId: number) =>
  (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND status='active' AND id != $1", [excludeId]))
    ?.n ?? 0;

export async function createUser(fd: FormData) {
  const me = await requireUser(["admin"]);
  const name = str(fd, "name", 80);
  const email = str(fd, "email", 200).toLowerCase();
  const role = str(fd, "role", 10);
  const password = String(fd.get("password") ?? "");
  if (!name || !EMAIL_RE.test(email) || !ROLES.includes(role)) redirect("/admin/users?e=invalid");
  if (password.length < 12) redirect("/admin/users?e=weak");
  if (Buffer.byteLength(password, "utf8") > 1024) redirect("/admin/users?e=long");
  try {
    await exec("INSERT INTO users (name, email, password_hash, role, bio) VALUES ($1, $2, $3, $4, $5)", [
      name,
      email,
      hashPassword(password),
      role,
      str(fd, "bio", 500),
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") redirect("/admin/users?e=email");
    throw e;
  }
  await logActivity(me, "أضاف مستخدماً", name);
  redirect("/admin/users?m=created");
}

export async function updateUser(fd: FormData) {
  const me = await requireUser(["admin"]);
  const id = num(fd, "id");
  const target = await one<{ id: number; role: string; status: string; name: string }>(
    "SELECT id, role, status, name FROM users WHERE id = $1",
    [id],
  );
  if (!target) redirect("/admin/users?e=notfound");
  const back = `/admin/users/${id}`;
  const name = str(fd, "name", 80);
  const email = str(fd, "email", 200).toLowerCase();
  const role = str(fd, "role", 10);
  const status = str(fd, "status", 10) === "disabled" ? "disabled" : "active";
  if (!name || !EMAIL_RE.test(email) || !ROLES.includes(role)) redirect(`${back}?e=invalid`);
  if (id === me.id && (role !== target.role || status !== target.status)) redirect(`${back}?e=self`);
  if (target.role === "admin" && (role !== "admin" || status !== "active") && (await activeAdmins(id)) === 0)
    redirect(`${back}?e=lastadmin`);
  const password = String(fd.get("password") ?? "");
  if (password && password.length < 12) redirect(`${back}?e=weak`);
  if (Buffer.byteLength(password, "utf8") > 1024) redirect(`${back}?e=long`);
  try {
    await exec("UPDATE users SET name=$1, email=$2, role=$3, status=$4, bio=$5 WHERE id=$6", [
      name,
      email,
      role,
      status,
      str(fd, "bio", 500),
      id,
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") redirect(`${back}?e=email`);
    throw e;
  }
  if (password) await exec("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(password), id]);
  if (status === "disabled" || password) await exec("DELETE FROM sessions WHERE user_id = $1", [id]);
  await logActivity(me, "عدّل المستخدم", name);
  redirect(`${back}?m=saved`);
}

export async function deleteUser(fd: FormData) {
  const me = await requireUser(["admin"]);
  const id = num(fd, "id");
  const target = await one<{ id: number; role: string; name: string }>("SELECT id, role, name FROM users WHERE id = $1", [id]);
  if (!target) redirect("/admin/users?e=notfound");
  if (id === me.id) redirect(`/admin/users/${id}?e=self`);
  if (target.role === "admin" && (await activeAdmins(id)) === 0) redirect(`/admin/users/${id}?e=lastadmin`);
  await exec("DELETE FROM users WHERE id = $1", [id]);
  await logActivity(me, "حذف المستخدم", target.name);
  redirect("/admin/users?m=deleted");
}

/* ---------- categories & tags ---------- */

export async function saveCategory(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const id = num(fd, "id");
  const name = str(fd, "name", 60);
  const slug = str(fd, "slug", 60).toLowerCase();
  if (!name || !SLUG_RE.test(slug)) redirect("/admin/taxonomy?e=invalid");
  const desc = str(fd, "description", 300);
  const order = num(fd, "sort_order");
  try {
    if (id)
      await exec("UPDATE categories SET name=$1, slug=$2, description=$3, sort_order=$4 WHERE id=$5", [name, slug, desc, order, id]);
    else await exec("INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4)", [name, slug, desc, order]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") redirect("/admin/taxonomy?e=dup");
    throw e;
  }
  await logActivity(me, id ? "عدّل التصنيف" : "أضاف تصنيفاً", name);
  redirect(`/admin/taxonomy?m=${id ? "saved" : "created"}`);
}

export async function deleteCategory(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const id = num(fd, "id");
  const cat = await one<{ name: string }>("SELECT name FROM categories WHERE id = $1", [id]);
  if (!cat) redirect("/admin/taxonomy?e=notfound");
  try {
    await exec("DELETE FROM categories WHERE id = $1", [id]);
  } catch (e) {
    if ((e as { code?: string }).code === "23503") redirect("/admin/taxonomy?e=inuse");
    throw e;
  }
  await logActivity(me, "حذف التصنيف", cat.name);
  redirect("/admin/taxonomy?m=deleted");
}

export async function createTags(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const names = str(fd, "names", 300)
    .split(/[,،]/)
    .map((n) => n.trim().replace(/^#/, "").slice(0, 40))
    .filter(Boolean);
  if (!names.length) redirect("/admin/taxonomy?e=invalid");
  for (const n of names) await exec("INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [n]);
  await logActivity(me, "أضاف وسوماً", names.join("، "));
  redirect("/admin/taxonomy?m=created");
}

export async function renameTag(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const name = str(fd, "name", 40).replace(/^#/, "");
  if (!name) redirect("/admin/taxonomy?e=invalid");
  try {
    await exec("UPDATE tags SET name = $1 WHERE id = $2", [name, num(fd, "id")]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") redirect("/admin/taxonomy?e=dup");
    throw e;
  }
  await logActivity(me, "عدّل وسماً", name);
  redirect("/admin/taxonomy?m=saved");
}

export async function deleteTag(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const tag = await one<{ name: string }>("SELECT name FROM tags WHERE id = $1", [num(fd, "id")]);
  if (!tag) redirect("/admin/taxonomy?e=notfound");
  await exec("DELETE FROM tags WHERE id = $1", [num(fd, "id")]);
  await logActivity(me, "حذف وسماً", tag.name);
  redirect("/admin/taxonomy?m=deleted");
}

/* ---------- site settings ---------- */

export async function saveSocialLinks(fd: FormData) {
  const me = await requireUser(["admin"]);
  const rows = PLATFORMS.map((p) => ({ key: p.key, url: str(fd, `url_${p.key}`, 300), visible: !!fd.get(`visible_${p.key}`) }));
  if (rows.some((r) => r.url && !/^https:\/\/[^\s]+$/i.test(r.url))) redirect("/admin/settings?e=url");
  await tx(async (q) => {
    for (const r of rows) {
      await q.exec(
        "INSERT INTO social_links (platform, url, visible) VALUES ($1, $2, $3) ON CONFLICT(platform) DO UPDATE SET url = excluded.url, visible = excluded.visible",
        [r.key, r.url, r.visible],
      );
    }
  });
  await logActivity(me, "عدّل روابط التواصل");
  redirect("/admin/settings?m=saved");
}

/* ---------- account ---------- */

export async function updateProfile(fd: FormData) {
  const me = await requireUser();
  const name = str(fd, "name", 80);
  if (!name) redirect("/admin/account?e=invalid");
  await exec("UPDATE users SET name = $1, bio = $2 WHERE id = $3", [name, str(fd, "bio", 500), me.id]);
  redirect("/admin/account?m=saved");
}

export async function changePassword(fd: FormData) {
  const me = await requireUser();
  const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [me.id]);
  if (!row || !verifyPassword(String(fd.get("current") ?? ""), row.password_hash)) redirect("/admin/account?e=wrong");
  const next = String(fd.get("next") ?? "");
  if (next.length < 12) redirect("/admin/account?e=weak");
  if (Buffer.byteLength(next, "utf8") > 1024) redirect("/admin/account?e=long");
  if (next !== String(fd.get("confirm") ?? "")) redirect("/admin/account?e=invalid");
  await tx(async (q) => {
    await q.exec("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(next), me.id]);
    await q.exec("DELETE FROM sessions WHERE user_id = $1", [me.id]);
  });
  await createSession(me.id);
  redirect("/admin/account?m=password");
}
