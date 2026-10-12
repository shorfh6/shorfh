import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listUsers } from "@/lib/queries";
import { formatDate, formatDateTime, roleLabels } from "@/lib/format";
import { createUser } from "../../actions";
import Notice from "@/components/admin/Notice";

type Props = { searchParams: Promise<{ m?: string; e?: string; role?: string }> };

export const metadata = { title: "المستخدمون" };

export default async function UsersPage({ searchParams }: Props) {
  await requireUser(["admin"]);
  const sp = await searchParams;
  const role = sp.role && sp.role in roleLabels ? sp.role : undefined;
  const users = await listUsers(role);

  return (
    <>
      <h1 className="page-h">المستخدمون والكتّاب</h1>
      <Notice m={sp.m} e={sp.e} />

      <div className="tabs">
        <Link href="/admin/users" className={!role ? "on" : ""}>
          الكل
        </Link>
        {Object.entries(roleLabels).map(([k, v]) => (
          <Link key={k} href={`/admin/users?role=${k}`} className={role === k ? "on" : ""}>
            {v}
          </Link>
        ))}
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>البريد</th>
              <th>الدور</th>
              <th>الحالة</th>
              <th>الأخبار</th>
              <th>آخر دخول</th>
              <th>انضم</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/admin/users/${u.id}`}>{u.name}</Link>
                </td>
                <td dir="ltr">{u.email}</td>
                <td>
                  <span className={`role-chip r-${u.role}`}>{roleLabels[u.role]}</span>
                </td>
                <td>
                  <span className={`badge-s ${u.status === "active" ? "s-published" : "s-rejected"}`}>{u.status === "active" ? "نشط" : "معطّل"}</span>
                </td>
                <td>{u.articles}</td>
                <td>{formatDateTime(u.last_login)}</td>
                <td>{formatDate(u.created_at)}</td>
                <td>
                  <Link href={`/admin/users/${u.id}`}>إدارة</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card-a form-card">
        <h2>إضافة مستخدم / كاتب</h2>
        <form action={createUser} className="grid-form">
          <label>
            الاسم
            <input name="name" required maxLength={80} />
          </label>
          <label>
            البريد الإلكتروني
            <input name="email" type="email" required dir="ltr" />
          </label>
          <label>
            الدور
            <select name="role" defaultValue="author">
              {Object.entries(roleLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            كلمة المرور (12 حرفاً على الأقل)
            <input name="password" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" dir="ltr" />
          </label>
          <label className="full">
            نبذة (تظهر في صفحة الكاتب)
            <input name="bio" maxLength={500} />
          </label>
          <button className="btn-primary">إضافة</button>
        </form>
      </section>
    </>
  );
}
