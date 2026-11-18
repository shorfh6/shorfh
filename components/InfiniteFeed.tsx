"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ArticleCard from "./ArticleCard";
import type { ArticleRow } from "@/lib/queries";

export default function InfiniteFeed({
  initial,
  initialHasMore,
  excludeIds,
}: {
  initial: ArticleRow[];
  initialHasMore: boolean;
  excludeIds: number[];
}) {
  const [items, setItems] = useState<ArticleRow[]>(initial);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initial.map((a) => a.id)));

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/articles?page=${page}&ex=${excludeIds.join(",")}`);
      const data = await res.json();
      const fresh = (data.items as ArticleRow[]).filter((a) => !seen.current.has(a.id));
      fresh.forEach((a) => seen.current.add(a.id));
      setItems((prev) => [...prev, ...fresh]);
      setHasMore(!!data.hasMore && data.items.length > 0);
      setPage((p) => p + 1);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, excludeIds]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) void loadMore();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  return (
    <>
      <div className="cards">
        {items.map((a) => (
          <ArticleCard key={a.id} article={a} />
        ))}
      </div>
      {hasMore ? (
        <div ref={sentinel} className="feed-more">
          <button type="button" className="pager-link" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "جارٍ التحميل…" : "تحميل المزيد من الأخبار"}
          </button>
        </div>
      ) : items.length ? (
        <p className="empty">وصلت إلى نهاية الأخبار المتاحة.</p>
      ) : null}
    </>
  );
}
