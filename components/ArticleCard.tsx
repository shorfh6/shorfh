import Link from "next/link";
import Image from "next/image";
import type { ArticleRow } from "@/lib/queries";
import { imageUrl } from "@/lib/format";

export default function ArticleCard({ article }: { article: ArticleRow }) {
  return (
    <Link href={`/article/${article.id}`} className="card">
      <div className="img">
        {article.image && <Image src={imageUrl(article.image)} alt={article.title} fill sizes="(max-width: 700px) 100vw, (max-width: 900px) 33vw, 380px" unoptimized />}
        {article.exclusive ? <span className="badge">حصري</span> : null}
      </div>
      <span className="cat">{article.category_name}</span>
      <h3>{article.title}</h3>
      <p>{article.excerpt}</p>
    </Link>
  );
}
