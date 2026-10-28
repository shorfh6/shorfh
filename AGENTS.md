<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## RAAD / شُرفة الإخبارية

**متصفح المشروع إلزامي:** كل صفحة تُفتح في متصفح المشروع المخصص لها. صفحات شُرفة وRender وSupabase وGitHub التابعة لها تستخدم Chrome **Shor / Profile 4** فقط. تحقق من اسم الملف في شريط المتصفح قبل كل تنقل أو قراءة أو تفاعل، ثم من هوية المشروع في URL؛ مجرد وجود تبويب أو تمرير profile-directory لا يكفي. لا تقرأ تبويبات الملفات الأخرى أو تتعامل مع لوحات مشاريعها. أكّد المالك هذا التوجيه مجددًا في 2026-10-27.

اختار المالك أخيرًا شُرفة `https://www.shurfh.com` نطاقًا لهذا الفريق بعد فحص اللوحتين. هذا يحل محل تسمية `mnbralakhbar.com` السابقة؛ لا تغيّر العلامة أو تربط نطاقًا آخر تلقائيًا.
رعد العالمي `raad` يدير الفريق المحلي في `.opencode/agents/`. قبل أعمال الأخبار اقرأ
`docs/raad/POLICY.md` و`CONTRACTS.md` و`HANDOFF.md` و`TODO.md`.
الوكلاء الفرعيون قراءة فقط ولا يفوضون أو يمنحون صلاحيات أو ينشرون.
سجل `config/raad/sources.json` يتضمن عكاظ باعتماد تحريري صريح من المالك، مع بقاء الجمع الآلي وإعادة نقل النصوص والصور مغلقة حتى التحقق من الأذونات وطريقة الوصول؛ راجع `docs/raad/SOURCES.md`. إعداد التشغيل
في `config/raad/runtime.json` جاف فقط، ولا يثبت وجود مجدول.
اختبارات محلية بلا شبكة: `node --test scripts/raad/*.test.mjs`؛
محاكاة اصطناعية: `node scripts/raad/dry-run.mjs`.
هذه ليست اختبارات نشر إنتاجي أو إثباتًا لصحة الأخبار أو اختبار LLM حيًا.
لا تشغّل المستورد القديم أو migrations أو seed أو النشر الحقيقي كجزء من تجربة RAAD.
لا نشر عام قبل التحقق ثم التحرير الأصيل وتحسين SEO ومراجعة الوسائط ثم APPROVED من المعتمد لنفس بصمة النسخة. وجود مادة في draft ليس اعتمادًا ولا تصريح نشر. تبقى المسودة البحثية موسومة غير جاهزة حتى تستكمل المراجعات.
يحتاج أول تشغيل حي ونشر برمجي إنتاجي وتغيير أسرار/صلاحيات حساسة أو تكلفة مدفوعة موافقة المالك.
لقطة الأقسام في `config/raad/categories.snapshot.json` جرد مؤرخ لا مزامنة حية؛ تحقق من المشروع والحداثة قبل استخدامها.
سجل التسليم المحلي في `scripts/raad/local-journal.mjs` يتطلب مسارًا مطلقًا صريحًا؛ احفظ بياناته تحت `.raad-local/` المتجاهل في Git. لا تعتبره طابورًا أو سجلًا إنتاجيًا معتمدًا.
