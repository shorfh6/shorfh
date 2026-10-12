# شُرفة

موقع إخباري عربي مبني بـ **Next.js (App Router)** مع لوحة تحكم لإدارة الأخبار والتصنيفات والمستخدمين. يستخدم **SQLite** (عبر better-sqlite3) للتخزين ولا يحتاج إلى خادم قاعدة بيانات منفصل.

## المتطلبات

- Node.js 20 أو أحدث

## التثبيت والتشغيل

```bash
npm install

# تهيئة قاعدة البيانات وبيانات تجريبية (كلمة المرور: 12 حرفاً على الأقل)
ADMIN_PASSWORD=your-password npm run seed

# التشغيل في وضع التطوير على المنفذ 3001
npm run dev
```

للإنتاج:

```bash
npm run build && npm start
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

لوحة التحكم على `/admin`.

## متغيرات البيئة

راجع `.env.example`:

- `SITE_URL` — رابط الموقع العام (canonical، sitemap، OG). افتراضياً `http://localhost:3001` أو `VERCEL_URL`.
- `ADMIN_PASSWORD` — كلمة مرور حسابات البذرة، مطلوبة فقط عند تشغيل `npm run seed`.
- `NODE_ENV=production` — يفعّل HSTS وملفات تعريف الارتباط الآمنة.

## البيانات

- قاعدة البيانات والصور المرفوعة محفوظة في مجلد `data/` (`data/shurfa.db` و`data/uploads/`).
- مجلد `data/` مستثنى من Git (`.gitignore`) — **يجب نسخه احتياطياً بشكل منفصل** في الإنتاج.
- لإعادة تهيئة قاعدة البيانات من الصفر: `npm run seed:reset` (تحذير: يمسح كل البيانات).
