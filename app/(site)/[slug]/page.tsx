import { notFound } from "next/navigation";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { getInfoPage, infoPages } from "@/lib/pages";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export const generateStaticParams = () => infoPages.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getInfoPage(slug);
  return page
    ? { title: page.title, description: page.intro, alternates: { canonical: `/${slug}` } }
    : {};
}

export default async function InfoPageView({ params }: Props) {
  const { slug } = await params;
  const page = getInfoPage(slug);
  if (!page) notFound();
  const faqSchema = slug === "faq" ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.sections.map((section) => ({
      "@type": "Question",
      name: section.heading,
      acceptedAnswer: { "@type": "Answer", text: section.paragraphs.join(" ") },
    })),
  } : null;

  return (
    <main className="wrap">
      {faqSchema && <JsonLd data={faqSchema} />}
      <article className="article info">
        <h1 className="sec-title">{page.title}</h1>
        <p className="lead">{page.intro}</p>
        {page.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
