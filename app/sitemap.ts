import type { MetadataRoute } from "next";
import { infoPages } from "@/lib/pages";
import { absoluteUrl } from "@/lib/seo";
import { sitemapArticles, sitemapAuthors, sitemapCategories, sitemapTags } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPages = ["", ...infoPages.map((p) => `/${p.slug}`)];
  const entries: MetadataRoute.Sitemap = staticPages.map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency: path ? "monthly" : "daily",
    priority: path ? 0.4 : 1,
  }));

  entries.push(
    ...sitemapCategories().map((c) => ({ url: absoluteUrl(`/category/${c.slug}`), changeFrequency: "daily" as const, priority: 0.7 })),
    ...sitemapArticles().map((a) => ({
      url: absoluteUrl(`/article/${a.id}`),
      lastModified: a.updated_at,
      changeFrequency: "yearly" as const,
      priority: 0.8,
    })),
    ...sitemapAuthors().map((a) => ({
      url: absoluteUrl(`/author/${a.id}`),
      lastModified: a.updated_at,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
    ...sitemapTags().map((t) => ({
      url: absoluteUrl(`/tag/${t.id}`),
      lastModified: t.updated_at,
      changeFrequency: "weekly" as const,
      priority: 0.3,
    })),
  );

  return entries;
}
