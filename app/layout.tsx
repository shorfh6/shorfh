import type { Metadata } from "next";
import { Cairo, Reem_Kufi } from "next/font/google";
import JsonLd from "@/components/JsonLd";
import { absoluteUrl, siteOrigin } from "@/lib/seo";
import "./globals.css";

const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "600", "700", "800"], variable: "--font-cairo" });
const kufi = Reem_Kufi({ subsets: ["arabic", "latin"], weight: ["700"], variable: "--font-kufi" });

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: { default: "شُرفة — نافذتك إلى العالم وأخباره", template: "%s | شُرفة" },
  description: "شُرفة: موقع إخباري يغطي المحليات والسياسة والرياضة والثقافة والتقنية.",
  applicationName: "شُرفة",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ar_SA",
    siteName: "شُرفة",
    title: "شُرفة — نافذتك إلى العالم وأخباره",
    description: "تغطية إخبارية للمحليات والسياسة والرياضة والثقافة والتقنية.",
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "شُرفة", description: "نافذتك إلى العالم وأخباره." },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteOrigin}/#organization`,
      name: "شُرفة",
      url: absoluteUrl("/"),
      logo: { "@type": "ImageObject", url: absoluteUrl("/logo.png") },
    },
    {
      "@type": "WebSite",
      "@id": `${siteOrigin}/#website`,
      name: "شُرفة",
      url: absoluteUrl("/"),
      inLanguage: "ar-SA",
      publisher: { "@id": `${siteOrigin}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl("/search")}?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${kufi.variable}`}>
      <body>
        <JsonLd data={structuredData} />
        {children}
      </body>
    </html>
  );
}
