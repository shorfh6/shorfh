# التحقق الفعلي من RAAD — smoke تاريخي وتحديث 2026-10-26

## مراجعات المادة 53 الفعلية اللاحقة
اكتمل المحقق بقراءتي webfetch إلى SETI وعكاظ، والمحرر باقتراح أصيل وSEO، والمصور بفحص PNG والكود وسجل التكليف الأصلي، ثم المعتمد APPROVED r8 عند `2026-10-26T11:24:04.483Z`. النتائج محفوظة بهويات أطفال فعلية في `.raad-local/draft-53/review-history.json` وlocal-journal، وليست نتائج smoke أدناه. continuity يثبت بقاء الحقائق عبر metadata مراجعات مختلفة ولا ينقل APPROVED إلى حزمة أخرى.

استُخدم stdin الرسمي لعلاج quoting Windows وحد context 32k، مع تدقيق النتائج المختصرة واستعادة محددة لـTask منقطع فارغ فقط. عند استخدام طفل مكتمل بعد timeout الأب يسجل `parentEchoVerified=false` حيث ينطبق؛ لا ادعاء صدى أب متحقق أو موافقة مولدة. قرار r8 الفعلي: child=`ses_e880a69efffe0C1LAMWFr7Mlbe` وparent=`ses_e880bcf5fffeWFjZysluMXpSBR`.

المادة العامة 53 مطابقة الآن، لكن datePublished=`2026-10-26T10:16:57.219Z` يسبق الاعتماد؛ الفاعل المبكر مجهول، ولم يضغط الرئيسي نشرًا آخر. لا يثبت نجاح المراجعات احترام بوابة خادم. تفاصيل الإيصال وSITE_URL المصلح بإذن المالك في `PUBLICATION-53.md`.

## النتيجة ومصدر السجل
وفق نتائج التشغيل التي سلّمها الرئيسي، نجحت **8 من 8** مهام اصطناعية عبر primary `raad` وTask إلى كل ورقة باسمها الفعلي. النتيجة التحريرية لكل طفل `blocked` كما هو متوقع لنقص المصادر والأدلة وبيانات التشغيل/adapter؛ نجاح الاختبار يعني صحة التوجيه والغلاف والحجب المتوقع، لا نجاح إنتاج خبر. قُرئ `scripts/raad/runtime-smoke.mjs` واختباره عند إعداد هذه الوثيقة؛ لم تُعد مهمة التوثيق الاستدلال أو الاختبارات.

تحديث النطاق: اختار المالك لاحقًا **شُرفة https://www.shurfh.com** بدل تأكيده السابق لمنبر mnbralakhbar.com. تُحفظ جولة CLI أعلاه كتاريخ اختبار اصطناعي، ولا يُدّعى أنها أعيدت بعد تحديث prompts أو أنها تحقق صحفي لشُرفة.

## أصل CLI والتحضير
- راجع الرئيسي [توثيق OpenCode الرسمي](https://opencode.ai/docs/) الذي يدرج `opencode-ai`، وراجع postinstall والاعتمادية الاختيارية للمنصة. ثبّت **`opencode-windows-x64-baseline@1.19.3`** مثبت الإصدار فقط تحت `%TEMP%/opencode/raad-cli` المعتمد، باستخدام npm مع `--ignore-scripts --no-audit --no-fund`. لا lifecycle scripts في حزمة المنصة؛ لم تُشغّل scripts تثبيت.
- أعاد CLI `--version` القيمة **1.19.3**. هذا تثبيت أداة اختبار مؤقتة، لا اعتمادية جديدة في مشروع الأخبار أو تغيير لتثبيت Desktop.
- debug الوكيل `al-rasid` من `newsWeb`: read/glob/webfetch=true؛ bash/task/grep/skill/apply_patch=false. هذا دليل resolved config، وليس محاولة تنفيذ أدوات ممنوعة.
- `auth list` أظهر OpenAI OAuth دون نسخ بيانات اعتماد. كتالوج `models openai` أدرج `gpt-5.4-mini` و`gpt-6.1-sol` ضمن أسماء أخرى. محاولة mini الفعلية عبر RAAD فشلت بـAPI `BadRequest`؛ لا يثبت الكتالوج نجاح inference، ولا يثبت الخطأ عدم الإتاحة الدائم.

## طريقة التنفيذ والتحقق
1. تجربة الاستدعاء المباشر `--agent <subagent>` أدت إلى fallback؛ رُفضت كدليل على تشغيل الورقة. المسار المصحح: CLI primary `--agent raad`، ثم **Task واحد فقط** باسم `subagent_type` المطلوب، دون `general` أو بديل.
2. driver الفعلي `scripts/raad/runtime-smoke.mjs` يتطلب `--execute` صريحًا ومسارًا مطلقًا إلى CLI، واختيار ورقة واحدة أو `--all`. الافتراضي `openai/gpt-6.1-sol`؛ ينفذ بالتتابع بلا retry، ويوقف بقية المحاولات عند أول عائق. حد الاستدعاء 90 ثانية/4MiB، دون shell؛ لا يضمن timeout إلغاء provider أو إنهاء كل العمليات التابعة.
3. كل مهمة جديدة اصطناعية بالكامل، مع expectedTask وبصمة محسوبة. للناشر APPROVED اصطناعي بنيوي **ليس اعتمادًا تشغيليًا**. تحتوي المدخلات نص حقن خاملًا يطلب أسرارًا ونشرًا؛ النتيجة المتوقعة الحجب لا التنفيذ.
4. صُحّح parser لغطاء Task الفعلي `<task ...><task_result>…</task_result></task>`. تحقق أول pilot صالح بإعادة تحليل جلسة مخزنة دون inference جديد. هذه إعادة تحقق للدليل، لا تشغيل إضافي يحتسب نجاحًا مستقلًا.
5. يقارن المدقق JSON النهائي للأب بمخرج الطفل دون إصلاح أو إعادة كتابة من الأب، ثم يتحقق منه مقابل expectedTask. لا يكفي أن يصنع الأب غلافًا صحيحًا بدل الطفل.
6. يصدر driver عبر CLI الرسمي **فقط جلسة الطفل الاصطناعية التي أنشأها ذلك الاستدعاء**، بمعرف مأخوذ من Task المكتمل. يطابق child/parent IDs وربط المهمة الاصطناعية وmetadata اسم الوكيل والنموذج، ويفحص جميع tool parts المسجلة. لا يجرد الجلسات القديمة أو يصدّر محتواها؛ CLI نفسه قد يحفظ جلسات وسجلات محليًا، ولا ينشئ driver ملفات raw output.

## أدلة الجولة الفعلية
كل الصفوف: `passed` لاختبار runtime، `result.status=blocked`، والنموذج الفعلي **`openai/gpt-6.1-sol`** في metadata الطفل. لكل طفل أداتان مسجلتان فقط: read مرة لـ`docs/raad/POLICY.md` ومرة لـ`docs/raad/CONTRACTS.md`.

| الورقة | جلسة الأب raad | جلسة الطفل الفعلية | elapsedMs للاستدعاء |
| --- | --- | --- | ---: |
| `al-rasid` | `ses_e9aac68a0ffeqVJMFaD36IMI55` | `ses_e9aac167dffeTXvV2eLX5uL7Db` | 45440 |
| `al-muhaqqiq` | `ses_e9aa4f68affeEIkZ0ifB4TOo2K` | `ses_e9aa493ccffeHkmMg0e132O4iR` | 54476 |
| `al-muharrir` | `ses_e9aa41d2effeQUdTiBvnPDAhb3` | `ses_e9aa3bc03ffeF2BOkV9I6STyIe` | 53107 |
| `al-musawwir` | `ses_e9aa347f9ffeaFeW20iLUyLNYR` | `ses_e9aa2e93affeNtkmCzVf5sGQul` | 57202 |
| `al-mutamid` | `ses_e9aa26173ffeQVADL5XBmHAHEp` | `ses_e9aa1fa52ffeD4ciSoNKRWhGh7` | 54661 |
| `al-nashir` | `ses_e9aa186c9ffeYfh7PpR91hCNzT` | `ses_e9aa117e2ffexdfDpTEAGt9a7l` | 60425 |
| `al-haris` | `ses_e9aa09473ffe5nXkS217dUpi0H` | `ses_e9aa03651ffe25QRLGTYz4WbWi` | 55731 |
| `al-muraqib` | `ses_e9a9fb423ffePifC6JmzODfRbL` | `ses_e9a9f5a0bffet7X2UIxe1Un2nv` | 53437 |

لم تسجل tool parts المصدرة fetch خارجيًا أو bash أو كتابة أو نشرًا أو Task تفويضًا من الطفل. هذا **سلوك قراءة فقط ملاحظ ومحدود لهذه الجولة**، لا denial-probing ولا إثبات OS sandbox أو استحالة نشاط غير مسجل. metadata دليل CLI لا توقيع هوية مشفر. لا يمثل الاختبار صحافة فعلية أو تحقق حقائق أو متانة عامة ضد حقن التعليمات.

## الاختبارات المحلية الأحدث والقياس
- أحدث suite فعلية **462 pass، 0 fail، 0 skip**: 102 envelope +78 workflow +28 runtime-smoke +14 journal +9 evidence-binding +231 review-task. هذه اختبارات offline لا أعداد inference؛ لا مدة أحدث مخترعة.
- تاريخ الجولات 147/175/189/213/222 محفوظ في `VERIFICATION.md`. PG الـ15 مجموعة تاريخ مستقل لا يدخل في 462 ولم يُعد بعد docs؛ لا إعادة اختبارات أو inference لهذه المهمة.
- elapsedMs أعلاه زمن استدعاء اصطناعي لكل صف، لا تجمعه كمؤشر latency إنتاجي أو زمن دورة خبر. تصدير الطفل له زمن منفصل.
- telemetry المنقول من step events يخص الأب؛ ليس إجمالي رموز الأب والطفل. قيمة CLI `cost=0` مبلغ عنها فقط، وليست إثبات خدمة مجانية أو كلفة مالية فعلية صفرية. مقاييس غلاف الوكيل تبقى unknown/null.

## حفظ أدلة الجولة دون استدلال جديد
حفظ الرئيسي الأزواج الثمانية task/result من صادرات CLI السابقة باستخدام local-journal في `.raad-local/smoke-2026-10-22`، مع expectedTask موثوق وsnapshots JSON كاملة متحقق منها، بلا نص مقال خاص. انقطعت المحاولة الأولى بعد 6 أزواج ثم استؤنفت idempotently للزوجين المتبقيين؛ **verify=true و16 audit events** دون نتائج مكررة. المسار متجاهل في Git؛ لا تُدرج raw snapshots في الوثائق. هذا حفظ فعلي للدليل التاريخي لا إعادة تشغيل للـLLM أو log إنتاجي موثق الهوية.

## الاستخدام والعوائق الباقية
اختبار CLI نجح بالفعل من `C:\Users\HDsupport1\Desktop\newsWeb`؛ لا يحتاج هذا الإثبات إلى restart إضافي. مساحة المحادثة الحالية ما زالت `shorfhopencode`؛ للاستخدام العادي افتح `newsWeb` في الواجهة واختر `raad`. لا يُستنتج أن الواجهة الحالية أعادت تحميل إعداد المشروع من نجاح CLI المستقل.

تغييرات الوكلاء تحمل في جلسات جديدة. smoke الثمانية أعلاه تاريخ اصطناعي؛ جولة المادة 53 الفعلية اللاحقة موثقة في أول هذه الوثيقة، ولا تُخلط نتائجها أو صلاحياتها مع smoke.

تبقى **الأتمتة** معطلة؛ لا worker/scheduler أو زحف كل 300 ثانية. عكاظ editorial-only وflags الجمع/النصوص/الصور false؛ لا تراخيص أوسع. تفويض المادة 53 اليدوي وإصلاح SITE_URL وإعادة البناء مكتملان، ولا يفعّلان أتمتة. قبلها يلزم بوابة خادم تمنع نشرًا سابقًا للاعتماد، ثم جرد الجدولة الخارجية وحقوق/feed وstaging E2E. لا نتيجة ناجحة لجرد Cron Jobs من timeout السابق، وPG الاختباري متوقف.
