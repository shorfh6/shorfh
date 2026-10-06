"use client";

import { useActionState } from "react";
import { saveArticle } from "@/app/admin/actions";
import { coverStyle } from "@/lib/format";

type Props = {
  article?: {
    id: number;
    title: string;
    excerpt: string;
    body: string;
    image: string;
    category_id: number;
    author_id: number | null;
    featured: number;
    exclusive: number;
    status: string;
  };
  categories: { id: number; name: string }[];
  tags: { id: number; name: string }[];
  selectedTagIds: number[];
  authors: { id: number; name: string }[];
  reviewer: boolean;
  defaultAuthorId?: number;
};

export default function ArticleForm({ article, categories, tags, selectedTagIds, authors, reviewer, defaultAuthorId }: Props) {
  const [state, action, pending] = useActionState(saveArticle, undefined);
  const v = state?.values;
  const tagIds = state?.tagIds ?? selectedTagIds;
  const image = v?.image ?? article?.image ?? "";

  return (
    <form action={action} className="editor" key={state ? JSON.stringify(state.values) : "init"}>
      {article && <input type="hidden" name="id" value={article.id} />}
      {state?.error && <div className="notice err">{state.error}</div>}

      <label>
        العنوان
        <input name="title" defaultValue={v?.title ?? article?.title ?? ""} maxLength={200} required />
      </label>

      <label>
        الملخص (يظهر في البطاقات ونتائج البحث)
        <textarea name="excerpt" rows={3} maxLength={500} defaultValue={v?.excerpt ?? article?.excerpt ?? ""} />
      </label>

      <label>
        نص الخبر
        <textarea name="body" rows={18} required defaultValue={v?.body ?? article?.body ?? ""} className="body-ta" />
        <small className="muted">افصل بين الفقرات بسطر فارغ. ابدأ السطر بـ ‎##‎ لعنوان فرعي.</small>
      </label>

      <div className="two">
        <label>
          التصنيف
          <select name="category" defaultValue={v?.category ?? article?.category_id ?? ""} required>
            <option value="" disabled>
              اختر التصنيف
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {reviewer && (
          <label>
            الكاتب
            <select name="author" defaultValue={v?.author ?? article?.author_id ?? defaultAuthorId ?? ""}>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <fieldset>
        <legend>الوسوم</legend>
        <div className="chips">
          {tags.map((t) => (
            <label key={t.id} className="chip">
              <input type="checkbox" name="tags" value={t.id} defaultChecked={tagIds.includes(t.id)} />
              {t.name}
            </label>
          ))}
        </div>
        <input name="newTags" placeholder="وسوم جديدة مفصولة بفاصلة" defaultValue={v?.newTags ?? ""} />
      </fieldset>

      <fieldset>
        <legend>صورة الخبر</legend>
        {image && <div className="preview" style={coverStyle(image)} />}
        <input type="file" name="imageFile" accept="image/jpeg,image/png,image/webp" />
        <input name="image" placeholder="أو رابط صورة يبدأ بـ https://" defaultValue={image} dir="ltr" />
      </fieldset>

      {reviewer && (
        <div className="checks">
          <label>
            <input type="checkbox" name="featured" defaultChecked={v ? !!v.featured : !!article?.featured} /> خبر رئيسي في الصفحة الرئيسية
          </label>
          <label>
            <input type="checkbox" name="exclusive" defaultChecked={v ? !!v.exclusive : !!article?.exclusive} /> حصري
          </label>
        </div>
      )}

      <div className="actions">
        {reviewer ? (
          <>
            <button name="intent" value="save" className="btn-primary" disabled={pending}>
              حفظ
            </button>
            <button name="intent" value="publish" className="btn-ok" disabled={pending}>
              حفظ ونشر
            </button>
            {article && article.status !== "draft" && (
              <button name="intent" value="draft" className="btn-ghost" disabled={pending}>
                تحويل إلى مسودة
              </button>
            )}
          </>
        ) : (
          <>
            <button name="intent" value="draft" className="btn-ghost" disabled={pending}>
              حفظ كمسودة
            </button>
            <button name="intent" value="submit" className="btn-primary" disabled={pending}>
              إرسال للمراجعة
            </button>
          </>
        )}
      </div>
    </form>
  );
}
