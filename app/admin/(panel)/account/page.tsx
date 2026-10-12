import { requireUser } from "@/lib/auth";
import { roleLabels } from "@/lib/format";
import { changePassword, updateProfile } from "../../actions";
import Notice from "@/components/admin/Notice";

type Props = { searchParams: Promise<{ m?: string; e?: string }> };

export const metadata = { title: "حسابي" };

export default async function AccountPage({ searchParams }: Props) {
  const user = await requireUser();
  const sp = await searchParams;
  const bio = user.bio;

  return (
    <>
      <h1 className="page-h">حسابي</h1>
      <Notice m={sp.m} e={sp.e} />
      <div className="grid-2">
        <section className="card-a form-card">
          <h2>الملف الشخصي</h2>
          <p className="muted">
            {user.email} · {roleLabels[user.role]}
          </p>
          <form action={updateProfile} className="stack">
            <label>
              الاسم
              <input name="name" defaultValue={user.name} required maxLength={80} />
            </label>
            <label>
              النبذة
              <textarea name="bio" rows={3} defaultValue={bio} maxLength={500} />
            </label>
            <button className="btn-primary">حفظ</button>
          </form>
        </section>

        <section className="card-a form-card">
          <h2>تغيير كلمة المرور</h2>
          <form action={changePassword} className="stack">
            <label>
              كلمة المرور الحالية
              <input name="current" type="password" required autoComplete="current-password" dir="ltr" />
            </label>
            <label>
              كلمة المرور الجديدة
              <input name="next" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" dir="ltr" />
            </label>
            <label>
              تأكيد كلمة المرور
              <input name="confirm" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" dir="ltr" />
            </label>
            <button className="btn-primary">تحديث</button>
          </form>
        </section>
      </div>
    </>
  );
}
