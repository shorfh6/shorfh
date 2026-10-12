import Link from "next/link";
import Logo from "./Logo";
import SocialLinks from "./SocialLinks";
import { infoPages } from "@/lib/pages";

export default function Footer() {
  return (
    <footer className="foot">
      <div className="foot-top">
        <Logo />
        <SocialLinks />
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
