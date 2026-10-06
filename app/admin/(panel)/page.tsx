import Link from "next/link";
import { canReview, requireUser } from "@/lib/auth";
import { dashboardStats, listArticles, recentActivity } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import Notice from "@/components/admin/Notice";
import StatusBadge from "@/components/admin/StatusBadge";

type Props = { searchParams: Promise<{ m?: string; e?: string }> };

export default async function Dashboard({ searchParams }: Props) {
  const user = await requireUser();
  const sp = await searchParams;
  const reviewer = canReview(user.role);
  const s = dashboardStats(reviewer ? undefined : user.id);
  const pending = reviewer ? listArticles({ status: "pending", limit: 6, order: "updated" }).rows : [];
  const mine = !reviewer ? listArticles({ authorId: user.id, limit: 6, order: "updated" }).rows : [];
  const activity = user.role === "admin" ? recentActivity(8) : [];
  const total = Object.values(s.byStatus).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...s.perCategory.map((c) => c.n));

  const tiles = [
    { label: "إجمالي الأخبار", value: total },
    { label: "منشورة", value: s.byStatus.published ?? 0, cls: "good" },
    { label: "بانتظار المراجعة", value: s.byStatus.pending ?? 0, cls: "warn" },
    { label: "مسودات", value: s.byStatus.draft ?? 0 },
    { label: "مرفوضة", value: s.byStatus.rejected ?? 0, cls: "bad" },
    { label: "إجمالي المشاهدات", value: s.views.toLocaleString("ar-SA") },
  ];

  return (
    <>
      <h1 className="page-h">مرحباً، {user.name}</h1>
      <Notice m={sp.m} e={sp.e} />

      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className={`tile ${t.cls ?? ""}`}>
            <span>{t.label}</span>
            <strong>{t.value}</strong>
          </div>
        ))}
      </div>

      <div className="grid-2">
        {reviewer && (
          <section className="card-a">
            <div className="card-h">
              <h2>بانتظار المراجعة</h2>
              <Link href="/admin/articles?status=pending">عرض الكل</Link>
            </div>
            {pending.length ? (
              <ul className="list">
                {pending.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/articles/${a.id}`}>{a.title}</Link>
                    <small>
                      {a.author_name ?? "—"} · {formatDateTime(a.updated_at)}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">لا توجد أخبار بانتظار المراجعة.</p>
            )}
          </section>
        )}

        {!reviewer && (
          <section className="card-a">
            <div className="card-h">
              <h2>آخر أخباري</h2>
              <Link href="/admin/articles/new">+ خبر جديد</Link>
            </div>
            {mine.length ? (
              <ul className="list">
                {mine.map((a) => (
                  <li key={a.id}>
                    <Link href={`/admin/articles/${a.id}`}>{a.title}</Link>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">لم تكتب أي خبر بعد.</p>
            )}
          </section>
        )}

        <section className="card-a">
          <div className="card-h">
            <h2>الأخبار حسب التصنيف</h2>
          </div>
          <ul className="bars">
            {s.perCategory.map((c) => (
              <li key={c.name}>
                <span>{c.name}</span>
                <div>
                  <i style={{ width: `${(c.n / max) * 100}%` }} />
                </div>
                <b>{c.n}</b>
              </li>
            ))}
          </ul>
        </section>

        <section className="card-a">
          <div className="card-h">
            <h2>الأكثر مشاهدة</h2>
          </div>
          <ul className="list">
            {s.top.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/articles/${a.id}`}>{a.title}</Link>
                <small>{a.views.toLocaleString("ar-SA")} مشاهدة</small>
              </li>
            ))}
          </ul>
        </section>

        {user.role === "admin" && (
          <section className="card-a">
            <div className="card-h">
              <h2>أنشط الكتّاب</h2>
              <Link href="/admin/users">إدارة</Link>
            </div>
            <ul className="list">
              {s.authors.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/users/${a.id}`}>{a.name}</Link>
                  <small>{a.n} منشور</small>
                </li>
              ))}
            </ul>
          </section>
        )}

        {user.role === "admin" && (
          <section className="card-a">
            <div className="card-h">
              <h2>آخر النشاطات</h2>
            </div>
            <ul className="list">
              {activity.map((a) => (
                <li key={a.id}>
                  <span>
                    <b>{a.user_name}</b> {a.action} {a.target && <em>«{a.target}»</em>}
                  </span>
                  <small>{formatDateTime(a.created_at)}</small>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
