"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };

export default function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="side-nav">
      {items.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={active ? "on" : ""}>
            <span aria-hidden>{i.icon}</span>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
