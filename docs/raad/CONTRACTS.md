# عقود الرسائل والمراجعات

## انتقالات المراحل وبصمة الأدلة

كل مرحلة تملك بصمة مهمة كاملة مختلفة عند إضافة سجل المراجعات أو مقترح تحريري. لا يُشترط تساوي بصمة مهمة المحرر مع مهمة المحقق حرفيًا؛ هذا يجعل التسلسل ذاتي التعطيل. بدلًا منه يتحقق المنسق عبر `evidence-binding.mjs` من نتيجة المحقق الأصلية المرتبطة بمهمته ومن تطابق SHA-256 للحقائق والأدلة والمصادر والتواريخ والروابط والهوية وحداثة السياسة بين المرحلتين. لا يعدّل هذا التقرير نتائج المحقق ولا يصححها تلقائيًا. تغير أي عنصر حقيقة/دليل يعيد التحقق. **اعتماد النشر النهائي لا ينتقل بهذه القاعدة**؛ يلزم APPROVED للحزمة النهائية الكاملة بما فيها النص وSEO والصورة والتصنيف والسياسة.

## التنفيذ وحدوده
العقد `raad.contract/1` منفذ في `scripts/raad/envelope.mjs`: الدوال `createTask` و`validateTask` و`validateResult(result, expectedTask)` و`reviewPackageHash` و`contentHash` و`auditSummary`. هو تحقق تبادل بيانات، لا تحقق واقعي من الأخبار ولا تصريح نشر أو توقيع هوية. المرجع التنفيذي هو الملف نفسه، وليس الأمثلة التوضيحية أدناه.

الرئيسي يحتفظ بـ`expectedTask` موثوقًا خارج رد الوكيل. لا يأخذه من الرد نفسه. تتحقق `validateResult` من المهمة والنتيجة، ثم تطابق الهوية والحزمة والبصمة والاعتماد مع المهمة. إعادة حساب بصمة على محتوى غيّره الوكيل لا تتجاوز المقارنة.

## الصيغة الآلية للغلاف
القيم النصية المطلوبة غير فارغة. أرقام المراجعة أعداد صحيحة آمنة حيث يحدد التنفيذ ذلك، والبصمات 64 محرف hex صغير. JSON فقط: لا دورات أو قيم غير محددة أو أعداد غير منتهية أو خصائص خفية/accessors. يرفض المدقق المفاتيح العليا غير المدرجة هنا؛ `inputHash/inputRevision/policyVersion` ليست حقولًا عليا بديلة.

| الحقل | الصيغة المقبولة حاليًا |
| --- | --- |
| `version` | `"raad.contract/1"` |
| `kind` | `"task"` أو `"result"` |
| `taskId`, `traceId` | نصان يقدمهما المنسق؛ لا يولدهما المدقق |
| `agent`, `role`, `stage` | أحد التطابقات في جدول الأدوار أدناه؛ `role === stage` |
| `revision` | `{id, parentId, number, revisionRounds}`؛ id نص، parentId نص أو null، number عدد صحيح آمن ≥1، revisionRounds عدد صحيح 0..2 |
| `hash` | `{algorithm:"sha256", value:"<64 lowercase hex>"}`؛ لا يقبل `unknown` |
| `policy` | `{id, version, hash, freshnessSeconds}`؛ النصوص غير فارغة، hash بصمة 64 hex، freshnessSeconds عدد صحيح آمن موجب |
| `input` | كائن JSON؛ يحتفظ المنسق داخله بحزمة المحتوى الكاملة اللازمة للدور |
| `sources` | مصفوفة كائنات ذات `id` نصي فريد؛ السمات التفصيلية ليست مخططًا مغلقًا في هذا المدقق |
| `claims` | مصفوفة `{id,text,status,confidence,...}`؛ القيم الأربع نصوص، id فريد؛ `verified` يحتاج ربط دليل |
| `evidence` | مصفوفة `{id,sourceId,excerpt,location,context,attribution,...}`؛ id فريد، sourceId موجود، والنصوص الأربعة غير فارغة |
| `references` | مصفوفة `{claimId,evidenceIds:[...] ,...}`؛ claimId موجود وغير مكرر في المصفوفة، evidenceIds غير فارغة وفريدة وكلها موجودة |
| `issues` | مصفوفة كائنات ذات `id` نصي فريد؛ حقول الشدة والإجراء وغيرها متطلبات تحريرية، لا يتحقق المدقق من بنيتها بعد |
| `output` | null للمهمة، وكائن مطابق لجدول مخرجات النتيجة أدناه |
| `decision` | null إلا نتيجة المعتمد؛ الصيغة التفصيلية أدناه |
| `approval` | null خارج مرحلة publishing؛ في مهمة/نتيجة الناشر قرار APPROVED مطابق للحزمة |
| `status` | null للمهمة؛ `completed` أو `blocked` أو `no_candidates` للنتيجة |
| `handoff` | null أو `{stage,agent}` حسب قواعد الانتقال أدناه، وليس مساحة ملاحظات حرة |
| `metrics` | `"unknown"` أو null؛ يسمح المدقق بالإغفال، وcreateTask يضع `"unknown"`. لا يقبل كائن أرقام |
| `error` | null أو `{code,message,retryable}` بنصين غير فارغين وboolean؛ وجوده يلزم status=blocked وdecision=null |

المفاتيح المغلقة أيضًا: revision/hash/policy/decision/error/handoff وكائن output حسب الدور. أما عناصر المجموعات وinput وكائنات المقترحات فليست مغلقة داخليًا؛ قبولها شكليًا لا يعني اكتمال الأدلة. `createTask` يملأ المجموعات الغائبة بمصفوفات فارغة ويحسب hash، لكن على المتصل تقديم المعرفات والمراجعة والسياسة والمدخلات الصحيحة.

### الأدلة والسياسة أبعد من الحد الأدنى الآلي
لكل مصدر فعلي: URL أصلي معتمد، حقوق الوصول وإعادة الاستعمال، وقت نشر إن عُرف ووقت جلب، مرجع المحتوى المحفوظ وبصمته. لكل اقتباس موضع وسياق ونسبة. الثقة تفسير أدلة وحدود، لا درجة عددية. لا يتحقق envelope من ملكية المصدر أو صلاحية الترخيص أو حقيقة الادعاء، ولا من جميع هذه السمات الإضافية. `assertNoSecrets` يرفض أنماط أسرار ومفاتيح حساسة وروابط ذات بيانات دخول؛ هو فحص احترازي غير شامل، لا تنقيح مضمون أو إذن إرسال.

لا تستخدم `unknown` بدل نوع إلزامي أو بصمة مطلوبة. سجّل نقص المعلومات داخل بيانات المهمة/سبب الحجب، ثم `blocked` إن منع بوابة جوهرية. الاستثناء من حداثة 24 ساعة يحتاج توثيق سياسة ومراجعة؛ لا يوجد مسار استثناء جاهز في workflow الاصطناعي الحالي، فلا تتجاوز بوابته لمجرد وجود ملاحظة.

## الأدوار والمخرجات الصارمة
في `completed` يجب أن يكون `error=null` وoutput كائنًا غير null. يقيّد المدقق المفاتيح الخارجية للمخرج كما يلي، دون افتراض مخطط أعمق غير منفذ:

| agent | role / stage | output عند completed | handoff |
| --- | --- | --- | --- |
| `al-rasid` | `discovery` | `{candidates:[{...}]}`؛ مصفوفة غير فارغة من كائنات غير فارغة | verification / al-muhaqqiq |
| `al-muhaqqiq` | `verification` | `{report:"...",proposals:{...}}`؛ report مطلوب، proposals اختياري وكائن غير فارغ إن حضر | editing / al-muharrir |
| `al-muharrir` | `editing` | `{proposal:{...}}`؛ مقترح غير فارغ | media / al-musawwir |
| `al-musawwir` | `media` | `{proposal:{...}}`؛ مقترح غير فارغ | approval / al-mutamid |
| `al-mutamid` | `approval` | `{report:"...",reviewedHash:"نفس hash.value"}` مع decision مطلوب | حسب القرار |
| `al-nashir` | `publishing` | `{mode:"dry_run",simulated:true,inputHash:"نفس hash.value"}` فقط | null |
| `al-haris` | `security` | `{report:"...",proposals:{...}}`؛ proposals اختياري وغير فارغ إن حضر | null |
| `al-muraqib` | `monitoring` | `{report:"...",proposals:{...}}` بالشروط نفسها | null |

- `blocked`: لجميع الأدوار `decision=null` و`handoff=null`؛ output هو `{reason:"..."}`، عدا الناشر: `{mode:"preflight",adapter:"blocked",inputHash:"نفس hash.value",reason:"..."}`. error قد يبقى null لحجب تشغيلي أو تحريري، أو يحمل خطأ تقنيًا منقحًا.
- `no_candidates`: للراصد فقط، output هو `{candidates:[],reason:"..."}` وdecision/error/handoff كلها null. غياب سجل مصادر معتمد **blocked**، لا يُعرض كاكتشاف ناجح بلا مرشحين.
- `task`: status/output/decision/error/handoff كلها null. approval موجود فقط للناشر وبنفس الحزمة. metrics من القيم المسموحة أعلاه.
- `handoff` انتقال مقترح للرئيسي لا استدعاء أداة. المخرجات أعلاه لا تغيّر الحزمة؛ لا تمنح completed صلاحية نشر أو تثبت جودة الحقائق بذاتها.

## الحزمة الثابتة والاعتماد
تغطي `reviewPackageHash` بالضبط الحقول:

```text
input, revision, policy, sources, claims, evidence, references, issues
```

التمثيل معياري: مفاتيح الكائنات مرتبة، ترتيب المصفوفات محفوظ، وJSON primitives دون تحويل ضمني؛ SHA-256 على النص الناتج. لا تدخل output أو decision أو metrics في الحزمة. لذلك يجب أن يكون النص والعنوان والوسائط وmetadata المطلوب اعتمادها داخل `input`/الحزمة **قبل** المراجعة، لا داخل proposal غير متبنٍّ.

تطابق النتيجة المهمة الموثوقة في taskId/traceId/agent/role/stage/hash/approval وكل الحقول الثمانية المربوطة. تظل الحزمة كما استلمها الوكيل؛ يضع التصحيحات في output.proposal أو proposals. الرئيسي وحده يتبناها في **مراجعة جديدة**، ويبني مهمة ببصمة محسوبة جديدة. لا يعيد تدوير اعتماد قديم أو يثق ببصمة كتبها النموذج.

صيغة القرار المغلقة:

```text
{status, reviewer, reviewedAt, revisionId, revisionHash, reason, evidenceIds, issueIds}
```

- status حصريًا `APPROVED | REVISION_REQUIRED | REJECTED | ESCALATE`؛ reviewer=`al-mutamid`؛ reviewedAt وقت قابل للتحليل مع timezone؛ reason نص غير فارغ.
- revisionId/hash مطابقان للغلاف؛ evidenceIds وissueIds مصفوفتان تشيران إلى عناصر موجودة. المدقق لا يثبت أن وقت المراجعة وقت فعلي أو أن صاحب الرد هو إنسان مخول.
- top-level decision فقط في result المعتمد بمرحلة approval. غير المراجع لا يضع قراره فيه؛ مقترحات المخاطر داخل output ولا تغير issues المربوطة. مهمة الناشر تحمل الاعتماد في `approval` مع decision=null، وتحفظ النتيجة approval نفسه.
- APPROVED يسلم إلى publishing/al-nashir؛ REVISION_REQUIRED إلى editing/al-muharrir، ولا يُقبل إذا revisionRounds بلغ 2؛ REJECTED/ESCALATE بلا handoff. completed لدى المعتمد قد يعني رفضًا مكتمل المراجعة، لا موافقة.
- يفرض envelope حدود رقم الجولة ويقارنها بالمهمة؛ لا يدير تاريخ القصة بنفسه. يدير workflow المحلي حد جولتي التصحيح، ويصعّد عند محاولة تجاوزه. في الإنتاج يلزم سجل دائم موثوق يمنع إعادة عداد الجولات.

## مثال توضيحي غير صالح كـfixture
هذا مثال **نتيجة راصد محجوبة** في fixture تاريخية ذات سجل فارغ، وليس وصفًا لسجل عكاظ الحالي. القيم بين `<...>` مواضع استبدال لبصمات **محسوبة برمجيًا** وليست بصمات صالحة؛ المثال كما هو لا يجتاز المدقق، ولا يمثل نتيجة اختبار أو خبرًا حقيقيًا. ابنِ المهمة أولًا بـcreateTask ثم انسخ الحزمة المطابقة في result ومرر expectedTask الأصلي إلى validateResult.

```json
{
  "version": "raad.contract/1",
  "kind": "result",
  "taskId": "synthetic-task-1",
  "traceId": "synthetic-trace-1",
  "agent": "al-rasid",
  "role": "discovery",
  "stage": "discovery",
  "revision": {"id": "synthetic-r1", "parentId": null, "number": 1, "revisionRounds": 0},
  "hash": {"algorithm": "sha256", "value": "<COMPUTED_REVIEW_PACKAGE_SHA256>"},
  "policy": {"id": "synthetic-policy", "version": "1", "hash": "<COMPUTED_POLICY_SHA256>", "freshnessSeconds": 86400},
  "input": {"synthetic": true, "sourceRegistryState": "empty"},
  "sources": [],
  "claims": [],
  "evidence": [],
  "references": [],
  "output": {"reason": "سجل المصادر فارغ وينتظر اعتماد المالك"},
  "decision": null,
  "approval": null,
  "issues": [],
  "handoff": null,
  "metrics": "unknown",
  "error": null,
  "status": "blocked"
}
```

## workflow والـmetadata والتشغيل
`workflow.mjs` عقد محاكاة منفصل لا يستدعي وكلاء LLM. يشترط علامة synthetic، قسمًا من لقطة fixture، مصادر مصطنعة approved ومذكورة في trustedSources ودليلًا نصيًا، وحداثة وفحص ادعاءات ومخاطر بلا تعارض. ثم يفحص تغطية المسودة لكل claim وحقوق الوسائط ووسم الصورة التوضيحية. قبول `proof` نصي أو flag في fixture ليس تحققًا واقعيًا أو اعتمادًا لمصدر في السجل الحقيقي.

بوابة metadata المنفذة تفحص: title غير فارغ؛ slug أحرف لاتينية صغيرة/أرقام بشرطات؛ ALT غير فارغ؛ origin HTTPS مطابقًا لصيغته وimage HTTPS بلا userinfo؛ canonical مطابقًا لـ`origin/category/slug` **في fixture فقط**؛ metadata.approved؛ NewsArticle من schema.org مع headline/articleSection/url/mainEntityOfPage المطابقة، وauthor Person وpublisher Organization المطابقين للأسماء، وimage المطابق للوسيط. datePublished/dateModified بصيغة UTC ISO موحدة، غير مستقبلية، والتعديل لا يسبق النشر. لا تثبت هذه المقارنات وجود URL أو مؤلف أو صورة فعلية، ولا تحدد مسار صفحات الموقع الحقيقي؛ يلزم ربط staging وقراءة لاحقة.

`validateSourceRegistry` يقبل حالتين مغلقتين فقط: fixture القديمة `{version:"raad.contract/1",ownerApproval:"pending",sources:[]}`، والبيان التحريري المراجع لعكاظ وحده بالقيم والروابط والتاريخ الفعلي في `config/raad/sources.json`. الثاني ownerApproval=editorial-only، approvalScope=editorial-reference-only، approvedBy=owner؛ automatedCollection/articleRepublication/imageReuse=false، rightsStatus=permission-pending؛ discovery rss-index وfeedVerified=false، policy.reviewedOn=2026-10-25. الحقول مطلوبة والإضافات مرفوضة على مستويات السجل/المصدر/discovery/policy، ولا تفتح الحقوق أو feedVerified بتعديل JSON وحده؛ راجع `SOURCES.md`.

`validateRuntime` يبقى dry-run مع 300 ثانية وlivePublishing=false وschedulerInstalled=false. لا يمنح المدقق موافقة حي أو ينفذ جدولة. envelope حاليًا 102 حالة؛ أحدث suite كلي 512 بعد فحوص طابور المعتمد ومفتاح Vault، والجولات 507/492/486/462/213/222 تاريخية. عامل نشر المعتمد فُعّل بإعداد وجدولة مستقلين وتفويض واختبار موثقين في APPROVED-WORKER-ROLLOUT.md؛ لا يغير عقد ورقة الناشر أو يشغل دورة الاكتشاف والمراجعات.

## تحقق CLI الفعلي، منفصل عن workflow
`runtime-smoke.mjs` driver حقيقي opt-in بـ`--execute`، افتراضيه `openai/gpt-6.1-sol`. يبدأ primary raad من `newsWeb` ثم Task واحد باسم الورقة المحدد؛ لا general أو fallback أو retry أو إصلاح لرد الطفل. يطابق نتيجة الأب مع JSON الطفل داخل wrapper Task الجذري، ويتحقق من الغلاف مع expectedTask الموثوق، ثم official CLI export للطفل الاصطناعي الجديد فقط لإثبات parent/task binding وmetadata اسم الوكيل والنموذج وtool parts. تصدير الطفل ليس استدلالًا جديدًا أو سجل تدقيق إنتاجيًا.

الجولة الفعلية نجحت 8/8 مع blocked متوقع لنقص المدخلات، وread مرتين لكل طفل لـPOLICY وCONTRACTS فقط. ليست اختبارًا لحقيقة ادعاءات أو إنفاذ منع شامل؛ غياب أدوات ممنوعة من الصادرات سلوك ملاحظ لا denial-probing. الناشر يحمل APPROVED اصطناعيًا بنيويًا مع operationalAuthorization=false، فلا يتحول إلى إذن نشر. تفاصيل الجلسات والحدود في `RUNTIME-VERIFICATION.md`. اختبارات `.test.mjs` للـdriver تظل offline، ولا تنفذ الاستدلال تلقائيًا.

## القياس والتدقيق والثقة
- `metrics` في الغلاف unknown/null فقط؛ telemetry المقاس للمنسق منفصل. يمكن لتقرير المراقب وصف قياسات مع مرجعها، لكنها لا تتحول تلقائيًا إلى telemetry موثوق.
- `auditSummary` يتحقق من النتيجة مع المهمة ثم يعيد ملخصًا مجمدًا في الذاكرة: version، بصمتا taskId/traceId، agent/stage، رقما المراجعة والجولات، inputHash، بصمة policy.version، decision، outcome، failed، وعددا claims/evidence. لا يخزن النصوص ولا يكتب سجلًا دائمًا؛ failed هنا حجب أو رفض/تصعيد وليس تقييمًا شاملًا للجاهزية.
- events/audit في workflow وdry-run مصفوفات ذاكرة. HANDOFF سجل تطوير في المستودع، لا log إنتاجي append-only. منفذ المعتمد الإنتاجي أصبح يملك طابورًا ومعاملات وoutbox وreceipts وlease/fencing وDLQ ومصالحة دائمة؛ مرجعه APPROVED-WORKER-ROLLOUT.md. لا يجعل ذلك سجل المراحل السابقة أو التفرد بين قصص المصادر أو دورة LLM كاملة تكاملًا منجزًا.
- المحتوى الخارجي بيانات خاملة؛ لا تعليمات أو أدوات أو انتحال أدوار. لا يمنح hash توقيعًا أو هوية ولا تثبت البنية الصحيحة صدق الخبر. لا يُعلن نشر حقيقي أو receipt أو URL منشور بهذا الإصدار المحلي.

## سجل تطوير محلي منفذ، لا سجل إنتاجي
`scripts/raad/local-journal.mjs` طبقة filesystem صريحة يملك استخدامها المنسق، منفصلة عن auditSummary الذي لا يكتب بنفسه. الاستيراد لا يجري I/O؛ `openJournal(absoluteDirectory)` فقط يفتح/ينشئ المخزن محليًا وبصورة synchronous. لا directory افتراضي، ولا تشغيل دائم أو نشر أو تفويض أو اعتماد تشغيلي.

| API | السلوك المنفذ |
| --- | --- |
| `recordTask(task)` | يتحقق من الغلاف والأسرار قبل تخزين snapshot كاملة، ويعيد digest ملفها |
| `recordResult(result, expectedTask)` | expectedTask إلزامي وموثوق، ويتحقق validateResult قبل التخزين؛ يجب تسجيل المهمة أولًا |
| `readAudit()` | يقرأ السلسلة بعد فحص snapshots والروابط والبصمات |
| `verify()` | يعيد true إذا اجتاز المخزن فحوص السلامة، ويرفض عند التلف |

- snapshots ملفات JSON كاملة داخل `snapshots/<sha256-of-bytes>.json`، لا مجرد metadata ولا تشفير. قد تضم نص المدخلات والأدلة والمخرجات المسموحة؛ يجب تنقيحها قبل الاستدعاء. `assertNoSecrets` يرفض أنماطًا معروفة **ولا ينقح أو يضمن خلو النص من كل سر**.
- `audit.jsonl` يحفظ metadata فقط: version=`raad.local-journal/1` وseq وprevious وtype وtaskDigest وresultDigest وsummary/hash؛ summary من auditSummary، بلا نص المقال. digest bytes للملف غير بصمة reviewPackageHash، ولا يحل محلها.
- تُنشأ snapshots حصريًا دون استبدال. تكرار نفس المهمة/النتيجة idempotent؛ نتيجة مختلفة لنفس task digest مرفوضة. لكل snapshot حد **1MiB** ولملف audit حد **16MiB**؛ بلوغ الحد يرفض الكتابة، لا rotation أو حذف تلقائي.
- قفل `journal.lock` حصري وfsync للملفات، ومحاولة fsync للدليل حيث يدعمه النظام. لا فتح متزامن عند وجود lock ولا stale auto-unlock؛ القفل المتروك يحتاج تحقيقًا يدويًا، ولا يُصلح السجل المتضرر تلقائيًا. أخطاء الواجهة تعرض JOURNAL_REJECTED؛ ليست إشارة لاستئناف النشر.
- chain والبصمات تكشف التغييرات العرضية ضمن الفحوص، لا مصادقة مراجع أو سجلًا لا يستطيع مسؤول النظام إعادة كتابته. ضوابط filesystem هي حدود الوصول، وليست صلاحيات الغلاف أو عزل OS؛ لا ضمان crash-atomic DB transaction أو استعادة تلقائية.
- لا يعني وجود الوحدة أن كل تشغيل CLI/workflow يحفظ فيها تلقائيًا؛ الربط واختيار الدليل مسؤولية الرئيسي. لا طابور إنتاجي أو outbox أو scheduler أو fulfillment لبند audit الإنتاجي append-only.

اختبارات journal **14** ضمن أحدث suite **492 pass، 0 fail، 0 skip**. حفظ smoke الثمانية في `.raad-local/smoke-2026-10-22` بـ16 audit events تاريخ صحيح. أضيفت لاحقًا مراجعات المادة 53 الفعلية إلى review-history/local-journal؛ ليست بيانات smoke. لا تُنسخ raw snapshots في الوثائق، ولا يُعد ذلك log إنتاجيًا؛ الإيصال العام وتوقيت النشر السابق للاعتماد في `PUBLICATION-53.md`.

استمرارية evidenceDigest تربط حقائق وأدلة غير متغيرة عبر metadata مهام جديدة، ولا تتجاوز مقارنة expectedTask أو تنقل APPROVED النهائي. مراجعة المادة 53 r8 مرتبطة بحزمتها كاملة. عند استعادة نتيجة طفل مكتمل بعد timeout الأب، يسجل نقص صدى الأب `parentEchoVerified=false` حيث ينطبق؛ لا يُصنع رد أب أو اعتماد بديل. إثبات فرض القرار على الخادم ما زال مطلوبًا قبل النشر الآلي.

## مرجع queue اصطناعي على PostgreSQL
يوجد تنفيذ محلي فعلي مغلق لا يقبل إلا fixture اصطناعية محددة، مع 15 مجموعة تكامل ناجحة بعد إصلاح lock-wait/lease expiry، وليس API لحزم الأخبار الحقيقية أو ربطًا إنتاجيًا. يثبت معاملات وربط approval/outbox/receipt وحفظًا محليًا بعد stop/start؛ لا يتحول وصف التكامل الإنتاجي أعلاه إلى «منفذ» بوجوده. `PG-DRY-RUN.md` المرجع الكامل للعقد والقيود وendpoint الاختبار وأدلة المجموعات، ولا يقع runner ضمن suite `*.test.mjs`. لا worker أو daemon أو migrations تطبيقية/سحابية؛ cluster الاختبار متوقف والخادم المحلي السابق دون مساس.
