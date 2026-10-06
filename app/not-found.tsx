import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap" style={{ textAlign: "center", padding: "80px 0" }}>
      <h1 className="sec-title" style={{ display: "inline-block" }}>الصفحة غير موجودة</h1>
      <p className="empty">
        <Link href="/" className="btn">العودة للرئيسية</Link>
      </p>
    </main>
  );
}
