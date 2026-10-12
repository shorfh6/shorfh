import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import ArticleBody from "@/components/ArticleBody";
import JsonLd from "@/components/JsonLd";
import ShareButtons from "@/components/ShareButtons";
import {
  adjacentArticles,
  authorPublishedCount,
  getArticleTags,
  getAuthor,
  getPublishedArticle,
  incrementViews,
  listArticles,
  mostViewed,
  relatedArticles,
} from "@/lib/queries";
import { coverStyle, formatDate, formatDateTime, imageUrl, readingTimeLabel } from "@/lib/format";
import { absoluteUrl } from "@/lib/seo";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = getPublishedArticle(Number((await params).id));
  if (!a) return {};
  return {
    title: a.title,
    description: a.excerpt,
    alternates: { canonical: `/article/${a.id}` },
    openGraph: {
      type: "article",
      title: a.title,
      description: a.excerpt,
      url: absoluteUrl(`/article/${a.id}`),
      publishedTime: a.published_at ?? undefined,
      authors: a.author_name ? [a.author_name] : undefined,
      images: a.image ? [imageUrl(a.image)] : undefined,
      locale: "ar_SA",
      siteName: "شُرفة",
    },
    twitter: { card: "summary_large_image", title: a.title, description: a.excerpt, images: a.image ? [imageUrl(a.image)] : undefined },
  };
}

export default async function ArticlePage({ params }: Props) {
  const id = Number((await params).id);
  const a = getPublishedArticle(id);
  if (!a) notFound();
  const h = await headers();
  if (
    !h.get("next-router-prefetch") &&
    h.get("purpose") !== "prefetch" &&
    !/bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview/i.test(h.get("user-agent") ?? "")
  ) {
    incrementViews(id);
  }

  const tags = getArticleTags(a.id);
  const related = relatedArticles(a, 3);
  const { prev, next } = adjacentArticles(a);
  const popular = mostViewed(5, a.id);
  const latest = listArticles({ publicOnly: true, excludeIds: [a.id], limit: 5 }).rows;
  const author = a.author_id ? getAuthor(a.author_id) : undefined;
  const words = a.body.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  const updated = a.published_at && new Date(a.updated_at).getTime() - new Date(a.published_at).getTime() > 3600_000;
  const canonical = absoluteUrl(`/article/${a.id}`);
  const authorUrl = a.author_id ? absoluteUrl(`/author/${a.author_id}`) : undefined;
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    headline: a.title,
    description: a.excerpt,
    articleBody: a.body.replace(/^##\s*/gm, ""),
    image: a.image ? [absoluteUrl(imageUrl(a.image))] : undefined,
    datePublished: a.published_at,
    dateModified: a.updated_at,
    author: author
      ? { "@type": "Person", name: author.name, url: authorUrl }
      : { "@type": "Organization", name: "فريق التحرير", url: absoluteUrl("/") },
    publisher: { "@type": "Organization", name: "شُرفة", url: absoluteUrl("/"), logo: { "@type": "ImageObject", url: absoluteUrl("/logo.png") } },
    articleSection: a.category_name,
    keywords: tags.map((tag) => tag.name),
    inLanguage: "ar-SA",
    isAccessibleForFree: true,
    wordCount: words,
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: a.category_name, item: absoluteUrl(`/category/${a.category_slug}`) },
      { "@type": "ListItem", position: 3, name: a.title, item: canonical },
    ],
  };

  return (
    <main className="wrap">
      <JsonLd data={[articleSchema, breadcrumbSchema]} />
      <nav className="crumbs" aria-label="مسار التنقل">
        <Link href="/">الرئيسية</Link>
        <span>›</span>
        <Link href={`/category/${a.category_slug}`}>{a.category_name}</Link>
        <span>›</span>
        <span className="muted">{a.title}</span>
      </nav>

      <div className="article-layout">
        <article className="article">
          <Link href={`/category/${a.category_slug}`} className="cat">
            {a.category_name}
          </Link>
          <h1>{a.title}</h1>
          {a.excerpt && <p className="lead">{a.excerpt}</p>}

          <div className="meta-bar">
            <span>
              ✍ {author && author.status === "active" ? <Link href={`/author/${author.id}`}>{author.name}</Link> : "فريق التحرير"}
            </span>
            <span>
              📅 <time dateTime={a.published_at ?? undefined}>{formatDate(a.published_at)}</time>
            </span>
            <span>⏱ {readingTimeLabel(minutes)}</span>
            <span>👁 {a.views.toLocaleString("ar-SA")} مشاهدة</span>
          </div>
          {updated && <p className="updated">آخر تحديث: {formatDateTime(a.updated_at)}</p>}

          {a.image && <div className="img" style={coverStyle(a.image)} role="img" aria-label={a.title} />}

          <div className="body">
            <ArticleBody text={a.body} />
          </div>

          {tags.length > 0 && (
            <div className="tags">
              {tags.map((t) => (
                <Link key={t.id} href={`/tag/${t.id}`}>
                  #{t.name}
                </Link>
              ))}
            </div>
          )}

          <ShareButtons title={a.title} />

          {a.source_url && (
            <p className="source">
              المصدر: <a href={a.source_url} target="_blank" rel="noopener noreferrer nofollow">الخبر الأصلي</a>
            </p>
          )}

          {author && author.status === "active" && (
            <div className="author-box">
              <div className="avatar">{author.name.charAt(0)}</div>
              <div>
                <h3>
                  <Link href={`/author/${author.id}`}>{author.name}</Link>
                </h3>
                {author.bio && <p className="muted">{author.bio}</p>}
                <Link href={`/author/${author.id}`} className="link">
                  {authorPublishedCount(author.id)} مقالاً منشوراً ‹
                </Link>
              </div>
            </div>
          )}

          {(prev || next) && (
            <div className="prev-next">
              {prev ? (
                <Link href={`/article/${prev.id}`}>
                  <small>› الخبر السابق</small>
                  {prev.title}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={`/article/${next.id}`} className="next">
                  <small>الخبر التالي ‹</small>
                  {next.title}
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </article>

        <aside className="article-side">
          <section className="latest">
            <h2 className="side-title">الأكثر قراءة</h2>
            <ol className="ranked">
              {popular.map((p, i) => (
                <li key={p.id}>
                  <b>{i + 1}</b>
                  <Link href={`/article/${p.id}`}>
                    {p.title}
                    <small>{p.views.toLocaleString("ar-SA")} مشاهدة</small>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
          <section className="latest">
            <h2 className="side-title">آخر الأخبار</h2>
            <ul>
              {latest.map((l) => (
                <li key={l.id}>
                  <Link href={`/article/${l.id}`}>
                    <span>{l.title}</span>
                    <i className="thumb" style={coverStyle(l.image)} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="exclusive">
          <h2 className="sec-title">أخبار ذات صلة</h2>
          <div className="cards cards3">
            {related.map((r) => (
              <ArticleCard key={r.id} article={r} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
