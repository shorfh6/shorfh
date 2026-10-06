import Link from "next/link";
import Logo from "./Logo";
import { getCategories } from "@/lib/queries";
import { infoPages } from "@/lib/pages";

export default function Footer() {
  return (
    <footer className="foot">
      <div className="foot-top">
        <Logo />
        <nav>
          <Link href="/">الرئيسية</Link>
          {getCategories().map((c) => (
            <Link key={c.slug} href={`/category/${c.slug}`}>
              {c.name}
            </Link>
          ))}
        </nav>
      </div>
      <div className="foot-bottom">
        <nav>
          {infoPages.map((p) => (
            <Link key={p.slug} href={`/${p.slug}`}>
              {p.title}
            </Link>
          ))}
        </nav>
        <small>© {new Date().getFullYear()} شُرفة. جميع الحقوق محفوظة.</small>
      </div>
    </footer>
  );
}
