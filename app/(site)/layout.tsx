import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getCategories } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header categories={getCategories().map((c) => ({ slug: c.slug, name: c.name }))} />
      {children}
      <Footer />
    </>
  );
}
