import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { UPLOAD_DIR } from "@/lib/db";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const type = TYPES[path.extname(name).toLowerCase()];
  if (!type || !/^[\w.-]+$/.test(name)) return new Response("Not found", { status: 404 });
  const file = path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, name);
  try {
    const { size } = statSync(file);
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { "content-type": type, "content-length": String(size), "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
