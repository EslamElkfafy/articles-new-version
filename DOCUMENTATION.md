# توثيق شامل لمشروع استخراج الأبحاث الطبية
# Medical Research Extraction Pipeline — Full Documentation

---

## نظرة عامة على المشروع | Project Overview

هذا المشروع عبارة عن **pipeline** (خط معالجة) متكامل مبني بـ Node.js، هدفه استخراج وتحليل الأبحاث الطبية العلمية من قاعدة PubMed/PMC، وتحليلها بالذكاء الاصطناعي، وتصنيف نتائجها داخل قاعدة بيانات PostgreSQL.

المشروع يجيب على السؤال الجوهري:
> **ما هي المنتجات الطبيعية (أعشاب، فيتامينات، أغذية...) التي تؤثر على مرض معين؟ وكيف؟ وما هو الدليل العلمي؟**

---

## البنية الكاملة للـ Pipeline | Full Pipeline Architecture

> **⚠️ تنبيه جوهري — نقطتا دخول مختلفتان تماماً**
> 
> المشروع له **مسارَان مستقلان** للتشغيل. الخلط بينهما يؤدي لفهم خاطئ للكود.

---

### المسار الأول: من الصفر — `process-all-diseases.cjs`

```
┌──────────────────────────────────────────────────────────────────────┐
│  INPUT: بيانات منظمة مسبقاً                                         │
│  roots-data.json  →  قائمة المنتجات + MeSH Names                    │
│  diseases_msh-2.json  →  قائمة الأمراض + MeSH Names                 │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  process-all-diseases.cjs                                            │
│  يبني استعلامات MeSH → يبحث NCBI PubMed API → يجمع المقالات        │
│  يحسب DW مبدئياً → يحفظ CSV → يستدعي getURL()                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ يستدعي getURL() مع مقالات جاهزة
                               ▼
             ┌─────────────────────────────────┐
             │  getURL.js  (الدالة getURL)     │
             │  + getContent.js + Ai.js        │
             └─────────────────────────────────┘
```

---

### المسار الثاني: من ملف Excel — `node getURL.js` مباشرةً

```
┌──────────────────────────────────────────────────────────────────────┐
│  INPUT: new Script data.xlsx                                         │
│  ملف Excel يحتوي مقالات علمية جاهزة بـ PMID, DOI, title, rate...   │
│  ⚡ لا يوجد roots-data.json  ولا diseases_msh-2.json هنا             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  node getURL.js
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  getURL.js → main()                                                  │
│  يقرأ الـ Excel → يُنشئ pseudoGroup واحد (disease_name ثابت)        │
│  يُمرّر المقالات لـ getURL() مباشرةً                                │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  getContent.js                                                       │
│  يجلب النص الكامل أو الملخص لكل مقال من PMC/PubMed                  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Ai.js (Mistral)                                                     │
│  يقرأ نص المقال → يستخرج ديناميكياً:                               │
│  • root_name (اسم المنتج) ← الـ AI يختاره بنفسه من النص            │
│  • disease_name ← الـ AI يختاره بنفسه من النص                       │
│  • root_causes, labs, scientific_name, processing_status            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  getURL.js → دالة getURL() — المعالجة والتطبيع                      │
│  • تطبيع root_name → fuzzy match مع Full-Roots.json                 │
│  • تطبيع disease_name → fuzzy match مع disease_mappings.json        │
│  • حساب DW + deduplication + physical sort                          │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PostgreSQL — research_results                                       │
│  حفظ النتائج بـ bulkCreate + progress.json للاستئناف               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Post-Processing (بعد كل batch)                                     │
│  map_icd11_diseases.js  →  ربط الأمراض بـ ICD-11                   │
│  map_ai_roots_to_full.js  →  ربط المنتجات بـ Full-Roots IDs         │
│  migrate_research_results_roots_id.js  →  تحديث productId في DB     │
│  migrate_research_results_icd.js  →  تحديث ICD columns في DB        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DW Recalculation (على ملفات CSV/XLSX المُصدَّرة)                   │
│  recalculate_csv_dw.js  +  recalculate_xlsx_dw.js                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

---

# المرحلة الأولى | STAGE 1
# `process-all-diseases.cjs` — البحث وجمع المقالات من PubMed

> **هذا الملف خاص بالمسار الأول فقط** (التشغيل من الصفر).
> عند تشغيل `node getURL.js` مباشرةً، هذا الملف لا يُستخدم إطلاقاً.

---

## ما دور هذا الملف؟

**نقطة دخول المسار الأول**: يأخذ قوائم منتجات وأمراض **محددة مسبقاً**، يبحث عن كل تركيبة في PubMed، ثم يُسلّم المقالات الناتجة لـ `getURL()`.

**الخطوات التي يؤديها:**
1. يقرأ قائمة الأمراض من `diseases_msh-2.json` (مع MeSH Names رسمية)
2. يقرأ قائمة المنتجات من `roots-data.json` (مع MeSH Names رسمية)
3. لكل تركيبة (منتج × مرض)، يبني 3 استعلامات MeSH متدرجة الدقة
4. يجلب المقالات من NCBI API ويحسب الـ rate لكل مقال من pubTypeRates
5. يحسب درجة الأهمية (DW) المبدئية
6. يحفظ النتائج كـ CSV وJSON في مجلد `all diseases/`
7. يستدعي `getURL()` مُمرِّراً المقالات المجمَّعة

---

## الثوابت الهامة

```javascript
const MAX_ARTICLES = 100;        // الحد الأقصى للمقالات في كل batch API
const ARTICLES_THRESHOLD = 173;  // الحد الفاصل: إذا > 173 مقال → category = "not_ready"
const OUTPUT_DIR = "all diseases"; // مجلد حفظ ملفات الإخراج
```

**لماذا 173 مقالاً كحد؟**
> هذا العدد مُصمَّم كـ "حد الموارد" — أي أن المنتج الذي يرتبط بأكثر من 173 مقالاً يعني أن له دراسات مفرطة تستهلك وقت AI طويل جداً وتستهلك الـ tokens بشكل مجنون. الحد يحمي الـ pipeline من الإفراط في التكلفة.
> **ملاحظة تطوير:** هذا الرقم يمكن تعديله ديناميكياً بناءً على ميزانية API أو حجم الـ dataset.

---

## نظام تصنيف نوع الدراسة (pubTypeRates)

```javascript
const pubTypeRates = {
    "Systematic Review": 5,
    "Meta-Analysis": 5,
    "Randomized Controlled Trial": 4,
    ...
    "Letter": 1,
    "Editorial": 1,
};
```

**لماذا هذا التصنيف؟**
> هذا نظام أوزان مبني على **هرم الأدلة العلمية (Evidence Pyramid)** في الطب. الـ Systematic Review والـ Meta-Analysis هي أعلى درجات الدليل لأنها تجمع وتحلل دراسات متعددة. الـ RCT يأتي تالياً لأنه أكثر أنواع الدراسات صرامةً في ضبط المتغيرات. الـ Letter والـ Editorial أدنى درجة لأنها رأي فردي بلا تجربة.
> **البديل المرفوض:** كان يمكن إعطاء كل نوع نفس الوزن، لكن ذلك يعني أن رسالة قصيرة تساوي دراسة ممنهجة — وهذا علمياً خطأ.

---

## دالة `generateQueries(productMesh, diseaseMesh)`

تبني 3 استعلامات متدرجة الدقة:
- **Q1**: أصعب استعلام — يشترط أن يكون المنتج مصنفاً رسمياً كـ MeSH Heading مع استبعاد الآثار الجانبية
- **Q2**: أقل صرامة — لا يشترط الـ therapeutic use tag
- **Q3**: أسهل — يستخدم free-text بدلاً من MeSH tags

**لماذا 3 استعلامات؟**
> PubMed يفرق بين المقالات المُصنَّفة رسمياً بـ MeSH tags (وهي أدق) وتلك التي تُذكر فيها الكلمات فقط في النص. البحث يبدأ بالأدق ويتراجع للأشمل إذا لم يجد نتائج.
> **ملاحظة:** Q3 (free-text) قد يجلب نتائج غير دقيقة أحياناً لأنه لا يعتمد على التصنيف الرسمي.

---

## دالة `calculateDW(articles)`

```javascript
function calculateDW(articles) {
    const rates = articles.map(a => a.rate === 0 ? 1 : a.rate);
    const sum = rates.reduce((a, b) => a + b, 0);
    const max = Math.max(...rates);
    return sum * max;
}
```

**ما هو الـ DW (Diagnostic Weight)?**
> DW = مجموع درجات كل المقالات × أعلى درجة فردية
>
> هذه الصيغة مُصممة عمداً لتعطي أهمية مضاعفة للمنتجات التي:
> - لديها عدد كبير من المقالات (يرفع الـ sum)
> - ولديها على الأقل دراسة واحدة عالية الجودة (يرفع الـ max)
>
> **البديل المرفوض:** الاكتفاء بالمتوسط الحسابي — لكن المتوسط لا يُكافئ وجود دراسة Systematic Review واحدة ذات قيمة عالية.
>
> **تطوير مؤجل:** إضافة عامل الوزن الزمني (المقالات الحديثة تحصل على تقييم أعلى).

---

## دالة `saveToCSV(data, filename, outputDir)`

تحفظ ملفين منفصلين لكل مرض:
- `{disease}_main.csv` — ملخص المنتج والإحصاءات
- `{disease}_articles.csv` — تفاصيل كل مقال على حدة

**لماذا ملفان؟**
> الدمج في ملف واحد يعني تكرار بيانات المنتج في كل صف مقال. الفصل يقلل حجم الملف ويجعل القراءة أوضح.

---

---

# المرحلة الثانية | STAGE 2
# `getContent.js` — جلب وتحليل النصوص من NCBI

---

## ما دور هذا الملف؟

هو طبقة الوصول إلى مصادر البيانات الخارجية. يجلب النص الكامل أو الملخص لكل مقال علمي، ويحوّله إلى نص نظيف يمكن تمريره للذكاء الاصطناعي.

---

## دالة `summarizeText(pubmedUrl)` — المسار الفردي

**الخطوات:**
1. يستخرج PMID من رابط PubMed
2. يحاول تحويل PMID → PMCID عبر `extractPMCID()`
3. إذا نجح: يجلب النص الكامل XML من PMC عبر OAI-PMH API
4. إذا فشل: يتراجع إلى جلب الملخص فقط من PubMed

**لماذا نفضّل PMC على PubMed Abstract؟**
> النص الكامل (Full Text) يحتوي على قسم المواد والأساليب ونتائج تفصيلية قد لا تظهر في الملخص. الـ AI يستطيع استخراج معلومات أغنى بكثير. لكن ليس كل مقال مفتوح المصدر (Open Access) على PMC، لذلك الـ fallback ضروري.

---

## دالة `preFetchBatchArticles(articlesBatch)` — المسار الجماعي

هذه هي الدالة الأساسية في الـ pipeline الحقيقي. بدلاً من جلب كل مقال على حدة:

1. تجمع كل الـ PMIDs في batch واحد
2. تحول الكل دفعة واحدة إلى PMCIDs عبر `bulkExtractPMCID()`
3. المقالات الموجودة في PMC → تجلب نصوصها الكاملة (10 بالتوازي)
4. المقالات غير الموجودة → تجلب ملخصاتها بطلب واحد جماعي عبر `bulkFetchAbstracts()`

**لماذا هذا النهج الجماعي؟**
> تصور أن لديك 100 مقال. الطريقة الفردية = 100 طلب HTTP. الطريقة الجماعية = ~3-5 طلبات فقط. هذا يقلل:
> - احتمال الـ rate-limiting (429)
> - زمن المعالجة من دقائق إلى ثوانٍ
> - عدد الاتصالات المفتوحة على الـ network
>
> **البديل المرفوض:** Queuing system كامل. تم رفضه لأن الـ batch approach يحقق نفس الهدف بتعقيد أقل بكثير.

---

## دالة `buildPromptFromContent(content, savePath, needsRateExtraction)`

تبني الـ prompt الذي يُرسَل للـ AI. أهم قراراتها:

```javascript
const MAX_BODY_LENGTH = 15000;
```

**لماذا 15,000 حرف كحد للـ body؟**
> Groq/Mistral لهم حد أقصى للـ tokens (حوالي 8000-32000 حسب النموذج). المقال العلمي قد يحتوي على 100,000 حرف. القطع عند 15,000 حرف يحفظ أهم الأقسام (Introduction + Methods + Results) ويبقى ضمن حد الـ tokens.
>
> **تطوير مؤجل:** استخدام نظام تلخيص تدريجي (chunking) بدلاً من القطع المبسّط — لكن هذا يضاعف تكلفة API calls.

---

## نظام الـ Retry في جلب البيانات

```javascript
let retries = 5; // or 3
// ...
const jitter = Math.floor(Math.random() * 2000);
await new Promise(r => setTimeout(r, 2000 + jitter));
```

**لماذا Jitter (عشوائية في الانتظار)?**
> إذا فشلت 100 طلب في نفس اللحظة وانتظرت كلها نفس الوقت تماماً ثم أعادت المحاولة معاً — ستسبب موجة ضغط جديدة على السيرفر. الجيتر يوزع المحاولات عشوائياً ليمنع "Thunder Herd Problem".

---

---

# المرحلة الثالثة | STAGE 3
# `Ai.js` — تكامل الذكاء الاصطناعي (Mistral API)

---

## ما دور هذا الملف؟

هو **طبقة الـ AI**. يستقبل نص المقال كـ prompt ويعيد JSON منظم يحتوي على المنتجات المستخرجة، الأمراض المرتبطة، الأسباب الجذرية، ومقاييس المختبر.

---

## نظام المفاتيح المتعددة (Multi-Key Rotation)

```javascript
const apiKey1 = process.env.MISTRAL_API_KEY;
const apiKey2 = process.env.MISTRAL_API_KEY_2;
const apiKey3 = process.env.MISTRAL_API_KEY_3;
const clients = apiKeys.map(key => new Mistral({ apiKey: key }));
```

**لماذا 3 مفاتيح API؟**
> Mistral لديه حد معدّل (Rate Limit) لكل مفتاح. عند معالجة 100 مقال بالتوازي، مفتاح واحد يُحجب بسرعة. امتلاك 3 مفاتيح يثلث الـ requests الفعلية لكل مفتاح.
>
> **البديل المرفوض:** استخدام Groq API فقط. Groq أسرع لكنه أكثر تقييداً في الـ TPM (Tokens Per Minute). Mistral أكثر ثباتاً للمعالجة الطويلة.

---

## نظام التناوب بين النماذج (Round-Robin Model Rotation)

```javascript
function getRoundRobinModelOrder() {
    const startIndex = currentModelIndex % DEFAULT_MODELS.length;
    currentModelIndex++;
    // ...
}
```

**لماذا التناوب؟**
> كل نموذج له bucket مستقل للـ Rate Limit. التناوب يوزع الطلبات على نماذج متعددة، مما يقلل احتمال وصول أي نموذج لحده الأقصى.

---

## نظام الـ 30 محاولة (30 Retries)

```javascript
while (attempt < 30 && availableModels.length > 0) {
    // ...
    const baseWait = Math.min(2000 * attempt, 10000);
    // الانتظار يزيد: 2s, 4s, 6s... حتى 10s كأقصى حد
}
```

**لماذا 30 محاولة؟**
> معظم حالات الـ Rate Limit (429) تنتهي خلال 60 ثانية. مع انتظار أقصاه 10 ثوانٍ، 30 محاولة تغطي فترة ~5 دقائق كاملة — وهو ما يكفي للنجاة من أسوأ سيناريوهات الحجب.
>
> **ملاحظة:** هذا الرقم مُصمَّم خصيصاً للنجاة من حجب دقيقة كاملة دون إسقاط أي طلب.

---

## إدارة الأخطاء الدائمة

```javascript
if (msg.includes('maximum context length') || status === 404 || status === 400) {
    permanentError = true;
    break;
}
```

**لماذا إزالة النموذج نهائياً عند 400/404؟**
> الخطأ 400 يعني "طلبك خاطئ" أو "النموذج لا يدعم هذا" — إعادة المحاولة على نفس النموذج ستعطي نفس النتيجة. إزالته من القائمة تمنع الهدر، وتنتقل مباشرة للنموذج التالي.

---

---

# المرحلة الرابعة | STAGE 4
# `getURL.js` — المعالجة المركزية وحفظ البيانات

---

## ما دور هذا الملف؟

هو **القلب النابض** للـ pipeline وله **وظيفتان مختلفتان** حسب طريقة التشغيل:

### عند استدعائه من `process-all-diseases.cjs` (المسار الأول)
> يستقبل `resultsData` جاهزاً — مجموعات منتجات/أمراض مع مقالاتها. الـ AI يستخرج التفاصيل الداخلية (root_causes, labs) فقط، والمنتج والمرض معروفان مسبقاً من الـ search query.

### عند تشغيله مباشرةً — `node getURL.js` (المسار الثاني)
> يقرأ **`new Script data.xlsx`** — ملف Excel يحتوي مقالات علمية جاهزة. هنا **لا يوجد `roots-data.json` ولا `diseases_msh-2.json`**. الـ AI هو من يستخرج ديناميكياً:
> - **اسم المنتج** (`root_name`) من نص المقال نفسه
> - **اسم المرض** (`disease_name`) من نص المقال نفسه
>
> ثم يُطابق ما استخرجه الـ AI مع الـ mappings المحلية (Full-Roots.json, disease_mappings.json) بالـ fuzzy matching.

**في كلا الحالتين**: يُدير معالجتها بالـ AI، يُنظّم النتائج، يربطها بالمعرفات الصحيحة، ويحفظها في قاعدة البيانات.

---

## نظام التسجيل (Logging System)

```javascript
const logFile = fs.createWriteStream('process_logs.txt', { flags: 'a' });
console.log = function () {
    logFile.write(`[${new Date().toISOString()}] INFO: ` + msg + '\n');
    originalLog.apply(console, arguments);
};
```

**لماذا override لـ console.log؟**
> بدلاً من إضافة `fs.writeFileSync(...)` في كل مكان في الكود، يتم اعتراض console.log مركزياً. كل ما يُطبع في الـ terminal يُحفظ تلقائياً في الملف مع timestamp.
>
> **ملاحظة:** يستخدم `flags: 'a'` (append) لا (overwrite) لأن المشروع يُستأنف من حيث توقف — الـ logs التاريخية ضرورية للتشخيص.

---

## الـ Global State وتحميل ملفات الـ Mapping

```javascript
if (!global.scopedRootCauseMaps) {
    global.scopedRootCauseMaps = {};
    // يُحمَّل مرة واحدة فقط في أول استدعاء
}
```

**لماذا استخدام `global` بدلاً من متغيرات محلية؟**
> `getURL()` تُستدعى مئات المرات (مرة لكل batch). لو حمّلنا ملفات الـ mapping في كل استدعاء:
> - سنقرأ نفس الملف الكبير (مئات الـ KB) آلاف المرات
> - سنضيع ما تعلمه النظام في الـ batch السابق
>
> الـ `global` يُبقي المعرفة المتراكمة حية طوال دورة حياة البرنامج.
>
> **البديل المرفوض:** Singleton pattern أو Dependency Injection. تم رفضهما لزيادة التعقيد مقابل نفس النتيجة في سياق script بسيط.

---

## الملفات المُحمَّلة في الـ Global State

| الملف | دوره |
|-------|-------|
| `root_cause_mappings.json` | قاموس الأسباب الجذرية — يربط اسم السبب بمعرّف رقمي ثابت عبر كل المقالات |
| `item_mappings.json` | قاموس المنتجات المستخرجة بالـ AI — كل منتج جديد يحصل على ID فريد |
| `ai_to_full_roots_mappings.json` | جدول تحويل أسماء AI إلى معرفات Full-Roots.json الرسمية |
| `Full-Roots.json` | قاموس المنتجات الرئيسي (master list) |
| `disease_mappings.json` | قاموس الأمراض — يربط أسماء الأمراض المستخرجة بـ IDs موحدة |
| `icd11_disease_mappings.json` | جدول ربط كل مرض بكوده الرسمي في ICD-11 |

---

## دالتا `calculateSimilarity()` و `calculateWordSubset()`

```javascript
// Levenshtein Distance based
function calculateSimilarity(s1, s2) { ... }

// Word-level overlap
function calculateWordSubset(s1, s2) { ... }
```

**لماذا خوارزميتان للمشابهة؟**
> - `calculateSimilarity` (Levenshtein): ممتاز لأخطاء الإملاء والاختصارات — "diab" و "diabetes" لها مشابهة عالية
> - `calculateWordSubset`: ممتاز للجمل — "type 2 diabetes" و "diabetes type 2" لها تشابه 100% هنا
>
> الاثنان معاً يمسكان حالات تفوت كلٌّ منهما بمفرده.

---

## دالة `extractJSONArray(text)` — إصلاح JSON المكسور

```javascript
function extractJSONArray(text) {
    // 1. كشف JSON داخل markdown blocks
    // 2. إصلاح الأحرف الخاصة داخل الـ strings
    // 3. إغلاق {} و [] المفتوحة
    // 4. إزالة الـ trailing commas
    // 5. parse بعد الإصلاح
}
```

**لماذا هذا الإصلاح المعقد؟**
> الـ AI أحياناً:
> - يُضمّن الـ JSON داخل code blocks (` ```json `) بدلاً من إرساله مباشرةً
> - يكتب أحرف خاصة (newlines، tabs) داخل string values دون escape
> - يُقطع الـ response في منتصف JSON إذا وصل لحد الـ tokens
>
> هذه الدالة تُعالج كل هذه الحالات. بدونها، كل مقال بفيه AI response "مكسور" قليلاً سيُضيَّع.
>
> **ملاحظة:** يُحفظ كل JSON فشل تماماً في `failed_json_logs.txt` للمراجعة اليدوية لاحقاً.

---

## نظام التزامن (Concurrency)

```javascript
const CONCURRENCY_LIMIT = 100;
for (let i = 0; i < allTasks.length; i += CONCURRENCY_LIMIT) {
    const batchPromises = batchTasks.map(async (task) => { ... });
    const batchResults = await Promise.all(batchPromises);
}
```

**لماذا 100 طلب بالتوازي؟**
> هذا الرقم وُجد تجريبياً — يحقق توازناً بين السرعة القصوى وعدم استنفاد موارد الـ API. رقم أعلى يزيد احتمال الـ rate limit. رقم أقل يبطئ المعالجة بلا مبرر.
>
> **تطوير مؤجل:** تحويل هذا الرقم إلى متغير بيئي قابل للضبط.

---

## مكافحة الأعطال المتتالية (Consecutive AI Failure Guard)

```javascript
global.consecutiveAIFailures++;
if (global.consecutiveAIFailures >= 10) {
    process.exit(1); // إيقاف كامل للبرنامج
}
```

**لماذا الإيقاف الكامل عند 10 فشل متتالي؟**
> إذا فشلت 10 طلبات متتالية حتى بعد 30 retry لكل منها — هذا لا يعني "المقال سيء"، بل يعني أن الـ API نفسه متعطل أو محجوب كلياً. الاستمرار في هذه الحالة يُنتج آلاف السجلات الفارغة في قاعدة البيانات — وهو أسوأ من الإيقاف والإعادة لاحقاً. البرنامج يحفظ progress قبل الإيقاف.

---

## نظام تطبيع أسماء الأسباب الجذرية (Root Cause Normalization)

```javascript
// إزالة السياق المرتبط بالمرض من اسم السبب
const stopPhrases = [
    `in ${diseaseLower}`,
    `in ${diseaseLower} patients`,
    "in the pathogenesis of",
    "associated with",
    // ...
];

const splitKeywords = [" in ", " among ", " during ", " for "];
```

**لماذا هذا التطبيع؟**
> الـ AI قد يُخرج "oxidative stress in type 2 diabetes" أو "oxidative stress" — وكلاهما يعني نفس الشيء. بدون التطبيع، ستُنشأ عمود مختلف في قاعدة البيانات لكل صيغة. مع التطبيع، كلاهما يُربط بنفس المعرّف "oxidative stress".
>
> **ملاحظة:** إذا قُص اسم السبب وأصبح أقل من 3 أحرف بعد التطبيع، يُتراجع إلى الاسم الأصلي (fallback).

---

## نظام الـ Scoped Root Cause Maps

```javascript
global.scopedRootCauseMaps[diseaseName] = { map, nextIndex };
```

**لماذا تصنيف الأسباب الجذرية حسب المرض؟**
> "الإجهاد التأكسدي" (oxidative stress) موجود في السكري وأمراض القلب والكبد. لو جمعنا الكل في قاموس واحد، نضيع التمييز. كل مرض له قاموسه المستقل — عمود رقم 5 في مرض السكري يعني شيئاً مختلفاً عن عمود رقم 5 في أمراض القلب.

---

## حقل `dynamic_root_causes` في قاعدة البيانات

```javascript
dbResult.dynamic_root_causes = {
    "1": { name: "oxidative stress", benefit_exactly: "...", benefit_descriptive: "..." },
    "2": { name: "inflammation", benefit_exactly: "...", benefit_descriptive: "..." }
};
```

**لماذا JSON column بدلاً من أعمدة منفصلة؟**
> النهج القديم كان `root_cause_1_name`, `root_cause_1_benefit`, ..., `root_cause_10_name`. هذا يعني 10 أسباب كحد أقصى ثابت. لكن بعض المقالات تحتوي على 20-30 سبباً! الـ JSON column يستوعب عدداً غير محدود.
>
> **البديل المرفوض:** جدول منفصل `root_causes` بعلاقة foreign key. الـ join operations ستبطئ الاستعلامات بشكل كبير عند 100,000+ سجل.
>
> **تطوير مؤجل:** إضافة فهرس GIN على حقل الـ JSON في PostgreSQL لتسريع البحث داخله.

---

## حقل `disease_rate_combination`

```javascript
if (dbResult.diseases_rate_all_null === 0) {
    dbResult.disease_rate_combination = 0;
} else {
    dbResult.disease_rate_combination = dbResult.disease_rates;
}
```

**ما معنى هذا الحقل؟**
> إذا استخرج الـ AI بيانات من المقال (root causes أو labs) لكن بدون أي فائدة مذكورة للمنتج — الدراسة لا تُثبت فائدة، إذاً درجتها = 0.
> إذا يوجد فوائد — تُستخدم درجة نوع الدراسة المناسبة.
>
> هذا يمنع إعطاء درجات عالية لمقالات تذكر المنتج لكن تقول "لم يؤثر".

---

## المعالجة اللاحقة (Post-Processing Steps)

### Step 1.5: إزالة التكرارات (Deduplication)

```javascript
const key = `${record.productId}_${articleKey}`;
if (!articleProductMap.has(key)) { ... }
```

**لماذا؟**
> نفس المقال قد يُعالَج مرتين إذا ظهر في نتائج منتجين مختلفين أو في batch مختلفة. مفتاح التكرار هو (productId + PMID). إذا كان المقال ذاته مذكوراً في نتيجتين، نحتفظ بالأقدم ونحذف الأحدث.

### Step 2: إعادة حساب DW والإحصاءات

بعد الحفظ مباشرةً، يُعاد حساب:
- `articles_count` لكل منتج
- `calculated_dw` بناءً على `disease_rate_combination` الجديدة
- `category` (ready/not_ready) بناءً على العدد الفعلي
- `article_number` (ترتيب المقالات تنازلياً حسب الدرجة)

**لماذا إعادة الحساب بعد الحفظ؟**
> - **في المسار الأول:** الحسابات الأولى من `process-all-diseases.cjs` كانت تقديرية (قبل تحليل الـ AI). الـ AI قد يُخرج سجلات إضافية (مقال واحد قد يحتوي منتجين → سجلَين) فتتغير الأرقام.
> - **في المسار الثاني:** المقالات تأتي من Excel بـ rate مبدئي من NCBI، لكن الـ AI قد يُخرج `disease_rates` مختلفة → DW يتغير.

### Step 3: الفرز الفيزيائي في قاعدة البيانات

```javascript
// احذف كل السجلات وأعد إدراجها مرتبة
await ResearchResult.destroy({ where: { diseaseId } });
await ResearchResult.bulkCreate(recordsToInsert);
```

**لماذا "حذف وإعادة إدراج" بدلاً من UPDATE فقط؟**
> PostgreSQL لا يضمن أن `ORDER BY` في SELECT سيُرتّب الـ IDs التسلسلية. الطريقة الوحيدة لضمان أن الـ ID الأصغر = المقال الأعلى درجة هي إعادة الإدراج بترتيب جديد. هذا يُبسّط الاستعلامات اللاحقة من التطبيق.
>
> **تحذير:** هذه العملية تُعيد توليد الـ IDs — أي FK في جداول أخرى يجب مراعاته.

---

## نظام حفظ الـ Progress

```javascript
const PROGRESS_FILE = 'progress.json';
progress.currentIndex = nextIndex;
fs.writeFileSync(tempProgress, JSON.stringify(progress));
fs.renameSync(tempProgress, PROGRESS_FILE); // Atomic write
```

**لماذا الكتابة الذرية (Atomic Write) عبر tmp file؟**
> إذا كتبنا مباشرةً على `progress.json` وانقطعت الكهرباء أثناء الكتابة — الملف سيكون تالفاً (مكتوب جزئياً). باستخدام tmp ثم rename: الـ rename عملية ذرية في OS، إما أن تنجح كاملةً أو لا تحدث أصلاً — لا يوجد حالة وسطى.

---

---

# المرحلة الخامسة | STAGE 5
# `models/all.js` — نماذج قاعدة البيانات

---

## ما دور هذا الملف؟

يُعرّف تركيبة قاعدة البيانات PostgreSQL باستخدام Sequelize ORM.

---

## الجداول الثلاثة

### جدول `items`
```sql
id SERIAL PRIMARY KEY
name TEXT NOT NULL
arabic_name TEXT NOT NULL
```
**دوره:** قائمة المنتجات/الأعشاب الرئيسية مع أسمائها العربية.

### جدول `diseases`
```sql
id SERIAL PRIMARY KEY
name TEXT NOT NULL
code TEXT NOT NULL       -- كود ICD-11
foundation_url TEXT      -- رابط ICD-11 Foundation
icd_title TEXT           -- العنوان الرسمي في ICD-11
```
**دوره:** قائمة الأمراض الرسمية مع بيانات ICD-11.

### جدول `research_results`
الجدول الرئيسي والأهم. يحتوي على:

| الحقل | الوصف |
|-------|--------|
| `productId` | معرّف المنتج من Full-Roots.json |
| `root_name` | اسم المنتج كما استخرجه الـ AI |
| `scientific_name` | الاسم العلمي |
| `diseaseId` | معرّف المرض |
| `disease` | اسم المرض كما استخرجه الـ AI |
| `rate` | درجة نوع الدراسة من NCBI |
| `disease_rates` | درجة نوع الدراسة من الـ AI |
| `diseases_rate_all_null` | 0 إذا لم يُستخرج أي فائدة |
| `disease_rate_combination` | القيمة النهائية المُستخدمة في DW |
| `calculated_dw` | درجة الأهمية النهائية للمنتج/المرض |
| `dynamic_root_causes` | JSON بالأسباب الجذرية |
| `labs` | JSON بمقاييس المختبر |
| `code` | كود ICD-11 للمرض |
| `foundation_url` | رابط ICD-11 |

---

## خيار `{ timestamps: true }` على research_results

**لماذا؟**
> يُضيف `createdAt` و `updatedAt` تلقائياً. يُستخدم `createdAt` في عملية إزالة التكرارات (نحتفظ بالأقدم).

---

## `logging: false` في إعدادات Sequelize

**لماذا؟**
> عند معالجة 100,000+ سجل، الـ SQL logs تملأ الـ terminal وتبطئ الأداء. يُفضّل إيقافها ويُترك الـ logging لنظام `process_logs.txt` الخاص بنا.

---

---

# المرحلة السادسة - أ | STAGE 6a
# `map_icd11_diseases.js` — ربط الأمراض بنظام ICD-11

---

## ما دور هذا الملف؟

يأخذ أسماء الأمراض المستخرجة (من قاعدة البيانات أو disease_mappings.json) ويجد أقرب تطابق لها في تصنيف ICD-11 الرسمي من منظمة الصحة العالمية.

**المصدر:** ملف `SimpleTabulation-ICD-11-MMS-en.xlsx` — يحتوي على آلاف التصنيفات الطبية الرسمية.

---

## نظام المطابقة الهجينة (Hybrid Matching)

```javascript
// 1. Dice Character Coefficient (وزن 35%)
const dice = computeDiceCoefficient(syn, icdTitle);

// 2. Jaccard Word Overlap (وزن 45%)
const jaccard = matchCount / (sWords.length + iWords.length - matchCount);

// 3. Overlap Ratio (وزن 20%)
const overlapRatio = matchCount / sWords.length;

let currentScore = (dice * 0.35) + (jaccard * 0.45) + (overlapRatio * 0.20);
```

**لماذا خوارزميات متعددة بدلاً من واحدة؟**
> كل خوارزمية تمسك نوعاً مختلفاً من التشابه:
> - Dice: يُعطي نتيجة جيدة حتى مع اختلاف ترتيب الكلمات
> - Jaccard: يعاقب الإضافات غير الضرورية (مثل "unspecified" في نهاية ICD titles)
> - Overlap Ratio: يكافئ وجود أكبر قدر من كلمات البحث في العنوان
>
> **البديل المرفوض:** استخدام WHO ICD-11 API مباشرةً. تم رفضه لأن:
> - يتطلب اتصال إنترنت مستمر
> - الـ Token يصلح ساعة فقط
> - بطيء (طلب منفصل لكل مرض)

---

## قاموس المرادفات الطبية (MEDICAL_SYNONYMS)

```javascript
const MEDICAL_SYNONYMS = {
    'type 2 diabetes': ['t2dm', 'non-insulin-dependent diabetes', ...],
    'hypertension': ['high blood pressure', 'hypertensive disease'],
    // ...
};
```

**لماذا؟**
> ICD-11 قد يُسمّي المرض بطريقة مختلفة عما يستخرجه الـ AI. "T2DM" لن يُطابق "Type 2 Diabetes Mellitus" بدون قاموس مرادفات. هذا القاموس تم بناؤه يدوياً للأمراض الأكثر شيوعاً في المشروع.
>
> **تطوير مؤجل:** توسيع القاموس أو استخدام مرادفات MeSH الرسمية تلقائياً.

---

## حد المطابقة (MATCH_THRESHOLD = 0.55)

**لماذا 55%؟**
> أقل من 55% يعني أن أسماء الأمراض غير الطبية (مثل "unknown") ستُطابق ICD titles خاطئة. أعلى من 55% يفقدنا اكتشاف الأمراض ذات الأسماء المختلفة قليلاً.

---

---

# المرحلة السادسة - ب | STAGE 6b
# `map_ai_roots_to_full.js` — ربط المنتجات بـ Full-Roots.json

---

## ما دور هذا الملف؟

يأخذ الأسماء التي استخرجها الـ AI للمنتجات (من `item_mappings.json`) ويجد مطابقتها في القاموس الرسمي `Full-Roots.json`.

---

## الحقول الثلاثة للمطابقة

```javascript
const scoreRoot = getMatchScore(extractedName, candidate.Root);
const scoreNameEn = getMatchScore(extractedName, candidate.name_en);
const scoreMesh = getMatchScore(extractedName, candidate['Best MeSH match']);
```

**لماذا نُطابق مع 3 حقول؟**
> Full-Roots.json يحتوي على نفس المنتج بأسماء متعددة:
> - `Root`: الاسم الجذري الشائع (مثل "Blueberry")
> - `name_en`: الاسم الإنجليزي المعتمد
> - `Best MeSH match`: الاسم الرسمي في قاعدة MeSH
>
> الـ AI قد يستخدم أي من هذه الأسماء. التطابق مع الأعلى من الثلاثة يضمن عدم فقدان أي مطابقة صحيحة.

---

## الصيغة المركبة للدرجة

```javascript
let composite = (levSim * 0.40) + (diceSim * 0.30) + (jaccardScore * 0.20) + (subsetScore * 0.10);

if (isSub) {
    composite = Math.max(composite, 0.78) + 0.12;
}
```

**لماذا وزن Levenshtein أعلى هنا (40%) مقارنة بـ map_icd11 (35%)?**
> أسماء المنتجات أقصر وأقل تعقيداً من أسماء الأمراض. Levenshtein يعمل أفضل مع الكلمات القصيرة. Dice يعمل أفضل مع الجمل الطويلة.

---

---

# المرحلة السادسة - ج | STAGE 6c
# `migrate_research_results_roots_id.js` — تحديث معرفات المنتجات بالجملة

---

## ما دور هذا الملف؟

هو سكريبت migration يُشغَّل مرة واحدة لتحديث عمود `productId` في جميع سجلات `research_results` بناءً على الـ mappings.

**متى يُستخدم؟**
> عندما تُضاف أو تُحدَّث ملفات mapping بعد إنتاج البيانات الأولية.

---

## التجميع حسب الـ Target ID

```javascript
const targetGroups = new Map(); // targetId -> Array of rootNames
// ثم تحديث كل مجموعة بطلب SQL واحد
```

**لماذا؟**
> بدلاً من طلب UPDATE لكل root name على حدة (قد تكون آلاف الطلبات)، نُجمّع كل الأسماء التي تتحول لنفس الـ ID في UPDATE واحد باستخدام `WHERE LOWER(root_name) IN (...)`. هذا يقلل طلبات الـ DB من آلاف إلى عشرات.

---

---

# المرحلة السادسة - د | STAGE 6d
# `migrate_research_results_icd.js` — تعبئة بيانات ICD-11 في السجلات

---

## ما دور هذا الملف؟

يُعبّئ حقول `code`, `foundation_url`, `icd_title` في جدول `research_results` من ملف `icd11_disease_mappings.json`.

**شرط التحديث:**
```sql
WHERE ... AND (code IS NULL OR foundation_url IS NULL OR icd_title IS NULL)
```

**لماذا هذا الشرط؟**
> السكريبت آمن للتشغيل مرات متعددة — لن يُعيد الكتابة على بيانات ICD موجودة مسبقاً. يُحدّث فقط السجلات الناقصة.

---

---

# المرحلة السابعة | STAGE 7
# سكريبتات إعادة الحساب

---

## `recalculate_csv_dw.js` — إعادة حساب DW في ملفات CSV

---

## ما دور هذا الملف؟

عندما يُصدَّر البيانات من قاعدة البيانات كـ CSV (مثلاً لمشاركتها)، قد تتغير قيم `disease_rate_combination` بعد التصحيحات. هذا السكريبت يُعيد حساب `calculated_dw`, `articles_count`, `article_number`, و `category` في الـ CSV مباشرةً دون الحاجة للـ database.

**كيفية الاستخدام:**
```bash
node recalculate_csv_dw.js input.csv [output.csv]
```

---

## محلل CSV المخصص (Custom CSV Parser)

```javascript
function parseCSVLine(line) {
    // يتعامل مع الـ quotes بشكل صحيح
    // مثال: "hello, world" لا يتم تقسيمه عند الفاصلة
}
```

**لماذا محلل مخصص بدلاً من مكتبة؟**
> ملفات CSV الكبيرة (68MB+) تحتوي على JSON داخل cells (حقل `dynamic_root_causes`). معظم مكتبات CSV تفشل مع JSON المتداخل أو تستهلك ذاكرة ضخمة. المحلل المخصص يعالج الملف **سطراً بسطر** (streaming) دون تحميل الكل في الذاكرة.
>
> **ملاحظة:** يستخدم نظام buffer لمعالجة الـ newlines داخل الـ quoted strings (JSON).

---

## `recalculate_xlsx_dw.js` — إعادة حساب DW في ملفات Excel

نفس منطق `recalculate_csv_dw.js` لكن لملفات `.xlsx` و `.xls` باستخدام مكتبة `xlsx`.

**لماذا ملفان منفصلان؟**
> CSV يُعالَج بـ streaming (سطر بسطر) لأن الملف قد يكون 68MB+. Excel يُحمَّل بالكامل في الذاكرة (xlsx library) — نهج مختلف تماماً يصعب دمجه بشكل نظيف.

---

---

# `add_rate_combination.js` — حساب `disease_rate_combination` في CSV قديمة

---

## ما دور هذا الملف؟

سكريبت نُفّذ **مرة واحدة** على ملف CSV قديم أُنتج قبل إضافة حقل `disease_rate_combination` للـ pipeline. يُضيف هذا الحقل إلى الـ CSV.

**المنطق:**
```
إذا diseases_rate_all_null == 0  →  combination = 0
إذا disease_rates > 0            →  combination = disease_rates
غير ذلك                         →  combination = ai_calculated_rate
```

---

## `multiply_rate_combination.js` — مضاعفة الدرجة بعدد الفوائد

---

## ما دور هذا الملف؟

يُضيف عموداً جديداً `disease_rate_combination_multiplied` = درجة المقال × عدد الفوائد المستخرجة (root causes + labs لهم benefits).

**الفكرة:**
> مقال بدرجة 4 ويذكر 5 فوائد = أهم من مقال بدرجة 4 يذكر فائدة واحدة.
> `4 × 5 = 20` مقابل `4 × 1 = 4`

**ملاحظة:** هذا سكريبت تجريبي خُصص لتحليل معين. في الـ pipeline الرئيسي، المضاعفة تحدث داخل حسابات DW المجمّعة.

---

---

# الملفات المساعدة الأخرى

---

## `Ai_ollama.js` — نسخة Ollama من الـ AI Module

```javascript
// يستخدم Ollama (محلي) بدلاً من Mistral (سحابي)
```

**لماذا نسخة Ollama؟**
> للاختبار المحلي بدون استهلاك API credits. Ollama يُشغّل نماذج مفتوحة المصدر على الجهاز مباشرةً. لكنه أبطأ بكثير ويتطلب GPU قوي للنتائج الجيدة.
>
> **الحالة الحالية:** غير مُفعَّل في الـ pipeline الرئيسي.

---

## `get_icd_synonyms.js` — جلب مرادفات ICD-11 من API

يجلب مرادفات إضافية من WHO ICD-11 API الرسمي. المرادفات تُستخدم لتحسين دقة المطابقة في `map_icd11_diseases.js`.

**ملاحظة:** يتطلب token صالح (ساعة فقط) من `ICD_CLIENT_ID` و `ICD_CLIENT_SECRET` في `.env`.

---

## `retry_failed_ai.js` — إعادة معالجة المقالات الفاشلة

يبحث في قاعدة البيانات عن سجلات بـ `processing_status = 'failed'` ويُعيد معالجتها بالذكاء الاصطناعي.

**لماذا سكريبت منفصل؟**
> في المعالجة الأولى مع آلاف المقالات، بعض المقالات تفشل بسبب rate limits مؤقتة. الـ retry الجماعي يجمع كل الفاشلين ويعيد معالجتهم مرة واحدة بعد انتهاء الـ pipeline الرئيسي.

---

## `update_prompt.js` — تحديث الـ AI Prompt في السجلات القديمة

سكريبت utility يُحدّث الـ prompt المستخدم لمقالات سبق معالجتها بـ prompt قديم.

---

## `medical_synonyms.js` — توليد مرادفات طبية

يُنتج قائمة مرادفات للمصطلحات الطبية. مخرجاته تُغذّي ملف `icd_medical_synonyms.json`.

---

---

# إعداد البيئة | Environment Setup

---

## ملف `.env`

```env
MISTRAL_API_KEY=...         # مفتاح Mistral API الأول
MISTRAL_API_KEY_2=...       # مفتاح Mistral API الثاني
MISTRAL_API_KEY_3=...       # مفتاح Mistral API الثالث
GROQ_API_KEY=...            # مفتاح Groq API (احتياطي)
ICD_CLIENT_ID=...           # معرّف عميل WHO ICD-11 API
ICD_CLIENT_SECRET=...       # سر عميل WHO ICD-11 API
DB_PASSWORD=...             # كلمة مرور PostgreSQL
```

> **تحذير أمني:** لا تُشارك ملف `.env` أبداً. يجب إضافته لـ `.gitignore`.
> المفاتيح الموجودة في الملف تُعتبر مكشوفة إذا رُفع المشروع على GitHub — يجب تجديدها.

---

## قاعدة البيانات PostgreSQL

```sql
CREATE DATABASE medical_research;
CREATE USER med_research_user WITH PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE medical_research TO med_research_user;
```

**لماذا PostgreSQL تحديداً؟**
> - دعم حقول JSON الأصيل (JSONB) مع فهرسة متقدمة
> - دعم `NULLIF(column, '')::INTEGER` في ORDER BY
> - استقرار في العمليات الضخمة (bulk inserts, complex queries)
> - Sequelize ORM له دعم ممتاز لها
>
> **البدائل المرفوضة:**
> - MySQL: لا يدعم JSON بنفس المستوى، وأداء أقل في الاستعلامات المعقدة
> - SQLite: لا يصلح للـ concurrent writes في multi-batch processing
> - MongoDB: بيانات الـ research results لها schema محددة — NoSQL يُضيف تعقيداً بلا فائدة

---

---

# ترتيب تشغيل المشروع | Execution Order

---

## السيناريو الأول: تشغيل من الصفر

```bash
# 1. تثبيت المتطلبات
npm install

# 2. إعداد قاعدة البيانات (SQL في README)

# 3. تشغيل المعالجة الرئيسية
node process-all-diseases.cjs

# 4. ربط الأمراض بـ ICD-11
node map_icd11_diseases.js

# 5. ربط المنتجات بـ Full-Roots.json
node map_ai_roots_to_full.js

# 6. تحديث معرفات المنتجات في قاعدة البيانات
node migrate_research_results_roots_id.js

# 7. تحديث بيانات ICD في قاعدة البيانات
node migrate_research_results_icd.js
```

## السيناريو الثاني: معالجة ملف Excel جاهز

```bash
# ملف Excel موضوع في نفس المجلد
node getURL.js
```

## إعادة حساب DW لملفات CSV/XLSX

```bash
node recalculate_csv_dw.js input.csv output.csv
node recalculate_xlsx_dw.js input.xlsx output.xlsx
```

---

---

# الملفات الدائمة وأدوارها | Persistent Files Reference

---

| الملف | الدور | ينتج عن |
|--------|--------|----------|
| `progress.json` | يتتبع آخر batch مُعالَج (للاستئناف) | `getURL.js` |
| `root_cause_mappings.json` | قاموس الأسباب الجذرية بـ IDs ثابتة | `getURL.js` |
| `item_mappings.json` | قاموس المنتجات المستخرجة بالـ AI | `getURL.js` |
| `disease_mappings.json` | قاموس الأمراض بـ IDs موحدة | `getURL.js` |
| `ai_to_full_roots_mappings.json` | ربط AI names بـ Full-Roots IDs | `map_ai_roots_to_full.js` |
| `icd11_disease_mappings.json` | ربط أسماء الأمراض بـ ICD-11 | `map_icd11_diseases.js` |
| `Full-Roots.json` | القاموس الرئيسي للمنتجات (master) | يدوي/خارجي |
| `roots-data.json` | قائمة المنتجات مع MeSH names | يدوي/خارجي |
| `diseases_msh-2.json` | قائمة الأمراض مع MeSH names | يدوي/خارجي |
| `process_logs.txt` | سجل كامل لكل عمليات التشغيل | `getURL.js` |
| `failed_json_logs.txt` | JSON responses فشل تحليلها | `getURL.js` |

---

---

# ملاحظات تطوير مؤجلة | Deferred Development Notes

---

1. **تحسين الـ Chunking في buildPromptFromContent**: استبدال القطع البسيط بـ 15,000 حرف بنظام تلخيص متدرج يحافظ على أهمية كل قسم.

2. **GIN Index على حقل dynamic_root_causes**: يُسرّع البحث داخل JSON column في PostgreSQL.

3. **تحويل ARTICLES_THRESHOLD إلى متغير بيئي**: يُتيح ضبطه بدون تعديل الكود.

4. **توسيع MEDICAL_SYNONYMS**: إضافة أمراض جديدة أو استخدام MeSH synonyms API تلقائياً.

5. **عامل الوزن الزمني في DW**: مقالات 2020+ تحصل على وزن أعلى من مقالات 2010.

6. **Backoff السكريبتات كـ Service**: تحويل process-all-diseases.cjs إلى service يعمل في الخلفية مع monitoring.

7. **Database Transactions**: تغليف Post-Processing Steps في transaction واحدة لضمان Atomicity الكاملة.

8. **إضافة وحدة اختبار (Unit Tests)**: على الأقل للدوال الحيوية مثل `calculateDW`, `extractJSONArray`, `calculateSimilarity`.

9. **Soft Delete بدلاً من Hard Delete**: في عملية الفرز الفيزيائي، استخدام `is_deleted` flag بدلاً من حذف فعلي لضمان سهولة التراجع.

10. **تأمين API Keys**: نقل المفاتيح من .env إلى خدمة secrets management (HashiCorp Vault أو AWS Secrets Manager) عند الانتقال للإنتاج.

---

*آخر تحديث لهذا التوثيق: 2026-06-13*
*المشروع: Medical Research Extraction Pipeline v2 (bigScript)*
