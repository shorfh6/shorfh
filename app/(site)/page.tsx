import Link from "next/link";
import Image from "next/image";
import ArticleCard from "@/components/ArticleCard";
import LatestNews from "@/components/LatestNews";
import Banner from "@/components/Banner";
import { homeData } from "@/lib/queries";
import { imageUrl } from "@/lib/format";

export default async function Home() {
  const { featured: hero, secondary, latest, exclusives } = await homeData();

  return (
    <>
      <main className="wrap home-grid">
        <section>
          {hero ? (
            <article className="feature">
              <Link href={`/article/${hero.id}`}>
                <div className="img">
                  {hero.image && <Image src={imageUrl(hero.image)} alt={hero.title} fill sizes="(max-width: 700px) 100vw, 75vw" priority unoptimized />}
                </div>
              </Link>
              <div className="feature-body">
                <span className="cat">{hero.category_name}</span>
                <h1>{hero.title}</h1>
                <p>{hero.excerpt}</p>
                <Link href={`/article/${hero.id}`} className="btn">
                  اقرأ الخبر ←
                </Link>
              </div>
            </article>
          ) : (
            <p className="empty">لا توجد أخبار منشورة بعد.</p>
          )}

          <div className="cards">
            {secondary.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        </section>

        <LatestNews items={latest} />
      </main>

      {exclusives.length > 0 && (
        <section className="wrap exclusive">
          <div className="sec-head">
            <h2 className="sec-title">حصريات شُرفة</h2>
            <Link href="/search" className="link">
              ‹ عرض جميع الأخبار
            </Link>
          </div>
          <div className="cards cards3">
            {exclusives.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        </section>
      )}

      <Banner />
    </>
  );
}
