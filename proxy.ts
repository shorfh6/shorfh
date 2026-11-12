import { NextResponse, type NextRequest } from "next/server";
import { infoPages } from "@/lib/pages";
import { getAuthor, getCategoryBySlug, getPublishedArticle, getTag } from "@/lib/queries";

const infoSlugs = new Set(infoPages.map((p) => p.slug));

async function exists(parts: string[]): Promise<boolean> {
  const [section, param] = parts;
  const id = Number(param);
  if (section === "article" && parts.length === 2) return Number.isInteger(id) && !!(await getPublishedArticle(id));
  if (section === "category" && parts.length === 2) return !!(await getCategoryBySlug(param));
  if (section === "author" && parts.length === 2) {
    const a = Number.isInteger(id) ? await getAuthor(id) : undefined;
    return !!a && a.status === "active";
  }
  if (section === "tag" && parts.length === 2) return Number.isInteger(id) && !!(await getTag(id));
  return parts.length === 1 && infoSlugs.has(section);
}

// Existence checks must run before the response starts streaming, otherwise
// the not-found UI is served with a 200 status (soft 404).
export async function proxy(request: NextRequest) {
  if (request.headers.get("next-router-prefetch") || request.headers.get("purpose") === "prefetch") {
    return NextResponse.next();
  }
  const parts = request.nextUrl.pathname.split("/").filter(Boolean);
  try {
    if (await exists(parts)) return NextResponse.next();
  } catch {
    return NextResponse.next();
  }
  return NextResponse.rewrite(new URL("/_not-found", request.url));
}

export const config = {
  matcher: [
    "/article/:id",
    "/category/:slug",
    "/author/:id",
    "/tag/:id",
    { source: "/((?!api|admin|search|uploads|_next)[^/.]+)", locale: false },
  ],
};
