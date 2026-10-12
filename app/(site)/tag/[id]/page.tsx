import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import JsonLd from "@/components/JsonLd";
import Pagination from "@/components/Pagination";
import { getTag, listArticles } from "@/lib/queries";
import { absoluteUrl } from "@/lib/seo";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> };
const PER_PAGE = 12;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const t = await getTag(Number((await params).id));
  return t ? { title: `#${t.name}`, alternates: { canonical: `/tag/${t.id}${page > 1 ? `?page=${page}` : ""}` } } : {};
}

export default async function TagPage({ params, searchParams }: Props) {
  const id = Number((await params).id);
  const tag = await getTag(id);
  if (!tag) notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { rows, total } = await listArticles({ publicOnly: true, tagId: id, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

  return (
    <main className="wrap">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "CollectionPage", name: `#${tag.name}`, url: absoluteUrl(`/tag/${id}`), inLanguage: "ar-SA", mainEntity: { "@type": "ItemList", itemListElement: rows.map((a, i) => ({ "@type": "ListItem", position: (page - 1) * PER_PAGE + i + 1, url: absoluteUrl(`/article/${a.id}`), name: a.title })) } }} />
      <h1 className="sec-title page-title">#{tag.name}</h1>
      {rows.length ? (
        <div className="cards cards3">
          {rows.map((a) => (
            <ArticleCard key={a.id} article={a} />
          ))}
        </div>
      ) : (
        <p className="empty">لا توجد أخبار بهذا الوسم.</p>
      )}
      <Pagination page={page} total={total} perPage={PER_PAGE} basePath={`/tag/${id}`} />
    </main>
  );
}
