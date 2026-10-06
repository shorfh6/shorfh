import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, canReview } from "@/lib/auth";
import { roleLabels } from "@/lib/format";
import { logout } from "../actions";
import AdminNav, { type NavItem } from "@/components/admin/AdminNav";
import Logo from "@/components/Logo";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user) redirect("/admin/login");

  const items: NavItem[] = [
    { href: "/admin", label: "نظرة عامة", icon: "▦" },
    { href: "/admin/articles", label: canReview(user.role) ? "الأخبار" : "أخباري", icon: "✎" },
  ];
  if (canReview(user.role)) items.push({ href: "/admin/taxonomy", label: "التصنيفات والوسوم", icon: "◈" });
  if (user.role === "admin") items.push({ href: "/admin/users", label: "المستخدمون والكتّاب", icon: "☺" });
  items.push({ href: "/admin/account", label: "حسابي", icon: "⚙" });

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-logo">
          <Logo />
        </div>
        <AdminNav items={items} />
        <Link href="/" className="side-site" target="_blank">
          ↗ عرض الموقع
        </Link>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div>
            <strong>{user.name}</strong>
            <span className="role-chip">{roleLabels[user.role]}</span>
          </div>
          <form action={logout}>
            <button className="btn-ghost">تسجيل الخروج</button>
          </form>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
