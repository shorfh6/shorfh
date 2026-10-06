import Link from "next/link";
import Image from "next/image";
import type { ArticleRow } from "@/lib/queries";
import { imageUrl } from "@/lib/format";

export default function LatestNews({ items }: { items: ArticleRow[] }) {
  return (
    <aside className="latest">
      <h2 className="side-title">آخر الأخبار</h2>
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            <Link href={`/article/${a.id}`}>
              <span>{a.title}</span>
              <span className="thumb">
                {a.image && <Image src={imageUrl(a.image)} alt="" fill sizes="54px" unoptimized />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/search" className="more">
        المزيد من الأخبار <b>‹</b>
      </Link>
    </aside>
  );
}
