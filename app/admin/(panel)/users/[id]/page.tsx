import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAuthor } from "@/lib/queries";
import { formatDateTime, roleLabels } from "@/lib/format";
import { deleteUser, updateUser } from "../../../actions";
import ConfirmButton from "@/components/admin/ConfirmButton";
import Notice from "@/components/admin/Notice";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string; e?: string }> };

export const metadata = { title: "إدارة مستخدم" };

export default async function UserPage({ params, searchParams }: Props) {
  const me = await requireUser(["admin"]);
  const id = Number((await params).id);
  const u = getAuthor(id);
  if (!u) notFound();
  const sp = await searchParams;
  const counts = db
    .prepare("SELECT status, COUNT(*) AS n FROM articles WHERE author_id = ? GROUP BY status")
    .all(id) as { status: string; n: number }[];
  const last = (db.prepare("SELECT last_login FROM users WHERE id = ?").get(id) as { last_login: string | null }).last_login;
  const self = me.id === id;

  return (
    <>
      <div className="page-head">
        <h1 className="page-h">{u.name}</h1>
        <Link href="/admin/users" className="btn-ghost">
          → العودة للمستخدمين
        </Link>
      </div>
      <Notice m={sp.m} e={sp.e} />

      <div className="edit-grid">
        <section className="card-a form-card">
          <form action={updateUser} className="grid-form">
            <input type="hidden" name="id" value={id} />
            <label>
              الاسم
              <input name="name" defaultValue={u.name} required maxLength={80} />
            </label>
            <label>
              البريد الإلكتروني
              <input name="email" type="email" defaultValue={u.email} required dir="ltr" />
            </label>
            <label>
              الدور
              <select name="role" defaultValue={u.role} disabled={self}>
                {Object.entries(roleLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {self && <input type="hidden" name="role" value={u.role} />}
            </label>
            <label>
              الحالة
              <select name="status" defaultValue={u.status} disabled={self}>
                <option value="active">نشط</option>
                <option value="disabled">معطّل</option>
              </select>
              {self && <input type="hidden" name="status" value={u.status} />}
            </label>
            <label className="full">
              النبذة
              <input name="bio" defaultValue={u.bio} maxLength={500} />
            </label>
            <label className="full">
              كلمة مرور جديدة (اتركها فارغة دون تغيير)
              <input name="password" type="password" minLength={12} maxLength={1024} autoComplete="new-password" dir="ltr" />
            </label>
            <button className="btn-primary">حفظ التغييرات</button>
          </form>
        </section>

        <aside className="side-panel">
          <section className="card-a">
            <h3>إحصاءات</h3>
            <dl className="meta">
              <dt>آخر دخول</dt>
              <dd>{formatDateTime(last)}</dd>
              {counts.map((c) => (
                <div key={c.status} className="meta-row">
                  <dt>{{ draft: "مسودات", pending: "بانتظار المراجعة", published: "منشورة", rejected: "مرفوضة" }[c.status]}</dt>
                  <dd>{c.n}</dd>
                </div>
              ))}
            </dl>
            <Link href={`/admin/articles?author=${id}`} className="btn-ghost block">
              عرض أخباره
            </Link>
          </section>
          {!self && (
            <section className="card-a">
              <form action={deleteUser}>
                <input type="hidden" name="id" value={id} />
                <ConfirmButton message="حذف هذا المستخدم؟ ستبقى أخباره دون كاتب." className="btn-danger block">
                  حذف المستخدم
                </ConfirmButton>
              </form>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
