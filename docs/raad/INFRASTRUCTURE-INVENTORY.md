# جرد البنية — لقطة تاريخية وتحديث إنتاجي مأذون 2026-10-26

## التغيير الإنتاجي الحالي
فوّض المالك إصلاح SITE_URL وإعادة البناء في سؤال محدد، فأصلح الرئيسي **صف SITE_URL العام القائم فقط** في خدمة `srv-db8a5a9srm7s73dular0` إلى `https://www.shurfh.com`، وضغط Save/Rebuild/Deploy بعد التحقق من الحقل. بقي remote main عند SHA=`59d5a494adb752195e1036f5507a2c3e05066350` قبل النشر؛ لا كود غير مراجع، ولا قراءة/تعديل أسرار أو تغيير خطة/صلاحيات.

عولج أصل canonical/publisher/images الذي كان `http://localhost:3001`؛ تحقق المقال الحي 3 ثم المادة 53 من الأصل الصحيح. هذه إعادة نشر إنتاجية فعلية مأذونة، فتعبيرات «لا deploy/تعديل خدمة» أدناه تخص قراءات الجرد التاريخية فقط. worker/scheduler لم يُفعّلا. المادة 53 منشورة ومطابقة لـr8 لكن توقيتها يسبق الاعتماد والفاعل مجهول؛ لا ضغط نشر إضافي من الرئيسي، والتفصيل في `PUBLICATION-53.md`.

## النطاق والنتيجة التاريخية لقراءات الجرد
سجل لقراءات الرئيسي الفعلية، لا إعلان خلو البنية من المجدولات. **نجح الوصول الموثق إلى Render وSupabase عبر الإضافة** بعد موافقة المالك. اختار المالك أخيرًا شُرفة `https://www.shurfh.com` هدفًا للفريق، ناسخًا تأكيده السابق لمنبر `mnbralakhbar.com`. الجرد محدود بمساحة العمل والمشروع المرئيين؛ بقية المساحات والجدولة الخارجية غير محسومة. لا worker أو schedule جديد، ولا DB write أو SQL أو deploy أو تعديل خدمة ضمن هذه القراءات.

## القراءات المثبتة
| العنصر | ما لوحظ | حد الاستنتاج |
| --- | --- | --- |
| GitHub auth | الحساب `shorfh6` | إثبات وصول GitHub، لا وصول حسابات الخدمات الأخرى |
| المستودع والفرع | `shorfh6/shorfh`، `main`؛ SHA=`59d5a494adb752195e1036f5507a2c3e05066350` يطابق المحلي | لقطة محددة، لا دليل حالة الخدمات المنشورة |
| شجرة remote main | فُحصت، لا worker/cron/queue أو GitHub workflows ظاهرة | لا يكشف مجدولًا خارج المستودع أو خدمة معرفة من dashboard |
| GitHub deployments/actions | deployments count=0، actions runs=`[]` | ليس إثباتًا لغياب نشر Render أو جدولة Supabase |
| Docker | مثبت، engine غير نشط | لم يبدأ engine ولم تُسحب images؛ لا بيئة staging متاحة منه مثبتة |
| Render | وصول موثق إلى MyWorkspace / Myproject / Production، خدمة واحدة ظاهرة | يثبت القائمة المرئية في هذا النطاق فقط، لا كل الخدمات الخارجية |
| Supabase | وصول موثق إلى منظمة shorfh ومشروع shorfh6، ثم schema metadata وشبكة categories | لا قراءة لصفوف users/sessions أو أسرار، ولا جرد كامل لكل الجدولة |

تاريخيًا عرض ملف الأتمتة المنفصل صفحات login رغم إفادة المالك بالدخول؛ لم يكن سبب الاختلاف مثبتًا. هذا العائق تجاوزته الوصلة المصرح بها أدناه؛ لا يصح وصف الوصول الحالي بأنه غير موثق على إطلاقه. لم تُطلب credentials/keys في المحادثة ولم تُنسخ tokens أو cookies.

## متابعة ربط ملف Chrome الخاص بشُرفة

- طُلِب فتح اللوحات في Chrome المخصص لشُرفة؛ حُدد اسم الملف `Shor` من أسماء الملفات المحلية فقط، ومساره `Profile 4`. فُتحت Render وSupabase فيه.
- أداة Playwright الجارية كانت تستخدم ملف أتمتة منفصلًا. وافق المالك صراحة على تثبيت إضافة Playwright الرسمية وربط تبويبات Shor للجرد للقراءة فقط.
- المصدر الرسمي: `https://github.com/microsoft/playwright/blob/main/packages/extension/README.md`، وإضافة المتجر ذات المعرف `mmlmfjhmonkocbjadbfplnigmagldckm`.
- حُدث إعداد Playwright العام إلى `@playwright/mcp@0.0.83 --extension --profile-dir-name "Profile 4" --no-webmcp`. لا token لتجاوز الموافقة، ولا نقل cookies أو قراءة بيانات الدخول. لا تغيير لصلاحيات وكلاء الأخبار الفرعيين.
- تاريخ التشخيص: أعاد اختبار stdio أولًا **Playwright Extension not found in Profile 4**؛ ليست هذه الحالة النهائية.
- وافق المالك صراحة على تثبيت الإضافة الرسمية، ثم قال «سوها انت» للموافقة. ضغطت Windows UIAutomation زر **Allow & select** في نافذة الإذن الفعلية لوصلة متصفح Shor المحددة النطاق؛ دون نسخ credentials أو tokens.
- نجح Playwright MCP بعد ذلك في إظهار تبويبات Render وSupabase المسجلة والتنقل فيها وإجراء القراءات التالية. لاحقًا انتهت مهلة التنقل إلى Jobs وقائمة التبويبات، وما زال آخر browser RPC timeout قائمًا في التقرير الأخير؛ لا يلغي القراءات الموثقة ولا يثبت jobs فارغة. لا نتيجة ناجحة أحدث لجرد Cron Jobs أو بقية مساحات العمل.

## لقطة الخدمات المنشورة الفعلية
الوقت المرجعي لقراءة الأقسام والجرد: **`2026-10-22T21:42:58.009Z`**، وفق تسليم الرئيسي.

| الموضع | البيانات المرئية المنقحة |
| --- | --- |
| Supabase org | `shorfh`، id=`hrsalkioeffftqoxtqzw`، Free |
| Supabase project | `shorfh6`، id=`edfbsgnrsbbjngbudpfk`، ap-northeast-2، nano |
| Render workspace/project | MyWorkspace / Myproject، id=`prj-db8a5a3ncjis73f6en1g`، بيئة Production |
| Render service | `shorfh`، id=`srv-db8a5a9srm7s73dular0`، Node web، Oregon، Free؛ قائمة Production تعرض خدمة واحدة |
| المصدر والنشر | `shorfh6/shorfh`، main؛ deployed SHA=`59d5a494adb752195e1036f5507a2c3e05066350`، live؛ public URL=`https://www.shurfh.com` |
| إعداد الخدمة المرئي | build=`npm install; npm run build`؛ start=`npm run start`؛ Auto Deploy On Commit؛ PR previews Off؛ حقل health check فارغ |

**انحراف إعدادات مثبت دون تعديل:** `render.yaml` الملتزم يصف Singapore وbuild باستخدام `npm ci` وhealth path=`/api/health`، مقابل Oregon و`npm install` وحقل health فارغ في الخدمة الفعلية. لا تفترض تطابق الملف مع dashboard ولا تصحح drift ضمن الجرد؛ أي تغيير نشر يتبع موافقات المالك.

## مخطط Supabase والجدولة المرئية
- Schema Visualizer لـ`public` أظهر 9 جداول: `schema_migrations`، `users`، `sessions`، `categories`، `tags`، `articles`، `article_tags`، `activity`، `social_links`. هذه metadata فقط؛ لم تُقرأ صفوف users أو sessions. لم تُلاحظ جداول workflow/queue في public المرئي؛ لا تعميم على مخططات أو مشاريع أخرى.
- صفحة Edge Functions تعرض «Deploy your first edge function»؛ لا functions ظاهرة في الصفحة.
- installed integrations المعروضة اثنتان: Data API وVault. Cron وQueues ظهرتا في catalog دون وسم installed؛ هذا ليس برهانًا على غياب مجدول خارجي. لم تُفتح صفحات أسرار Vault أو API keys.
- عُرض Cron overview ومتطلب pg_cron، لكن تنقل Jobs انتهت مهلته لاحقًا؛ **لم يُنفذ استعلام jobs ولم تُثبت قائمة فارغة**. يبقى فحص jobs/triggers/الجدولة الخارجية مفتوحًا.

## لقطة الأقسام المقروءة فعليًا
المصدر: `https://supabase.com/dashboard/project/edfbsgnrsbbjngbudpfk/editor/17642`، جدول `public.categories`، UI موثق بدور postgres، **قراءة grid فقط دون SQL**. ظهر 5 records عند الوقت أعلاه:

| id | slug | الاسم | الوصف | sort |
| ---: | --- | --- | --- | ---: |
| 1 | local | الأخبار المحلية | أخبار المملكة والمناطق والخدمات | 0 |
| 2 | politics | السياسة | تطورات المشهد السياسي إقليمياً ودولياً | 1 |
| 3 | sports | الرياضة | أخبار الأندية والمنتخبات والبطولات | 2 |
| 4 | culture | ثقافة وفن | الثقافة والفنون والمشاهير | 3 |
| 5 | tech | تقنية | التقنية والذكاء الاصطناعي والأمن الرقمي | 4 |

هذه لقطة جرد مؤرخة، لا whitelist ثابتة أو live sync أو إثبات لمسار canonical. حفظها الرئيسي فعليًا في `config/raad/categories.snapshot.json`، وقُرئ الملف: site شُرفة، projectRef=`edfbsgnrsbbjngbudpfk`، observedAt أعلاه وrecordCount=5. يلزم التحقق من الحداثة عند التكامل. الأقسام ليست اعتماد مصادر؛ السجل الفعلي أصبح يتضمن عكاظ editorial-only، وحقوقه/التغذية غير مكتملة كما في `SOURCES.md`.

## الجرد المحلي السابق، لا جرد الخدمة الحية
- `render.yaml`: تعريف web بخطة free و`autoDeploy: true` فقط؛ لا يثبت وحده تفاصيل النشر الحالي أو عدم وجود خدمات أخرى.
- `app/admin/actions.ts`: نشر يدوي قد يتجاوز بوابات RAAD؛ `scripts/import-news50.mjs`: إدراج مباشر published. لم يُشغّلا للاختبار.
- `db/migrations/0001_init.sql`: لا سجلات workflow، وsource_url غير فريد. لا يُستنتج منه مخطط Supabase المنشور الفعلي؛ لم تُشغّل migrations أو seed.
- `config/raad/sources.json`: عكاظ فقط، ownerApproval=editorial-only وapprovalScope=editorial-reference-only وapprovedBy=owner؛ automatedCollection/articleRepublication/imageReuse=false، rightsStatus=permission-pending وfeedVerified=false. `runtime.json`: dry-run، livePublishing=false، schedulerInstalled=false، pollIntervalSeconds=300؛ لا worker قائمًا.

## PostgreSQL محلي اصطناعي، ليس بنية شُرفة المنشورة
استخدم الرئيسي PostgreSQL **16.10** من binaries القائمة `C:/tmp/pgport/pg16/pgsql/bin` لإنشاء cluster جديد `%TEMP%/opencode/raad-pg-data`، bound فقط إلى `127.0.0.1:55439` بدور/DB `raad_test`. لم يُحمّل env أو يتصل بقاعدة إنتاج. بقي الخادم الموجود مسبقًا عند `127.0.0.1:55432` دون مساس؛ لم يبدأ Docker أو تُسحب images لهذا الاختبار.

runner `pg-dry-run-queue.integration.mjs` يقبل endpoint الاختبار الدقيق و`--execute-synthetic` فقط، وينصب SQL داخل schema اصطناعي لا app db/migrations. بعد مراجعة مستقلة وإصلاح سباق انتهاء lease أثناء انتظار lock نجحت **15 مجموعة/0 فشل**؛ فحص حارس الساعة بعد القفل وUPDATE النهائي، SKIP LOCKED، معاملات READ COMMITTED بعميل واحد، immutable approvals/outbox/receipts، fencing، unknown reconciliation وحدود backoff=100ms/1000ms و3 claims. المدخل fixture مغلق لا أخبار فعلية؛ لا production queue API أو cloud migrations أو عامل/مؤقت تلقائي.

أثبت stop/start نظيف بقاء **11 synthetic jobs و9 simulated receipts و59 audit** قبل/بعد، ثم أُوقف cluster الاختبار. الجولة السابقة 13 مجموعة تاريخية لا النتيجة الأحدث. هذه durability محلية لا نشر أو staging E2E؛ التفاصيل المرجعية `PG-DRY-RUN.md`.

حُفظت أيضًا أزواج LLM الاصطناعية الثمانية من الصادرات السابقة في `.raad-local/smoke-2026-10-22`، verify=true و16 audit events دون inference جديد؛ المجلد متجاهل في Git. لا يعادل هذا التخزين المحلي سجل اعتماد إنتاجيًا أو أي تعديل سحابي.

## ما يلزم إتمامه بقراءة مصرح بها
1. استئناف الوصول بعد timeout عند الحاجة وتوسيع الجرد إلى بقية المساحات/المشاريع ذات الصلة؛ الوصلة الموثقة والقائمة المحدودة أُثبتتا بالفعل.
2. إتمام فحص cron/jobs/triggers وأي جدولة خارجية ونقاط الاستدعاء بقراءة مصرح بها؛ لا اعتبار catalog أو صفحة overview أو خلو GitHub من workflows دليلًا على jobs فارغة.
3. حفظ لقطة الأقسام مكتمل؛ ربطها والتحقق من حداثتها وفحص القيود ومسارات النشر الحقيقية ما زال مطلوبًا دون تعديل DB أو أذوناتها ضمن الجرد.
4. بعد إثبات عدم وجود مجدول آخر، اختيار عامل واحد قائم أو جديد، ثم تصميم الطابور الدائم وapproval-bound revisions وoutbox والتفرد وlease/fencing وDLQ والمصالحة.
5. فرض بوابة خادم قبل أي نشر آلي، وإتمام staging E2E وخطة الرجوع وموافقات تفعيل العامل. التفويض اليدوي للمادة 53 وإصلاح SITE_URL لا يعممان على عامل دائم، ولم ينشأ عامل جديد.

اعتماد عكاظ مصدر تحريري فقط ولا يوسع حقوق الناشر؛ المتبقي للأتمتة الوصول/feed/الحقوق ودمج البنية والبوابة. أحدث suite **462 pass/0 fail/0 skip** لا تحل محل هذه البنود؛ PG الـ15 مجموعة دليل تاريخي مستقل.
