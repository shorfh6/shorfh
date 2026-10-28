# تقرير التحقق — تاريخ الجولات وتحديث 2026-10-26

## أحدث تحديث: بوابة خادم النشر

**479 نجح، 0 فشل، 0 تخطي** في suite المحلية، إضافة إلى **14 مجموعة PostgreSQL** و**4 حالات HTTP حقيقية** على بيئة اصطناعية معزولة، وفحص TypeScript ناجح. المرجع الأحدث `PUBLICATION-GATE-VERIFICATION.md` وخطة الإنتاج `PUBLICATION-GATE.md`. الأعداد التالية تاريخ مراحل سابقة؛ بوابة الإنتاج والحسابات الجديدة لم تُطبّق بعد.

## النطاق

المشروع: `C:\Users\HDsupport1\Desktop\newsWeb`؛ النطاق الحالي باختيار المالك الأخير **شُرفة https://www.shurfh.com**. التأكيد السابق لمنبر mnbralakhbar.com محفوظ كتاريخ تجاوزه القرار الجديد؛ لا يعاد تفسير اختبارات الجولة السابقة كاختبار صحافة حقيقية لأي موقع.
OpenCode Desktop المثبت: **1.19.3**، Node.js **22.23.2**.
البداية كانت اختبارات اصطناعية وقراءات فقط؛ **الحالة الحالية تشمل تعديلات CMS ومادة 53 عامة مطابقة لاعتماد r8 وإصلاح SITE_URL الإنتاجي وredeploy مأذونًا**. تاريخ النشر المسجل يسبق الاعتماد، والفاعل المبكر مجهول؛ لا يُدّعى نشر بعد الاعتماد أو بوابة خادم منفذة. المرجع `PUBLICATION-53.md`. لا migrations سحابية أو عامل آلي؛ مهمة الوثائق لم تجر شبكة أو اختبارات أو تغييرات CMS.

## خلاصة أحدث تحقق مكتمل
| الفحص | النتيجة الفعلية المسلّمة |
| --- | --- |
| أحدث full offline suite وفق الرئيسي | **462 pass، 0 fail، 0 skip**؛ 102 envelope +78 workflow +28 runtime-smoke +14 journal +9 evidence-binding +231 review-task؛ لا مدة جديدة مقدرة |
| تاريخ بوابة SEO | 222 pass، 0 fail، 0 skip؛ 971.4564ms؛ ليست أحدث جولة |
| `node scripts/raad/dry-run.mjs` بعد تعديل SEO | نجح `dry_run_complete`، simulatedReceipts=1؛ بصمة fixture الجديدة `0f139c6c392306e4e2825bd68ab0ad12fa2e3c0ba4f1a1f0df1016e2a6c0ad59` |
| PostgreSQL 16.10 المعزول | **15 integration groups passed، 0 failed** تاريخيًا؛ منفصلة عن 462 ولم تُعد بعد docs |
| بقاء بيانات PG عبر stop/start | 11 synthetic jobs و9 simulated receipts و59 audit قبل/بعد دون تغير؛ أُوقف cluster الاختبار بعد التحقق |
| journal للأدلة الفعلية الاصطناعية | 8 أزواج task/result من CLI السابقة محفوظة، verify=true، 16 audit events؛ لا inference جديد |
| سجل عكاظ | اعتماد تحريري من المالك، أضيفت 24 حالة مصدرية فصار envelope=102؛ لا حقوق جمع/نشر/صور مثبتة |

جولات 147/175/189/213/222 محفوظة كتاريخ، والأحدث 462. اختبارات evidence-binding وreview-task لا تُحسب استدلالات LLM؛ تضيف فحوص استمرارية الحقائق والنقل/الاستعادة. المراجعات الفعلية المنفصلة للمادة 53 اكتملت كما يلي.

## التحقق الفعلي للمادة 53 والإصلاح الإنتاجي
- المحقق completed مع webfetch إلى SETI وعكاظ؛ المحرر completed بصياغة أصلية وSEO؛ المصور completed بعد فحص الصورة والكود وسجل تكليف الأصل. النتائج بهويات أطفال فعلية محفوظة في `.raad-local/draft-53/review-history.json` وlocal-journal. تمييز إعلان 22 أكتوبر/تركيب 19 أغسطس ونسبة الحقائق ثابتان؛ evidenceDigest لا ينقل اعتماد النشر النهائي.
- المعتمد APPROVED لـr8 عند `2026-10-26T11:24:04.483Z`؛ child=`ses_e880a69efffe0C1LAMWFr7Mlbe`، وtaskHash=`b7e78995d7c08ac1db59a2eec80d03044ee0aa0139372f662fbbe20981de719e`.
- إيصال `.raad-local/draft-53/publication-receipt.json` قُرئ: verifiedAt=`2026-10-26T11:30:55.376Z` وجميع فحوص المحتوى/SEO/الحقوق المرجعية والصورة العامة المطابقة ناجحة؛ **datePublished=dateModified=`2026-10-26T10:16:57.219Z` وpublishedAtOrAfterReview=false**. وجد الفاحص CMS منشورًا؛ لم ينقر نشرًا إضافيًا، ولم ينشئ مكررًا. الفاعل المبكر مجهول ولا تصح نسبة النشر بعد الاعتماد للمساعد.
- صحح الرئيسي SITE_URL العام وحده إلى أصل شُرفة وأجرى redeploy بإذن المالك المحدد. سبق ذلك فحص remote main بنفس SHA المنشور؛ لا تغيير كود غير مراجع أو أسرار/خطة/صلاحيات. فُحص أصل canonical/publisher/images في المقال الحي 3 ثم المادة 53. التفصيل والبصمات والصورة في `PUBLICATION-53.md`.
- أصلح نقل مهام المراجعة quoting Windows وحد context 32k باستخدام stdin الرسمي، مع نتائج مختصرة مدققة واستعادة محدودة لـTask منقطع فارغ. عند timeout للأب وقبول الطفل المكتمل من دليله يُسجل `parentEchoVerified=false` حيث ينطبق؛ لا ادعاء تطابق صدى الأب أو موافقة مولدة/مصطنعة.

يلزم فرض بوابة خادم قبل أي نشر آلي؛ المطابقة الحالية لا تثبت احترام ترتيب الاعتماد تاريخيًا. worker/scheduler/runtime الآلية ما زالت false؛ ليست هذه غرفة أخبار ذاتية أو staging E2E مكتملًا.

## تاريخ الجولة السابقة — 2026-10-22، قبل runtime driver

| الفحص | النتيجة |
| --- | --- |
| `node --test scripts/raad/*.test.mjs` من جذر المشروع | 147 اختبارًا؛ 147 pass، 0 fail، 0 skipped؛ زمن TAP الإجمالي 335.5663ms في هذه الجولة |
| `node scripts/raad/dry-run.mjs` | JSON صالح: `SYNTHETIC NOT REAL NEWS`، simulatedReceipts=1، stage=`dry_run_complete` |
| private parser + directory loader + permission matcher من الحزمة المثبتة | 9 وكلاء، 187 assertion، PASS |
| `git diff --check` | لا أخطاء whitespace |

تشخيص OpenCode تم عبر نسخة مؤقتة من bundle المثبت، مع تعطيل تهيئة DB واستيراد terminal الأصلي غير اللازم وإتاحة دوال التحليل والتحميل ومطابقة الصلاحيات فقط. ملفات التشخيص في `%TEMP%\opencode`، منها `validate-agent.cjs` و`check-raad.cjs`. لم تُعدّل ملفات تثبيت التطبيق. هذا أسلوب تشخيص داخلي **غير مدعوم كواجهة عامة**؛ ليس اختبار إنفاذ الأدوات في جلسة معاد تشغيلها.

أثبت التشخيص: `raad` primary، ثمانية subagents، لا model overrides أو حقول options غير مقصودة؛ حدود steps محفوظة. الأوراق ممنوعة من bash/shell/edit/task/skill/grep/external_directory وأدوات المتصفح؛ قراءة الأسرار وموارد `mcp:*` مرفوضة؛ webfetch مسموح فقط للراصد والمحقق. الرئيسي يطلب موافقة shell للأوامر غير المستثناة، ولا يسمح wildcard لاختبارات قابلة لحقن أمر إضافي.

## الجولة المجمعة المثبتة قبل إضافة journal — 2026-10-22

| الفحص | النتيجة المنقولة من الرئيسي |
| --- | --- |
| `node --test --test-reporter=spec scripts/raad/*.test.mjs` | **175 pass، 0 fail، 0 skip؛ 625.7903ms**؛ 78 envelope +69 workflow +28 runtime driver |
| `git diff --check` | نجح؛ لا حاجة لتكرار اختبارات التنفيذ بعد تحديث docs فقط |
| CLI الفعلي primary raad → Task باسم الورقة | **8/8 passed**، جميع نتائج الأطفال blocked كما هو متوقع؛ bindings/metadata/model/tools موثقة في `RUNTIME-VERIFICATION.md` |

الجولات 147/175/189/213 ثم 222 تاريخ صحيح؛ 189 استغرقت 1725.1933ms و213 استغرقت 826.1212ms، والأحدث الآن 462. كلها تقارير فعلية لا جمع تقارير منفصلة؛ اختبارات driver الـ28 offline لا استدعاءات LLM.

## الحفظ المحلي والقراءات اللاحقة
- local-journal: snapshots كاملة متحقق منها وmetadata audit chain، دون نص مقالات خاص في هذه المدخلات الاصطناعية؛ لا log إنتاجي. حفظ الرئيسي في `.raad-local/smoke-2026-10-22` الأزواج الثمانية من صادرات CLI السابقة. انقطعت المحاولة بعد 6 أزواج ثم استؤنفت idempotently للزوجين الباقيين؛ verify=true و16 حدثًا بلا نتائج مكررة. أضيف `.raad-local/` إلى .gitignore؛ لم يجر inference جديد للحفظ.
- نجحت وصلة الإضافة الرسمية الموثقة بموافقة المالك وإجراء Allow & select. قُرئت بيانات Render/Supabase والأقسام الخمسة، بوقت مرجعي `2026-10-22T21:42:58.009Z`؛ grid categories بدور postgres دون SQL أو كتابة. تفاصيل النطاق وdrift في `INFRASTRUCTURE-INVENTORY.md`.
- timeout لاحق عند Jobs/tab list لا يلغي الدخول المثبت، ولا يثبت jobs فارغة. لا worker أو schedule أو deploy أو DB write جديد، ولا أسرار/صفوف users/sessions قُرئت. هذه قراءات جرد لا staging E2E.

## PostgreSQL اصطناعي فعلي، منفصل عن الإنتاج
استخدم الرئيسي binaries قائمة في `C:/tmp/pgport/pg16/pgsql/bin` لإنشاء cluster PostgreSQL **16.10** جديد في `%TEMP%/opencode/raad-pg-data`، bind=`127.0.0.1:55439` ودور/DB=`raad_test`. الخادم السابق عند `127.0.0.1:55432` بقي دون مساس. لا تحميل env أو اتصال DB إنتاجية. تثبيت SQL عبر runner فقط يقبل endpoint الاختبار الدقيق و`--execute-synthetic`، لا app db/migrations أو مؤقت/daemon.

أظهرت مراجعة مستقلة سباق صلاحية lease أثناء انتظار row lock؛ أصلحه الرئيسي بفحص DB clock في statement بعد القفل وحارس نهائي في UPDATE. نجحت الجولة المصححة **15 مجموعة/0 فشل**؛ الجولة 13 تاريخية. شملت SKIP LOCKED وتزامن clients، ومعاملات READ COMMITTED بعميل واحد، وثبات snapshots/approval/outbox/receipt وقيود الربط، وfencing، وunknown reconciliation، وbackoff أساس 100ms وسقف 1000ms وحد 3 claims. لا renewal أو redrive API؛ exhausted حالة اصطناعية دائمة لا خدمة DLQ إنتاجية.

أُوقف cluster الاختبار وأعيد تشغيله فبقيت **11 job و9 receipts و59 audit** كما هي، ثم أُوقف نهائيًا لهذه الجولة. هذه clean restart durability لا محاكاة crash أو network partition؛ receipt أثر محاكاة لا مقال منشور. العقد مغلق على fixture اصطناعي محدد ولا يقبل حزمة خبر حقيقية. المرجع التفصيلي المحفوظ دون تعديل: `PG-DRY-RUN.md`.

## المصدر والبحث العام — 2026-10-25
موافقة المالك «https://www.okaz.com.sa/ اعتمد على موقع عكاظ ايضا» سُجلت editorial-only، وليس live approval أو إذن ناشر. قُرئت homepage وRSS/robots والسياسة وmetadata مقال؛ feed الفعلي غير متحقق، وحقوق الجمع وإعادة النصوص/الصور false/permission-pending. مرجع التفاصيل `SOURCES.md`، لا تُنسخ هنا نصوص المقالات أو الحقوق. SPA بحث فقط وغير مسجل؛ HTML يعرض 8 mainNews مع content/subtitle=null وشروطًا تقيد الاستخراج الآلي بإذن كتابي. التاريخ 25 أكتوبر 2026 مؤكد بساعة Node الفعلية وmetadata عامة لذلك اليوم؛ لا يحول هذا البحث إلى اختبار خبر حديث عبر الوكلاء.

## نطاق الاختبارات offline

- هوية الدور والمرحلة وإصدار العقد وسلامة المهمة المتوقعة وحالات completed/blocked/no_candidates.
- منع تغيير نص المصدر والأدلة والادعاءات والتصنيف والسياسة تحت بصمة اعتماد قديمة.
- حصر قرار الاعتماد في المعتمد؛ منع استبدال النص عبر مخرج المراجع أو الناشر.
- التوقف عند ادعاء غير متحقق أو مصدر قديم/مفقود أو تعارض أو خطر حساس.
- حقوق الوسائط ووسم التوضيح وALT، والعنوان وslug وcanonical وNewsArticle وتواريخه وهوية المؤلف والناشر داخل fixtures.
- جولتا تصحيح، وبطلان الاعتماد عند التغيير، ومنع المرور من حالة مرفوضة.
- محاكاة منع التكرار والحجز المتزامن وانتهاء الحجز وbackoff والمحاولات المحدودة ومصالحة النتيجة المجهولة.
- رفض الوضع الحي حتى إذا طلبته environment، ورفض نتائج نجاح فارغة أو قياسات مالية مخترعة.
- تعليمات خبيثة كنص بيانات خامل في JavaScript، لا كاختبار متانة LLM ضد الحقن.
- اختبارات runtime driver الجديدة: opt-in صريح، dispatch لاسم دقيق، wrapper Task الفعلي، منع إصلاح رد الطفل، مطابقة expectedTask، والتحقق من child export والأدوات المسجلة باستخدام بيانات اختبار offline.

## نتيجة المحاكاة المثبتة

```json
{
  "mode": "offline-dry-run",
  "scheduler": false,
  "realAdapter": false,
  "network": false,
  "database": false,
  "llmInteraction": false,
  "simulatedReceipts": 1,
  "stage": "dry_run_complete",
  "binding": "2e4c702d2ef3abb2ea161bc4a36f6e879ad2962064f1adae40608677cb4f0acc"
}
```

هذه أرقام اختبار اصطناعي، لا تحليلات الموقع أو أخبارًا منشورة. مصفوفة أحداث المحاكاة عادت على stdout، ولا يوجد سجل تدقيق إنتاجي دائم.

## مراجعة مستقلة والتصحيحات

أُجريت مراجعة قراءة مستقلة عبر وكيل تطوير. عولجت ملاحظاتها في نطاق المحلي:
بصمة الأدلة والمخرجات، إزالة استثناء shell الواسع، منع موارد MCP للأوراق، منع النجاح الفارغ، توحيد غلاف الوكلاء، إضافة metadata gates وحد تصحيحات فعلي، وتخفيف false positives في أسماء حقول غير سرية.

## الأداء والتكلفة والحدود

suite Node لا تستدعي LLM أو خدمات مدفوعة، ولا يقاس زمن خبر أو PG من أزمنتها. smoke القديم اصطناعي؛ مراجعات المادة 53 اللاحقة فعلية ومحددة المصادر. إجمالي الكلفة/الرموز غير متاح، وCLI cost=0 ليس إثبات مجانية. mini فشل API BadRequest؛ إعداد low على gpt-6.1-sol للأدوار المحددة ليس وفرًا ماليًا مقاسًا.

يثبت التقرير الآن مراجعات مادة فعلية وصورتها الأصلية ومطابقة الصفحة الحالية وإصلاح أصل SEO الإنتاجي المأذون، إضافة إلى الاختبارات الاصطناعية السابقة. لا يثبت بوابة نشر قبل الاعتماد أو استمرارية عامل أو عزل OS. المتبقي بوابة الخادم، وحقوق/feed للالتقاط الآلي، والجرد والتكامل الدائم وstaging E2E؛ تفويض المادة والإصلاح ليس تفعيلًا للأتمتة أو ترخيص ناشر.
