import { createReadStream, mkdirSync, statSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "article-images";

export const storageDriver: "supabase" | "local" = SUPABASE_URL && SUPABASE_KEY ? "supabase" : "local";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function requireConfigured() {
  if (storageDriver === "local" && process.env.NODE_ENV === "production") {
    throw new Error("Supabase Storage is not configured");
  }
}

const authHeaders = () => ({ Authorization: `Bearer ${SUPABASE_KEY}`, apikey: String(SUPABASE_KEY) });

export async function putImage(name: string, buf: Buffer, contentType: string): Promise<void> {
  requireConfigured();
  if (storageDriver === "local") {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, name), buf);
    return;
  }
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": contentType, "x-upsert": "false" },
    body: new Uint8Array(buf),
  });
  if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
}

export async function deleteImage(name: string): Promise<void> {
  requireConfigured();
  if (storageDriver === "local") {
    try {
      await unlink(path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, name));
    } catch {}
    return;
  }
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
}

export async function getImage(name: string): Promise<{ body: ReadableStream; contentType: string; size?: number } | null> {
  requireConfigured();
  if (storageDriver === "local") {
    const file = path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, name);
    try {
      const { size } = statSync(file);
      return {
        body: Readable.toWeb(createReadStream(file)) as ReadableStream,
        contentType: TYPES[path.extname(name).toLowerCase()] ?? "",
        size,
      };
    } catch {
      return null;
    }
  }
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${name}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok || !res.body) throw new Error(`Storage download failed (${res.status})`);
  const len = Number(res.headers.get("content-length"));
  return { body: res.body, contentType: res.headers.get("content-type") ?? "", size: len || undefined };
}
