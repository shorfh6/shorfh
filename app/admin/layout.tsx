import "./admin.css";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "لوحة التحكم", template: "%s | لوحة شُرفة" }, robots: { index: false, follow: false } };

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="adm">{children}</div>;
}
