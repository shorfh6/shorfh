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
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <h1 className="page-h" style={{ display: "inline-block" }}>
        حدث خطأ غير متوقع
      </h1>
      <p className="empty">
        <button className="btn-primary" onClick={retry}>
          حاول مرة أخرى
        </button>
      </p>
    </div>
  );
}
