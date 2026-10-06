import Link from "next/link";

type Props = { page: number; total: number; perPage: number; basePath: string; query?: Record<string, string> };

export default function Pagination({ page, total, perPage, basePath, query }: Props) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams({ ...query, page: String(p) });
    return `${basePath}?${params}`;
  };
  return (
    <nav className="pager" aria-label="التنقل بين الصفحات">
      {page > 1 && <Link href={href(page - 1)}>السابق</Link>}
      <span>
        {page} / {pages}
      </span>
      {page < pages && <Link href={href(page + 1)}>التالي</Link>}
    </nav>
  );
}
