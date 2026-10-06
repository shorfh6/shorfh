import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";

export type Role = "admin" | "editor" | "author";
export type User = { id: number; name: string; email: string; role: Role; status: string; bio: string };

const COOKIE = "shurfa_session";
const SESSION_DAYS = 7;
const MAX_PASSWORD_BYTES = 1024;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function hashPassword(password: string) {
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) throw new Error("Password is too long");
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return false;
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(sha256(token), userId, expires);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expires),
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  jar.delete(COOKIE);
}

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.bio FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as User | undefined;
  return row && row.status === "active" ? row : null;
});

export async function requireUser(roles?: Role[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  if (roles && !roles.includes(user.role)) redirect("/admin?e=forbidden");
  return user;
}

export const canReview = (r: Role) => r === "admin" || r === "editor";
export const canManageTaxonomy = canReview;

type Owned = { author_id: number | null; status: string };
export const canEditArticle = (u: { id: number; role: Role }, a: Owned) =>
  canReview(u.role) || (a.author_id === u.id && (a.status === "draft" || a.status === "rejected"));
export const canDeleteArticle = canEditArticle;
