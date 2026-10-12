import Link from "next/link";
import { canDeleteArticle, canReview, requireUser } from "@/lib/auth";
import { getAuthors, getCategories, listArticles } from "@/lib/queries";
import { coverStyle, formatDate, statusLabels } from "@/lib/format";
import { approveArticle, deleteArticle } from "../../actions";
import ConfirmButton from "@/components/admin/ConfirmButton";
import Notice from "@/components/admin/Notice";
import StatusBadge from "@/components/admin/StatusBadge";
import Pagination from "@/components/Pagination";

type Props = { searchParams: Promise<{ status?: string; category?: string; author?: string; q?: string; page?: string; m?: string; e?: string }> };
const PER_PAGE = 15;

export const metadata = { title: "الأخبار" };

export default async function ArticlesPage({ searchParams }: Props) {
  const user = await requireUser();
  const sp = await searchParams;
  const reviewer = canReview(user.role);
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status && sp.status in statusLabels ? sp.status : undefined;

  const { rows, total } = await listArticles({
    status,
    categoryId: Number(sp.category) || undefined,
    authorId: reviewer ? Number(sp.author) || undefined : user.id,
    q: sp.q,
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
    order: "updated",
  });

  const query: Record<string, string> = {};
  for (const k of ["status", "category", "author", "q"] as const) if (sp[k]) query[k] = sp[k]!;
  const [categories, authorList] = await Promise.all([getCategories(), reviewer ? getAuthors() : Promise.resolve([])]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-h">{reviewer ? "إدارة الأخبار" : "أخباري"}</h1>
        <Link href="/admin/articles/new" className="btn-primary">
          + خبر جديد
        </Link>
      </div>
      <Notice m={sp.m} e={sp.e} />

      <div className="tabs">
        <Link href="/admin/articles" className={!status ? "on" : ""}>
          الكل
        </Link>
        {Object.entries(statusLabels).map(([k, v]) => (
          <Link key={k} href={`/admin/articles?status=${k}`} className={status === k ? "on" : ""}>
            {v}
          </Link>
        ))}
      </div>

      <form className="filters" method="get">
        {status && <input type="hidden" name="status" value={status} />}
        <input name="q" defaultValue={sp.q} placeholder="بحث في العنوان أو النص" />
        <select name="category" defaultValue={sp.category ?? ""}>
          <option value="">كل التصنيفات</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {reviewer && (
          <select name="author" defaultValue={sp.author ?? ""}>
            <option value="">كل الكتّاب</option>
            {authorList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn-ghost">تصفية</button>
      </form>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>الخبر</th>
              <th>التصنيف</th>
              <th>الكاتب</th>
              <th>الحالة</th>
              <th>آخر تحديث</th>
              <th>المشاهدات</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="cell-title">
                    <i className="mini" style={coverStyle(a.image)} />
                    <Link href={`/admin/articles/${a.id}`}>{a.title}</Link>
                    {a.featured ? <span className="tag-s">رئيسي</span> : null}
                    {a.exclusive ? <span className="tag-s">حصري</span> : null}
                  </div>
                </td>
                <td>{a.category_name}</td>
                <td>{a.author_name ?? "—"}</td>
                <td>
                  <StatusBadge status={a.status} />
                </td>
                <td>{formatDate(a.updated_at)}</td>
                <td>{a.views}</td>
                <td>
                  <div className="row-actions">
                    <Link href={`/admin/articles/${a.id}`}>{reviewer && a.status === "pending" ? "مراجعة" : "تعديل"}</Link>
                    {a.status === "published" && (
                      <Link href={`/article/${a.id}`} target="_blank">
                        عرض
                      </Link>
                    )}
                    {reviewer && a.status !== "published" && (
                      <form action={approveArticle}>
                        <input type="hidden" name="id" value={a.id} />
                        <ConfirmButton message="اعتماد الخبر ونشره؟" className="btn-link ok">
                          قبول
                        </ConfirmButton>
                      </form>
                    )}
                    {canDeleteArticle(user, a) && (
                      <form action={deleteArticle}>
                        <input type="hidden" name="id" value={a.id} />
                        <ConfirmButton message="حذف الخبر نهائياً؟" className="btn-link bad">
                          حذف
                        </ConfirmButton>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="muted center">
                  لا توجد نتائج.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} perPage={PER_PAGE} basePath="/admin/articles" query={query} />
    </>
  );
}
