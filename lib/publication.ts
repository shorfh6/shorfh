import type { Q } from "./db";
import { createHash } from "node:crypto";

const failures: Record<string, { code: string; message: string }> = {
  RAAD_APPROVAL_REQUIRED: { code: "approval_required", message: "لا يمكن النشر قبل تسجيل اعتماد المعتمد لهذه النسخة." },
  RAAD_APPROVAL_STALE: { code: "approval_stale", message: "الاعتماد منتهي أو لا يطابق النص والصورة والتصنيف والوسوم الحالية؛ أعد المراجعة." },
  RAAD_SAVE_DRAFT_FIRST: { code: "save_draft_first", message: "احفظ المادة كمسودة أولًا، ثم استكمل المراجعات والاعتماد قبل النشر." },
  RAAD_PUBLISHED_EDIT_BLOCKED: { code: "published_edit_blocked", message: "هذه مادة منشورة؛ حوّلها صراحة إلى مسودة قبل تعديلها، ثم أعد اعتماد النسخة الجديدة." },
  RAAD_PUBLIC_DEPENDENCY_BLOCKED: { code: "public_dependency_blocked", message: "التعديل يغيّر بيانات أخبار منشورة؛ يلزم إعادتها للمراجعة قبل تغيير التصنيف أو الكاتب أو الوسوم المرتبطة." },
  RAAD_APPROVAL_MUST_PRECEDE_PUBLICATION: { code: "approval_required", message: "يجب تسجيل الاعتماد قبل محاولة النشر، ولا يُقبل اعتماد بأثر رجعي." },
  RAAD_PUBLICATION_DATE_IMMUTABLE: { code: "publication_date_locked", message: "لا يمكن إعادة كتابة تاريخ النشر الأصلي." },
  RAAD_CREATION_DATE_IMMUTABLE: { code: "publication_date_locked", message: "لا يمكن إعادة كتابة تاريخ إنشاء المادة." },
  RAAD_ARTICLE_ID_IMMUTABLE: { code: "article_identity_locked", message: "لا يمكن تغيير معرّف المادة أو نقل اعتمادها إلى رابط آخر." },
  RAAD_REVIEW_INCOMPLETE: { code: "approval_required", message: "حزمة المراجعة غير مكتملة؛ لا يوجد اعتماد صالح للنشر." },
  RAAD_MEDIA_CHANGED: { code: "approval_stale", message: "الصورة غير متاحة أو بايتاتها لا تطابق الصورة المعتمدة؛ يلزم فحص الوسيط قبل النشر." },
  RAAD_SITE_URL_INVALID: { code: "publication_gate_not_ready", message: "عنوان الموقع العام غير مهيأ أو لا يطابق النطاق الذي اعتُمدت عليه المادة؛ النشر متوقف." },
  RAAD_ACTION_FORBIDDEN: { code: "forbidden", message: "لم تعد لديك صلاحية تنفيذ هذا الإجراء." },
  RAAD_ARTICLE_NOT_FOUND: { code: "notfound", message: "المادة غير موجودة." },
};

export function publicationFailure(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const found = Object.entries(failures).find(([key]) => error.message === key);
  if (found) return found[1];
  if (/raad_gate/.test(error.message) && /does not exist|permission denied/.test(error.message)) {
    return { code: "publication_gate_not_ready", message: "بوابة النشر غير مهيأة أو صلاحياتها غير مكتملة؛ الحفظ كمسودة متاح والنشر متوقف." };
  }
  return undefined;
}

// Same lock as the SQL statement triggers, before taking article row locks.
// A builtin lock also lets ordinary draft saves work before explicit gate rollout.
export async function lockPublicationScope(q: Q) {
  await q.query("SELECT pg_catalog.pg_advisory_xact_lock(724214, 1)");
}

export async function assertPublicationApproved(q: Q, articleId: number, loadImage: (name: string) => Promise<{ body: ReadableStream; contentType: string; size?: number } | null>, siteUrl = process.env.SITE_URL) {
  await q.query("SELECT raad_gate.assert_publishable($1)", [articleId]);
  const approval = await q.one<{ review: { state: string; mediaSha256?: string; site?: string }; image: string }>(
    "SELECT raad_gate.approval_status(id) AS review,image FROM articles WHERE id=$1", [articleId],
  );
  if (approval?.review.state === "legacy") return; // Only a continuously-published, unchanged baseline; SQL checks this.
  try {
    const site = new URL(siteUrl ?? ""), reviewedSite = new URL(approval?.review.site ?? "");
    const localTest = process.env.NODE_ENV !== "production" && ["127.0.0.1", "localhost", "[::1]"].includes(site.hostname);
    if ((!localTest && site.protocol !== "https:") || site.username || site.password || site.search || site.hash || site.pathname !== "/" || site.origin !== reviewedSite.origin) throw new Error();
  } catch { throw new Error("RAAD_SITE_URL_INVALID"); }
  if (!approval || approval.review.state !== "approved" || !/^[a-f0-9]{64}$/.test(approval.review.mediaSha256 ?? "") ||
      !/^[\w-]+\.(png|jpg|jpeg|webp)$/i.test(approval.image)) throw new Error("RAAD_MEDIA_CHANGED");
  try {
    const image = await loadImage(approval.image);
    if (!image || (image.size ?? 0) > 5 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(image.contentType.split(";")[0])) throw new Error("RAAD_MEDIA_CHANGED");
    const reader = image.body.getReader(), hash = createHash("sha256");
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("RAAD_MEDIA_CHANGED")), 10000); });
    try {
      while (true) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 5 * 1024 * 1024) throw new Error("RAAD_MEDIA_CHANGED");
        hash.update(chunk.value);
      }
      if (!bytes || hash.digest("hex") !== approval.review.mediaSha256) throw new Error("RAAD_MEDIA_CHANGED");
    } finally { if (timer) clearTimeout(timer); await reader.cancel().catch(() => {}); }
  } catch { throw new Error("RAAD_MEDIA_CHANGED"); }
}
