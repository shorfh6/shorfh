import { canReview, requireUser } from "@/lib/auth";
import { getAuthors, getCategories, getTags } from "@/lib/queries";
import ArticleForm from "@/components/admin/ArticleForm";

export const metadata = { title: "خبر جديد" };

export default async function NewArticle() {
  const user = await requireUser();
  const reviewer = canReview(user.role);
  const [categories, tags, authorList] = await Promise.all([
    getCategories(),
    getTags(),
    reviewer ? getAuthors() : Promise.resolve([]),
  ]);
  return (
    <>
      <h1 className="page-h">خبر جديد</h1>
      <ArticleForm
        categories={categories}
        tags={tags}
        selectedTagIds={[]}
        authors={authorList}
        reviewer={reviewer}
        defaultAuthorId={user.id}
      />
    </>
  );
}
