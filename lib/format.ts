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

export const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ar-SA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

const messages: Record<string, string> = {
  saved: "تم الحفظ بنجاح",
  created: "تمت الإضافة بنجاح",
  deleted: "تم الحذف",
  approved: "تم اعتماد الخبر ونشره",
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
};

export const flash = (m?: string, e?: string) => ({
  ok: m ? messages[m] : undefined,
  error: e ? errors[e] : undefined,
});
