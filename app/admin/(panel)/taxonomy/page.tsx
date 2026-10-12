import { requireUser } from "@/lib/auth";
import { categoryArticleCounts, getCategories, getTags } from "@/lib/queries";
import { createTags, deleteCategory, deleteTag, renameTag, saveCategory } from "../../actions";
import Notice from "@/components/admin/Notice";

type Props = { searchParams: Promise<{ m?: string; e?: string }> };

export const metadata = { title: "التصنيفات والوسوم" };

export default async function TaxonomyPage({ searchParams }: Props) {
  await requireUser(["admin", "editor"]);
  const sp = await searchParams;
  const [cats, tagList, counts] = await Promise.all([getCategories(), getTags(), categoryArticleCounts()]);

  return (
    <>
      <h1 className="page-h">التصنيفات والوسوم</h1>
      <Notice m={sp.m} e={sp.e} />

      <section className="card-a">
        <div className="card-h">
          <h2>التصنيفات (الأقسام)</h2>
        </div>
        <div className="rows">
          {cats.map((c) => (
            <form key={c.id} action={saveCategory} className="inline-form">
              <input type="hidden" name="id" value={c.id} />
              <input name="name" defaultValue={c.name} required maxLength={60} aria-label="الاسم" />
              <input name="slug" defaultValue={c.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" dir="ltr" aria-label="الرابط المختصر" />
              <input name="description" defaultValue={c.description} maxLength={300} aria-label="الوصف" />
              <input name="sort_order" type="number" defaultValue={c.sort_order} className="narrow" aria-label="الترتيب" />
              <span className="count">{counts[c.id] ?? 0} خبر</span>
              <button className="btn-ghost">حفظ</button>
              <button className="btn-link bad" formAction={deleteCategory} formNoValidate>
                حذف
              </button>
            </form>
          ))}
        </div>

        <form action={saveCategory} className="inline-form add">
          <input name="name" placeholder="اسم التصنيف" required maxLength={60} />
          <input name="slug" placeholder="slug-latin" required pattern="[a-z0-9]+(-[a-z0-9]+)*" dir="ltr" />
          <input name="description" placeholder="وصف (اختياري)" maxLength={300} />
          <input name="sort_order" type="number" placeholder="ترتيب" className="narrow" />
          <button className="btn-primary">+ إضافة تصنيف</button>
        </form>
      </section>

      <section className="card-a">
        <div className="card-h">
          <h2>الوسوم</h2>
        </div>
        <ul className="tag-list">
          {tagList.map((t) => (
            <li key={t.id}>
              <form action={renameTag} className="inline-form">
                <input type="hidden" name="id" value={t.id} />
                <input name="name" defaultValue={t.name} required maxLength={40} />
                <span className="count">{t.count}</span>
                <button className="btn-ghost">حفظ</button>
                <button className="btn-link bad" formAction={deleteTag} formNoValidate>
                  حذف
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createTags} className="inline-form add">
          <input name="names" placeholder="وسوم جديدة مفصولة بفاصلة" required maxLength={300} />
          <button className="btn-primary">+ إضافة</button>
        </form>
      </section>
    </>
  );
}
