import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import JsonLd from "@/components/JsonLd";
import Pagination from "@/components/Pagination";
import { getCategoryBySlug, listArticles } from "@/lib/queries";
import { absoluteUrl } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };
const PER_PAGE = 12;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const category = getCategoryBySlug(slug);
  if (!category) return {};
  return {
    title: category.name,
    description: category.description || `آخر الأخبار والتقارير في قسم ${category.name} من شُرفة.`,
    alternates: { canonical: `/category/${slug}${page > 1 ? `?page=${page}` : ""}` },
    openGraph: { type: "website", title: category.name, description: category.description, url: absoluteUrl(`/category/${slug}${page > 1 ? `?page=${page}` : ""}`), locale: "ar_SA", siteName: "شُرفة" },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  if (!category) notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { rows, total } = listArticles({ publicOnly: true, categorySlug: slug, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

  return (
    <main className="wrap">
      <h1 className="sec-title page-title">{category.name}</h1>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: category.name,
          description: category.description,
          url: absoluteUrl(`/category/${slug}`),
          inLanguage: "ar-SA",
          mainEntity: {
            "@type": "ItemList",
            itemListElement: rows.map((a, i) => ({ "@type": "ListItem", position: (page - 1) * PER_PAGE + i + 1, url: absoluteUrl(`/article/${a.id}`), name: a.title })),
          },
        }}
      />
      {category.description && <p className="muted">{category.description}</p>}
      {rows.length ? (
        <div className="cards cards3">
          {rows.map((a) => (
            <ArticleCard key={a.id} article={a} />
          ))}
        </div>
      ) : (
        <p className="empty">لا توجد أخبار في هذا القسم حالياً.</p>
      )}
      <Pagination page={page} total={total} perPage={PER_PAGE} basePath={`/category/${slug}`} />
    </main>
  );
}
