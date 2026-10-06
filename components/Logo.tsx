import Link from "next/link";

export default function Logo() {
  return (
    <Link href="/" className="brand" aria-label="شُرفة — نافذتك إلى العالم وأخباره">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="شُرفة" className="logo-img" />
    </Link>
  );
}
