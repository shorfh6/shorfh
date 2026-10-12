import path from "node:path";
import { getCurrentUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { getImage } from "@/lib/storage";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const type = TYPES[path.extname(name).toLowerCase()];
  if (!type || !/^[\w.-]+$/.test(name)) return new Response("Not found", { status: 404 });

  const pub = await one("SELECT 1 FROM articles WHERE image = $1 AND status = 'published' AND published_at <= now()", [name]);
  if (!pub) {
    const user = await getCurrentUser();
    if (!user) return new Response("Not found", { status: 404 });
  }

  const image = await getImage(name);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(image.body, {
    headers: {
      "content-type": image.contentType || type,
      ...(image.size !== undefined ? { "content-length": String(image.size) } : {}),
      "cache-control": pub ? "public, max-age=86400, stale-while-revalidate=604800" : "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
