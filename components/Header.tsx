"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "./Logo";

export default function Header({ categories }: { categories: { slug: string; name: string }[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");

  const links = [{ slug: "", name: "الرئيسية", href: "/" }, ...categories.map((c) => ({ ...c, href: `/category/${c.slug}` }))];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header className="top">
      <Logo />

      <nav className="nav">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={isActive(l.href) ? "active" : ""}>
            {l.name}
          </Link>
        ))}
      </nav>

      <form onSubmit={submit} className="search-form" role="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث في الأخبار" aria-label="بحث" />
      </form>
    </header>
  );
}
