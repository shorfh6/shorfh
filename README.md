# شُرفة

موقع إخباري عربي مبني بـ **Next.js (App Router)** مع لوحة تحكم لإدارة الأخبار والتصنيفات والمستخدمين. يستخدم **PostgreSQL** (Supabase أو أي خادم PostgreSQL) و**Supabase Storage** لتخزين صور الأخبار.

## المتطلبات

- Node.js 20 أو أحدث (يوصى بـ Node 22 — ملف `.node-version` مضمّن)
- قاعدة بيانات PostgreSQL (مشروع [Supabase](https://supabase.com) مجاني يكفي)
- حاوية Supabase Storage خاصة لصور الأخبار (تُنشأ عبر `npm run setup:storage`)

## التثبيت والتشغيل

```bash
npm install

# انسخ متغيرات البيئة وعدّلها
cp .env.example .env.local

# إنشاء الجداول في PostgreSQL (idempotent — يمكن تكراره بأمان)
npm run migrate

# (Supabase فقط) إنشاء حاوية التخزين الخاصة
npm run setup:storage

# بيانات تجريبية للتطوير (كلمة المرور: 12 حرفاً على الأقل)
ADMIN_PASSWORD=your-password npm run seed -- --demo-articles

# التشغيل في وضع التطوير على المنفذ 3001
npm run dev
```

للإنتاج:

```bash
npm run build && npm start   # يبدأ Next.js فقط؛ الترحيلات ينفذها مشغّل موثوق مسبقًا
```

## الحسابات التجريبية

ينشئ `scripts/seed.mjs` الحسابات التالية (كلمة المرور للجميع هي قيمة `ADMIN_PASSWORD`):

| البريد الإلكتروني      | الدور  |
| ---------------------- | ------ |
| admin@shurfa.local     | مدير   |
| editor@shurfa.local    | محرر   |
| khaled@shurfa.local    | كاتب   |
| noura@shurfa.local     | كاتبة  |
| faisal@shurfa.local    | كاتب   |

لوحة التحكم على `/admin`. بذر البيانات التجريبية معطّل في الإنتاج (`NODE_ENV=production`).

## متغيرات البيئة

راجع `.env.example`:

- `DATABASE_URL` — عنوان اتصال PostgreSQL. في Supabase استخدم **Session Pooler** (المنفذ 5432) وأضف `?sslmode=require`.
- `DATABASE_SSL` — اتركه غير مضبوط: الافتراضي TLS مع التحقق من الشهادة واسم المضيف. `false` أو `sslmode=disable` مسموحان فقط على loopback المحلي، ويُرفضان لاتصال بعيد. وجود `?sslmode=require` صحيح؛ تعالج الخيارات المشتركة TLS صراحة دون السماح لـ`sslmode` بتعطيل التحقق.
- `DATABASE_CA_CERT` — شهادة CA موثوقة بصيغة PEM عند حاجة الخادم إليها؛ تقبل فواصل أسطر فعلية أو `\n`. دونها يُستخدم مخزن الثقة الافتراضي لـNode.js، ويفشل الاتصال عند عدم الوثوق بالشهادة. لا تضع `ssl` أو `sslcert` أو `sslkey` أو `sslrootcert` أو `sslnegotiation` في عنوان الاتصال؛ تُرفض لتجنب استبدال إعدادات التحقق داخل pg.
- `SUPABASE_URL` — عنوان مشروع Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` — مفتاح الخدمة، **للخادم فقط**؛ لا تستخدمه أبداً مع `NEXT_PUBLIC_`.
- `SUPABASE_STORAGE_BUCKET` — اسم الحاوية (الافتراضي `article-images`).
- `SITE_URL` — رابط الموقع العام (canonical، sitemap، OG).
- `ADMIN_PASSWORD` — كلمة مرور حسابات البذرة، مطلوبة فقط عند تشغيل `npm run seed`.
- `NODE_ENV=production` — يفعّل HSTS وملفات تعريف الارتباط الآمنة.

دون متغيري Supabase يعمل التخزين محلياً على `data/uploads/` (وضع التطوير فقط؛ الإنتاج يتطلب Supabase Storage).

## ترحيل البيانات من SQLite

إن كانت لديك نسخة سابقة تعمل على `data/shurfa.db`:

```bash
# معاينة العدّات دون كتابة
node scripts/migrate-sqlite-to-pg.mjs --dry-run

# نسخ المستخدمين والتصنيفات والوسوم وروابط التواصل
npm run migrate:data

# + الأخبار والوسوم المرتبطة وسجل النشاط
node scripts/migrate-sqlite-to-pg.mjs --articles

# + رفع الصور المحلية من data/uploads إلى Supabase Storage
node scripts/migrate-sqlite-to-pg.mjs --articles --images
```

- يحافظ على المعرفات ويعيد ضبط الـ sequences تلقائياً.
- **لا ينقل الجلسات (`sessions`) إطلاقاً** — على المستخدمين تسجيل الدخول من جديد.
- يفشل إن كان الهدف يحوي مستخدمين إلا مع `--force` (يدرج الصفوف غير الموجودة فقط).
- ملف `data/shurfa.db` يُقرأ للقراءة فقط ولا يُعدّل.

## النشر على Render

1. ادفع الفرع إلى GitHub.
2. في Supabase: أنشئ مشروعاً، خذ `DATABASE_URL` (Session Pooler، المنفذ 5432 + `sslmode=require`) و`SUPABASE_URL` ومفتاح `service_role`.
3. أنشئ حاوية التخزين: شغّل `npm run setup:storage` محلياً مع المتغيرات مضبوطة، أو أنشئ حاوية خاصة `article-images` من لوحة Supabase.
4. في Render: **New → Blueprint** واختر المستودع — `render.yaml` يعرف الخدمة (`healthCheckPath: /api/health`).
5. عيّن المتغيرات السرية: `DATABASE_URL`، `SUPABASE_URL`، `SUPABASE_SERVICE_ROLE_KEY`، `SITE_URL`.
6. أول نشر: نفّذ `npm run migrate` بحساب ترحيل موثوق قبل بدء الخدمة، ثم `npm ci && npm run build` و`npm start`. لا تورّث اتصال مالك القاعدة إلى عملية Next.js.

### بوابة اعتماد الأخبار

**مفعّلة في إنتاج شُرفة منذ 2026-10-28**، مع اتصال ويب محدود ومنسق اعتماد منفصل وTLS موثوق؛ [نتائج النقل والتحقق](docs/raad/PRODUCTION-ROLLOUT.md). تشغيل عامل الأخبار الدوري مسار تكامل منفصل ما زال مفتوحًا.

الكود المحلي يفرض اعتمادًا مطابقًا للنسخة قبل النشر، مع فحص الصورة. تركيب بوابة SQL وفصل حساب الناشر عن حساب منسق الاعتماد خطوتان إنتاجيتان صريحتان تتطلبان موافقة المالك؛ ليستا ضمن ترحيلات بدء الخدمة. اتبع [خطة الترحيل والرجوع](docs/raad/PUBLICATION-GATE.md). الأخبار الموجودة تسجّل كنسخ منشورة سابقة غير معتمدة بالنظام الجديد، لا كموافقات بأثر رجعي. أدوات البذر والترحيل القديمة لا تتجاوز بوابة النشر.

## أمان

- التهيئة الأساسية تفعّل **Row Level Security** وتمنع وصول أدوار Data API المعتادة. بوابة RAAD تمنح حساب خادم الناشر المحدود سياسات منفصلة، وتحجب إنشاء الاعتماد عنه. تشغيل الويب باتصال postgres المالك لا يحقق فصل الصلاحيات المطلوب؛ لا تُفعّل البوابة إنتاجيًا دون تطبيق خطة الحسابات والتحقق من TLS.
- مفتاح `service_role` يبقى على الخادم فقط (Server Actions وRoute Handlers).
- حاوية الصور **خاصة**؛ صور الأخبار المنشورة تُقدَّم عبر مسار التطبيق `/uploads/[name]` بعد فحص الحالة في قاعدة البيانات.

## البيانات المحلية

- مجلد `data/` مستثنى من Git (`.gitignore`) — يحوي قاعدة SQLite القديمة وملفات `data/uploads/` المستخدمة في التطوير والترحيل. **لا تحذفه**.
- قاعدة الإنتاج هي PostgreSQL فقط؛ ملف `data/shurfa.db` بقي للترحيل التاريخي.
