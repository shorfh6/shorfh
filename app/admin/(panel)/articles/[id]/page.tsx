import Link from "next/link";
import { notFound } from "next/navigation";
import { canDeleteArticle, canEditArticle, canReview, requireUser } from "@/lib/auth";
import { getArticle, getArticleTags, getAuthors, getCategories, getTags } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { approveArticle, deleteArticle, rejectArticle } from "../../../actions";
import ArticleForm from "@/components/admin/ArticleForm";
import ArticleBody from "@/components/ArticleBody";
import ConfirmButton from "@/components/admin/ConfirmButton";
import Notice from "@/components/admin/Notice";
import StatusBadge from "@/components/admin/StatusBadge";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string; e?: string }> };

export const metadata = { title: "تحرير خبر" };

export default async function EditArticle({ params, searchParams }: Props) {
  const user = await requireUser();
  const a = getArticle(Number((await params).id));
  if (!a) notFound();
  if (!canReview(user.role) && a.author_id !== user.id) notFound();
  const sp = await searchParams;
  const reviewer = canReview(user.role);
  const editable = canEditArticle(user, a);
  const selected = getArticleTags(a.id).map((t) => t.id);

  return (
    <>
      <div className="page-head">
        <h1 className="page-h">{a.title}</h1>
        <StatusBadge status={a.status} />
      </div>
      <Notice m={sp.m} e={sp.e} />

      {a.status === "rejected" && a.reject_reason && (
        <div className="notice err">
          <strong>سبب الرفض:</strong> {a.reject_reason}
        </div>
      )}
      {!editable && <div className="notice info">لا يمكن تعديل هذا الخبر في حالته الحالية.</div>}

      <div className="edit-grid">
        <div>
          {editable ? (
            <ArticleForm
              article={a}
              categories={getCategories()}
              tags={getTags()}
              selectedTagIds={selected}
              authors={reviewer ? getAuthors() : []}
              reviewer={reviewer}
            />
          ) : (
            <article className="card-a readonly">
              <p className="muted">{a.excerpt}</p>
              <ArticleBody text={a.body} />
            </article>
          )}
        </div>

        <aside className="side-panel">
          <section className="card-a">
            <h3>معلومات الخبر</h3>
            <dl className="meta">
              <dt>التصنيف</dt>
              <dd>{a.category_name}</dd>
              <dt>الكاتب</dt>
              <dd>{a.author_name ?? "—"}</dd>
              <dt>أُنشئ</dt>
              <dd>{formatDateTime(a.created_at)}</dd>
              <dt>آخر تحديث</dt>
              <dd>{formatDateTime(a.updated_at)}</dd>
              <dt>تاريخ النشر</dt>
              <dd>{formatDateTime(a.published_at)}</dd>
              <dt>المشاهدات</dt>
              <dd>{a.views}</dd>
            </dl>
            {a.status === "published" && (
              <Link href={`/article/${a.id}`} target="_blank" className="btn-ghost block">
                عرض في الموقع ↗
              </Link>
            )}
            {a.source_url && (
              <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="btn-ghost block">
                المصدر الأصلي ↗
              </a>
            )}
          </section>

          {reviewer && (
            <section className="card-a">
              <h3>المراجعة</h3>
              {a.status !== "published" && (
                <form action={approveArticle}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="back" value={`/admin/articles/${a.id}`} />
                  <button className="btn-ok block">قبول ونشر</button>
                </form>
              )}
              {a.status !== "rejected" && (
                <form action={rejectArticle} className="reject-form">
                  <input type="hidden" name="id" value={a.id} />
                  <textarea name="reason" rows={3} placeholder="سبب الرفض (يظهر للكاتب)" required />
                  <button className="btn-warn block">رفض الخبر</button>
                </form>
              )}
            </section>
          )}

          {canDeleteArticle(user, a) && (
            <section className="card-a">
              <form action={deleteArticle}>
                <input type="hidden" name="id" value={a.id} />
                <ConfirmButton message="حذف الخبر نهائياً؟ لا يمكن التراجع." className="btn-danger block">
                  حذف الخبر
                </ConfirmButton>
              </form>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
