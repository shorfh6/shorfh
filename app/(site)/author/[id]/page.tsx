import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleCard from "@/components/ArticleCard";
import JsonLd from "@/components/JsonLd";
import Pagination from "@/components/Pagination";
import { getAuthor, listArticles } from "@/lib/queries";
import { roleLabels } from "@/lib/format";
import { absoluteUrl } from "@/lib/seo";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> };
const PER_PAGE = 12;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const author = getAuthor(Number((await params).id));
  if (!author) return {};
  return {
    title: author.name,
    description: author.bio || `مقالات وأخبار بقلم ${author.name} في شُرفة.`,
    alternates: { canonical: `/author/${author.id}${page > 1 ? `?page=${page}` : ""}` },
  };
}

export default async function AuthorPage({ params, searchParams }: Props) {
  const id = Number((await params).id);
  const author = getAuthor(id);
  if (!author || author.status !== "active") notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { rows, total } = listArticles({ publicOnly: true, authorId: id, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

  return (
    <main className="wrap">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "ProfilePage", name: author.name, url: absoluteUrl(`/author/${id}`), mainEntity: { "@type": "Person", name: author.name, description: author.bio, url: absoluteUrl(`/author/${id}`) } }} />
      <div className="author-box">
        <div className="avatar">{author.name.charAt(0)}</div>
        <div>
          <h1>{author.name}</h1>
          <span className="cat">{roleLabels[author.role]}</span>
          {author.bio && <p className="muted">{author.bio}</p>}
        </div>
      </div>
      {rows.length ? (
        <div className="cards cards3">
          {rows.map((a) => (
            <ArticleCard key={a.id} article={a} />
          ))}
        </div>
      ) : (
        <p className="empty">لا توجد مقالات منشورة بعد.</p>
      )}
      <Pagination page={page} total={total} perPage={PER_PAGE} basePath={`/author/${id}`} />
    </main>
  );
}
