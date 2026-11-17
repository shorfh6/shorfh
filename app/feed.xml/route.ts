import { query } from "@/lib/db";
import { absoluteUrl, siteOrigin } from "@/lib/seo";
import { composeArticleTweet } from "@/lib/x";

export const runtime = "nodejs";
export const revalidate = 300;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET() {
  let items = "";
  try {
    const rows = await query<{ id: number; title: string; excerpt: string; category: string; tags: string; published_at: string }>(
      `SELECT a.id,a.title,a.excerpt,a.published_at,c.name AS category,
         COALESCE((SELECT string_agg(t.name,' ') FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id),'') AS tags
       FROM articles a JOIN categories c ON c.id=a.category_id
       WHERE a.status='published' AND a.published_at <= now() ORDER BY a.published_at DESC LIMIT 50`,
    );
    items = rows
      .map((a) => {
        const url = absoluteUrl(`/article/${a.id}`);
        const hashtags = [...a.tags.split(/\s+/).filter(Boolean), a.category];
        const tweet = composeArticleTweet({ title: a.title, excerpt: a.excerpt, hashtags, url });
        return `    <item>
      <title>${esc(a.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${esc(tweet)}</description>
      ${a.tags ? `<category>${esc(a.category)}</category>` : ""}
      <pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
    </item>`;
      })
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
