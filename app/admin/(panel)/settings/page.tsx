import { requireUser } from "@/lib/auth";
import { getSocialLinks } from "@/lib/queries";
import { saveSocialLinks } from "../../actions";
import Notice from "@/components/admin/Notice";

type Props = { searchParams: Promise<{ m?: string; e?: string }> };

export const metadata = { title: "إعدادات الموقع" };

export default async function SettingsPage({ searchParams }: Props) {
  await requireUser(["admin"]);
  const sp = await searchParams;
  const links = await getSocialLinks();

  return (
    <>
      <h1 className="page-h">إعدادات الموقع</h1>
      <Notice m={sp.m} e={sp.e} />

      <section className="card-a">
        <div className="card-h">
          <h2>حسابات التواصل الاجتماعي</h2>
        </div>
        <p className="muted">تظهر الأيقونات في أسفل الموقع. اترك الرابط فارغاً أو ألغِ التفعيل لإخفاء المنصة.</p>
        <form action={saveSocialLinks} className="rows">
          {links.map((l) => (
            <div className="social-row" key={l.key}>
              <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true">
                <path d={l.path} />
              </svg>
              <strong>{l.label}</strong>
              <input name={`url_${l.key}`} defaultValue={l.url} placeholder="https://..." dir="ltr" maxLength={300} />
              <label className="switch">
                <input type="checkbox" name={`visible_${l.key}`} defaultChecked={l.visible} /> إظهار
              </label>
            </div>
          ))}
          <button className="btn-primary">حفظ</button>
        </form>
      </section>
    </>
  );
}
