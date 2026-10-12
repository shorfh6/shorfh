import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const categories = await getCategories();
  return (
    <>
      <Header categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />
      {children}
      <Footer />
    </>
  );
}
