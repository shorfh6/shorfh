"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { db, UPLOAD_DIR } from "@/lib/db";
import { getArticle, logActivity } from "@/lib/queries";
import { PLATFORMS } from "@/lib/social";

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

  const user = db.prepare("SELECT id, password_hash, status FROM users WHERE email = ?").get(email) as
    | { id: number; password_hash: string; status: string }
    | undefined;
  const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && user && user.status === "active";
  if (!ok || !user) {
    window.count++;
    return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  }
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(now(), user.id);
  await createSession(user.id);
  redirect("/admin");
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}

/* ---------- articles ---------- */

export type ArticleFormState = { error?: string; values?: Record<string, string>; tagIds?: number[] } | undefined;

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
  await writeFile(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, name), buf);
  return name;
}

async function removeUploadIfUnused(name: string) {
  if (!name || /^https?:\/\//.test(name) || !/^[\w.-]+$/.test(name)) return;
  if (db.prepare("SELECT 1 FROM articles WHERE image = ?").get(name)) return;
  try {
    await unlink(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, name));
  } catch {}
}

function syncTags(articleId: number, tagIds: number[], newTags: string) {
  const ids = new Set(tagIds.filter((id) => db.prepare("SELECT 1 FROM tags WHERE id = ?").get(id)));
  for (const raw of newTags.split(/[,،]/)) {
    const name = raw.trim().replace(/^#/, "").slice(0, 40);
    if (!name) continue;
    db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(name);
    ids.add((db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: number }).id);
  }
  db.prepare("DELETE FROM article_tags WHERE article_id = ?").run(articleId);
  const ins = db.prepare("INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)");
  ids.forEach((t) => ins.run(articleId, t));
}

export async function saveArticle(_prev: ArticleFormState, fd: FormData): Promise<ArticleFormState> {
  const user = await requireUser();
  const id = num(fd, "id");
  const intent = str(fd, "intent", 20);
  const existing = id ? getArticle(id) : undefined;
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
  if (!db.prepare("SELECT 1 FROM categories WHERE id = ?").get(categoryId)) return fail("اختر تصنيفاً صحيحاً");

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
  if (reviewer && db.prepare("SELECT 1 FROM users WHERE id = ?").get(Number(values.author))) authorId = Number(values.author);

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
  const featured = reviewer ? (values.featured ? 1 : 0) : (existing?.featured ?? 0);
  const exclusive = reviewer ? (values.exclusive ? 1 : 0) : (existing?.exclusive ?? 0);
  const rejectReason = status === "draft" || status === "rejected" ? (existing?.reject_reason ?? "") : "";

  let articleId = id;
  const run = db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE articles SET title=?, excerpt=?, body=?, image=?, category_id=?, author_id=?, status=?, featured=?, exclusive=?,
         reject_reason=?, published_at=?, updated_at=? WHERE id=?`,
      ).run(values.title, values.excerpt, values.body, image, categoryId, authorId, status, featured, exclusive, rejectReason, publishedAt, now(), id);
    } else {
      articleId = Number(
        db
          .prepare(
            `INSERT INTO articles (title, excerpt, body, image, category_id, author_id, status, featured, exclusive, published_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(values.title, values.excerpt, values.body, image, categoryId, authorId, status, featured, exclusive, publishedAt, now(), now()).lastInsertRowid,
      );
    }
    syncTags(articleId, tagIds, values.newTags);
  });
  run();
  if (existing && existing.image && existing.image !== image) await removeUploadIfUnused(existing.image);

  logActivity(user, existing ? "عدّل الخبر" : "أنشأ الخبر", values.title);
  redirect(`/admin/articles/${articleId}?m=${status === "pending" && !reviewer ? "submitted" : existing ? "saved" : "created"}`);
}

export async function approveArticle(fd: FormData) {
  const user = await requireUser(["admin", "editor"]);
  const a = getArticle(num(fd, "id"));
  if (!a) redirect("/admin/articles?e=notfound");
  db.prepare("UPDATE articles SET status='published', published_at=COALESCE(published_at, ?), reject_reason='', updated_at=? WHERE id=?").run(now(), now(), a.id);
  logActivity(user, "اعتمد الخبر", a.title);
  const back = String(fd.get("back") ?? "");
  redirect(`${back.startsWith("/admin/") && !back.includes("?") ? back : "/admin/articles"}?m=approved`);
}

export async function rejectArticle(fd: FormData) {
  const user = await requireUser(["admin", "editor"]);
  const a = getArticle(num(fd, "id"));
  if (!a) redirect("/admin/articles?e=notfound");
  const reason = str(fd, "reason", 500);
  if (!reason) redirect(`/admin/articles/${a.id}?e=reason`);
  db.prepare("UPDATE articles SET status='rejected', reject_reason=?, updated_at=? WHERE id=?").run(reason, now(), a.id);
  logActivity(user, "رفض الخبر", a.title);
  redirect("/admin/articles?m=rejected");
}

export async function deleteArticle(fd: FormData) {
  const user = await requireUser();
  const a = getArticle(num(fd, "id"));
  if (!a) redirect("/admin/articles?e=notfound");
  if (!canDeleteArticle(user, a)) redirect("/admin/articles?e=forbidden");
  db.prepare("DELETE FROM articles WHERE id = ?").run(a.id);
  await removeUploadIfUnused(a.image);
  logActivity(user, "حذف الخبر", a.title);
  redirect("/admin/articles?m=deleted");
}

/* ---------- users ---------- */

const ROLES = ["admin", "editor", "author"];

const activeAdmins = (excludeId: number) =>
  (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active' AND id != ?").get(excludeId) as { n: number }).n;

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
    db.prepare("INSERT INTO users (name, email, password_hash, role, bio, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      name, email, hashPassword(password), role, str(fd, "bio", 500), now(),
    );
  } catch {
    redirect("/admin/users?e=email");
  }
  logActivity(me, "أضاف مستخدماً", name);
  redirect("/admin/users?m=created");
}

export async function updateUser(fd: FormData) {
  const me = await requireUser(["admin"]);
  const id = num(fd, "id");
  const target = db.prepare("SELECT id, role, status, name FROM users WHERE id = ?").get(id) as { id: number; role: string; status: string; name: string } | undefined;
  if (!target) redirect("/admin/users?e=notfound");
  const back = `/admin/users/${id}`;
  const name = str(fd, "name", 80);
  const email = str(fd, "email", 200).toLowerCase();
  const role = str(fd, "role", 10);
  const status = str(fd, "status", 10) === "disabled" ? "disabled" : "active";
  if (!name || !EMAIL_RE.test(email) || !ROLES.includes(role)) redirect(`${back}?e=invalid`);
  if (id === me.id && (role !== target.role || status !== target.status)) redirect(`${back}?e=self`);
  if (target.role === "admin" && (role !== "admin" || status !== "active") && activeAdmins(id) === 0) redirect(`${back}?e=lastadmin`);
  const password = String(fd.get("password") ?? "");
  if (password && password.length < 12) redirect(`${back}?e=weak`);
  if (Buffer.byteLength(password, "utf8") > 1024) redirect(`${back}?e=long`);
  try {
    db.prepare("UPDATE users SET name=?, email=?, role=?, status=?, bio=? WHERE id=?").run(name, email, role, status, str(fd, "bio", 500), id);
  } catch {
    redirect(`${back}?e=email`);
  }
  if (password) db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), id);
  if (status === "disabled" || password) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  logActivity(me, "عدّل المستخدم", name);
  redirect(`${back}?m=saved`);
}

export async function deleteUser(fd: FormData) {
  const me = await requireUser(["admin"]);
  const id = num(fd, "id");
  const target = db.prepare("SELECT id, role, name FROM users WHERE id = ?").get(id) as { id: number; role: string; name: string } | undefined;
  if (!target) redirect("/admin/users?e=notfound");
  if (id === me.id) redirect(`/admin/users/${id}?e=self`);
  if (target.role === "admin" && activeAdmins(id) === 0) redirect(`/admin/users/${id}?e=lastadmin`);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  logActivity(me, "حذف المستخدم", target.name);
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
    if (id) db.prepare("UPDATE categories SET name=?, slug=?, description=?, sort_order=? WHERE id=?").run(name, slug, desc, order, id);
    else db.prepare("INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)").run(name, slug, desc, order);
  } catch {
    redirect("/admin/taxonomy?e=dup");
  }
  logActivity(me, id ? "عدّل التصنيف" : "أضاف تصنيفاً", name);
  redirect(`/admin/taxonomy?m=${id ? "saved" : "created"}`);
}

export async function deleteCategory(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const id = num(fd, "id");
  const cat = db.prepare("SELECT name FROM categories WHERE id = ?").get(id) as { name: string } | undefined;
  if (!cat) redirect("/admin/taxonomy?e=notfound");
  try {
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  } catch {
    redirect("/admin/taxonomy?e=inuse");
  }
  logActivity(me, "حذف التصنيف", cat.name);
  redirect("/admin/taxonomy?m=deleted");
}

export async function createTags(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const names = str(fd, "names", 300).split(/[,،]/).map((n) => n.trim().replace(/^#/, "").slice(0, 40)).filter(Boolean);
  if (!names.length) redirect("/admin/taxonomy?e=invalid");
  const ins = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
  names.forEach((n) => ins.run(n));
  logActivity(me, "أضاف وسوماً", names.join("، "));
  redirect("/admin/taxonomy?m=created");
}

export async function renameTag(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const name = str(fd, "name", 40).replace(/^#/, "");
  if (!name) redirect("/admin/taxonomy?e=invalid");
  try {
    db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, num(fd, "id"));
  } catch {
    redirect("/admin/taxonomy?e=dup");
  }
  logActivity(me, "عدّل وسماً", name);
  redirect("/admin/taxonomy?m=saved");
}

export async function deleteTag(fd: FormData) {
  const me = await requireUser(["admin", "editor"]);
  const tag = db.prepare("SELECT name FROM tags WHERE id = ?").get(num(fd, "id")) as { name: string } | undefined;
  if (!tag) redirect("/admin/taxonomy?e=notfound");
  db.prepare("DELETE FROM tags WHERE id = ?").run(num(fd, "id"));
  logActivity(me, "حذف وسماً", tag.name);
  redirect("/admin/taxonomy?m=deleted");
}

/* ---------- site settings ---------- */

export async function saveSocialLinks(fd: FormData) {
  const me = await requireUser(["admin"]);
  const rows = PLATFORMS.map((p) => ({ key: p.key, url: str(fd, `url_${p.key}`, 300), visible: fd.get(`visible_${p.key}`) ? 1 : 0 }));
  if (rows.some((r) => r.url && !/^https:\/\/[^\s]+$/i.test(r.url))) redirect("/admin/settings?e=url");
  const up = db.prepare(
    "INSERT INTO social_links (platform, url, visible) VALUES (?, ?, ?) ON CONFLICT(platform) DO UPDATE SET url = excluded.url, visible = excluded.visible",
  );
  db.transaction(() => rows.forEach((r) => up.run(r.key, r.url, r.visible)))();
  logActivity(me, "عدّل روابط التواصل");
  redirect("/admin/settings?m=saved");
}

/* ---------- account ---------- */

export async function updateProfile(fd: FormData) {
  const me = await requireUser();
  const name = str(fd, "name", 80);
  if (!name) redirect("/admin/account?e=invalid");
  db.prepare("UPDATE users SET name = ?, bio = ? WHERE id = ?").run(name, str(fd, "bio", 500), me.id);
  redirect("/admin/account?m=saved");
}

export async function changePassword(fd: FormData) {
  const me = await requireUser();
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(me.id) as { password_hash: string };
  if (!verifyPassword(String(fd.get("current") ?? ""), row.password_hash)) redirect("/admin/account?e=wrong");
  const next = String(fd.get("next") ?? "");
  if (next.length < 12) redirect("/admin/account?e=weak");
  if (Buffer.byteLength(next, "utf8") > 1024) redirect("/admin/account?e=long");
  if (next !== String(fd.get("confirm") ?? "")) redirect("/admin/account?e=invalid");
  const update = db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), me.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(me.id);
  });
  update();
  await createSession(me.id);
  redirect("/admin/account?m=password");
}
