"use client";

import { useEffect, useState } from "react";

export default function ShareButtons({ title }: { title: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(window.location.href), []);

  const t = encodeURIComponent(title);
  const u = encodeURIComponent(url);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="share">
      <span>مشاركة:</span>
      <a href={`https://wa.me/?text=${t}%20${u}`} target="_blank" rel="noopener noreferrer">
        واتساب
      </a>
      <a href={`https://twitter.com/intent/tweet?text=${t}&url=${u}`} target="_blank" rel="noopener noreferrer">
        إكس
      </a>
      <a href={`https://www.facebook.com/sharer/sharer.php?u=${u}`} target="_blank" rel="noopener noreferrer">
        فيسبوك
      </a>
      <button type="button" onClick={copy}>
        {copied ? "تم النسخ ✓" : "نسخ الرابط"}
      </button>
      <button type="button" onClick={() => window.print()}>
        طباعة
      </button>
    </div>
  );
}
