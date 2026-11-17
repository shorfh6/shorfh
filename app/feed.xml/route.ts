import { query } from "@/lib/db";
import { absoluteUrl, siteOrigin } from "@/lib/seo";

export const runtime = "nodejs";
export const revalidate = 300;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET() {
  let items = "";
  try {
    const rows = await query<{ id: number; title: string; excerpt: string; published_at: string }>(
      "SELECT id,title,excerpt,published_at FROM articles WHERE status='published' AND published_at <= now() ORDER BY published_at DESC LIMIT 50",
    );
    items = rows
      .map(
        (a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${absoluteUrl(`/article/${a.id}`)}</link>
      <guid isPermaLink="true">${absoluteUrl(`/article/${a.id}`)}</guid>
      <description>${esc(a.excerpt || "")}</description>
      <pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
    </item>`,
      )
      .join("\n");
  } catch {
    // An empty-but-valid feed is safer than a 500 for RSS consumers.
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>شُرفة الإخبارية</title>
    <link>${siteOrigin}/</link>
    <description>آخر الأخبار المنشورة في شُرفة الإخبارية</description>
    <language>ar</language>
${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
