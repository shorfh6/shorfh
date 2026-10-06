import ArticleCard from "@/components/ArticleCard";
import Pagination from "@/components/Pagination";
import { listArticles } from "@/lib/queries";

type Props = { searchParams: Promise<{ q?: string; page?: string }> };
const PER_PAGE = 12;

export const metadata = {
  title: "البحث",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = listArticles({ publicOnly: true, q, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

  return (
    <main className="wrap">
      <h1 className="sec-title page-title">{q.trim() ? `نتائج البحث: ${q}` : "جميع الأخبار"}</h1>
      {rows.length ? (
        <div className="cards cards3">
          {rows.map((a) => (
            <ArticleCard key={a.id} article={a} />
          ))}
        </div>
      ) : (
        <p className="empty">لا توجد نتائج مطابقة.</p>
      )}
      <Pagination page={page} total={total} perPage={PER_PAGE} basePath="/search" query={q ? { q } : undefined} />
    </main>
  );
}
