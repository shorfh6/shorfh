export const roleLabels: Record<string, string> = { admin: "مدير", editor: "محرر", author: "كاتب" };

export const statusLabels: Record<string, string> = {
  draft: "مسودة",
  pending: "بانتظار المراجعة",
  published: "منشور",
  rejected: "مرفوض",
};

export const imageUrl = (img: string) => (!img ? "" : /^https?:\/\//.test(img) ? encodeURI(img) : `/uploads/${encodeURIComponent(img)}`);

export const coverStyle = (img: string) => (img ? { backgroundImage: `url("${imageUrl(img)}")` } : undefined);

export const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }) : "—";

export const readingTimeLabel = (m: number) =>
  m === 1 ? "دقيقة واحدة للقراءة" : m === 2 ? "دقيقتان للقراءة" : m <= 10 ? `${m} دقائق للقراءة` : `${m} دقيقة للقراءة`;

export const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ar-SA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

const messages: Record<string, string> = {
  saved: "تم الحفظ بنجاح",
  created: "تمت الإضافة بنجاح",
  deleted: "تم الحذف",
  approved: "تم نشر النسخة المعتمدة",
  already_published: "المادة منشورة بالفعل؛ لم يُكرر النشر",
  rejected: "تم رفض الخبر وإشعار الكاتب بالسبب",
  submitted: "تم إرسال الخبر للمراجعة",
  password: "تم تحديث كلمة المرور",
};
const errors: Record<string, string> = {
  forbidden: "ليست لديك صلاحية لهذا الإجراء",
  invalid: "بيانات غير صالحة، راجع الحقول وحاول مرة أخرى",
  title: "العنوان مطلوب",
  body: "نص الخبر مطلوب",
  category: "اختر تصنيفاً صحيحاً",
  image: "الصورة غير صالحة: استخدم JPG أو PNG أو WEBP بحجم لا يتجاوز 5 ميجابايت، أو رابطاً يبدأ بـ https",
  reason: "سبب الرفض مطلوب",
  email: "البريد الإلكتروني غير صالح أو مستخدم من قبل",
  weak: "كلمة المرور يجب ألا تقل عن 12 حرفاً",
  long: "كلمة المرور طويلة جداً (الحد الأقصى 1024 بايت)",
  wrong: "كلمة المرور الحالية غير صحيحة",
  self: "لا يمكنك تنفيذ هذا الإجراء على حسابك",
  lastadmin: "لا يمكن إزالة آخر مدير في النظام",
  inuse: "لا يمكن الحذف لوجود أخبار مرتبطة به",
  dup: "الاسم أو الرابط المختصر مستخدم من قبل",
  notfound: "العنصر غير موجود",
  url: "روابط المنصات يجب أن تبدأ بـ https://",
  approval_required: "لا يمكن النشر قبل تسجيل اعتماد المعتمد لهذه النسخة.",
  approval_stale: "الاعتماد منتهي أو لا يطابق النسخة الحالية؛ أعد المراجعة.",
  save_draft_first: "احفظ المادة كمسودة أولًا، ثم استكمل المراجعات والاعتماد.",
  published_edit_blocked: "حوّل المادة المنشورة صراحة إلى مسودة قبل تعديلها، ثم أعد اعتماد النسخة الجديدة.",
  public_dependency_blocked: "هذا التعديل يغيّر أخبارًا منشورة؛ يلزم إعادتها للمراجعة قبل تغيير بيانات الكاتب أو التصنيف أو الوسوم المرتبطة.",
  publication_date_locked: "تاريخ النشر الأصلي وتاريخ الإنشاء محفوظان ولا يعاد تأريخهما.",
  article_identity_locked: "معرّف المادة ثابت، ولا ينتقل الاعتماد إلى رابط آخر.",
  publication_gate_not_ready: "بوابة النشر غير مهيأة أو صلاحياتها غير مكتملة؛ النشر متوقف حتى استكمالها.",
};

export const flash = (m?: string, e?: string) => ({
  ok: m ? messages[m] : undefined,
  error: e ? errors[e] : undefined,
});
