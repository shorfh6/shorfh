"use client";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry: () => void;
}) {
  return (
    <main className="wrap" style={{ textAlign: "center", padding: "80px 0" }}>
      <h1 className="sec-title" style={{ display: "inline-block" }}>
        حدث خطأ غير متوقع
      </h1>
      <p className="empty">
        <button className="btn" onClick={retry}>
          حاول مرة أخرى
        </button>
      </p>
    </main>
  );
}
