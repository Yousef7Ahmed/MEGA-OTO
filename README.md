# Mega Ai <-> OTO / Mrsool — Integration Backend

هذا الباك إند المستقل بيعمل بالظبط الأربع خطوات المؤكدة من المخطط:

1. **Mega Ai → طلب جديد** يوصل كـ Webhook لـ `/webhooks/megaai/order`
2. **الباك إند يستقبل الطلب** ويحوّل بياناته لشكل أوتو
3. **OTO ينشئ الشحنة** عن طريق `createOrder` API
4. **Webhook** بيسجل رقم otoId والرد محليًا

وبعدين لما الشحنة تتحرك:

5. **OTO يحدّث الحالة** ويبعتها كـ Webhook لـ `/webhooks/oto/status`
6. **الباك إند يستلم التحديث** ويسجله محليًا (لحد ما نأكد API تحديث Mega Ai)

**مرسول:** لسه مش متضمن فعليًا (`src/services/mrsoolClient.js` عبارة عن هيكل فاضي فيه شرح إيه المطلوب من مرسول قبل ما نقدر نفعّله).

**تحديث Mega Ai نفسها:** مش متضمن — التوثيق اللي عندنا لـ API التحديث بتاعها (`megaa-tons-external-api-docs.md`) لسه مش مؤكد إنه حقيقي، فمكتفيين حاليًا بتسجيل كل حاجة محليًا في `src/store/orders.json` لحد ما نتأكد.

---

## 1) التجهيز

```bash
npm install
cp .env.example .env
```

افتح `.env` وحط فيه:

- `OTO_REFRESH_TOKEN` — **مفتاح جديد** بعد ما تكون ولّدته من جديد في app.tryoto.com (متستخدمش القديم اللي كان في الشات).
- `OTO_WEBHOOK_SECRET` — أي نص عشوائي طويل من عندك (يُستخدم للتحقق من إمضاء الطلبات الجايه من أوتو).
- `PUBLIC_BASE_URL` — هتحتاجه في الخطوة 3.

## 2) تشغيل السيرفر محليًا

```bash
npm start
```

هيشتغل على `http://localhost:3000`. جرب فورًا:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/oto-auth
```

- أول أمر بيتأكد إن السيرفر شغال وإن أوتو نفسها متاحة (endpoint عام مفيهوش مصادقة).
- تاني أمر بيتأكد إن الـ `OTO_REFRESH_TOKEN` بتاعك صحيح فعليًا وقادر يجيب Access Token.

لو الأمر التاني رجع `success: true`، يبقى الاتصال بأوتو شغال 100%.

## 3) تعريض السيرفر على الإنترنت (عشان Mega Ai وأوتو يقدروا يوصلوله)

وأنت لسه بتطور محليًا، استخدم أداة زي [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

هتاخد رابط زي `https://xxxx.ngrok-free.app`. حطه في `.env` كـ `PUBLIC_BASE_URL`.

## 4) تسجيل الـ Webhook بتاع أوتو

```bash
npm run register-oto-webhook
```

ده هيقول لأوتو: "ابعتلي على `PUBLIC_BASE_URL/webhooks/oto/status` لما أي حالة تتغير".

## 5) توصيل Webhook الطلب الجديد من Mega Ai

من داخل لوحة تحكم Mega Ai:
**إعدادات → إعدادات خطاف الويب → إنشاء جديد**

- الوحدة: `New Order`
- الطريقة: `POST`
- URL: `PUBLIC_BASE_URL/webhooks/megaai/order`

## 6) الاختبار الفعلي

1. اعمل طلب تجريبي حقيقي في المتجر.
2. راقب الـ Terminal بتاع السيرفر — هيطبع سطر بيبدأ بـ `[mega-webhook] RAW PAYLOAD:` وفيه شكل البيانات الحقيقي اللي بعتته Mega Ai.
3. **ده أهم خطوة فعليًا** — لأن شكل البيانات ده لسه ما شفناهوش قبل كده. لو الأسماء مختلفة عن اللي متوقعينها في `src/routes/megaWebhook.js` (دالة `mapMegaOrderToOtoOrder`)، عدّل الدالة دي عشان تطابق الشكل الحقيقي.
4. لو الماب صح، هتلاقي في اللوج `Order sent to OTO successfully` ورقم `otoId`.
5. تقدر تتابع كل الطلبات المسجلة محليًا عن طريق:
   ```bash
   curl http://localhost:3000/debug/orders
   ```

## هيكل المشروع

```
src/
  config.js                  # قراءة متغيرات البيئة
  server.js                  # نقطة التشغيل الرئيسية
  services/
    otoTokenManager.js       # refresh_token -> access_token (مع تجديد تلقائي كل ساعة)
    otoClient.js             # createOrder / registerWebhook / healthCheck
    mrsoolClient.js           # هيكل فاضي - في انتظار توثيق مرسول الرسمي
  routes/
    megaWebhook.js            # يستقبل "طلب جديد" من Mega Ai
    otoWebhook.js              # يستقبل تحديثات الحالة من أوتو
  store/
    orderStore.js              # تخزين محلي بسيط (ملف JSON)
  scripts/
    registerOtoWebhook.js       # سكريبت تسجيل الـ webhook عند أوتو
```

## اختبار API الخاص بـ Mega Ai (غير مؤكد - إحنا بنتأكد منه دلوقتي)

فيه ملف جديد `src/services/megaClient.js` مبني بالكامل على `megaa-tons-external-api-docs.md`، وهو ملف **لسه مش مؤكد إنه حقيقي**. عشان نتأكد بسرعة وبطريقة موضوعية:

1. احصل على مفتاح API حقيقي من صاحب المتجر (شكله المتوقع: `mgt_...`).
2. حطه في `.env` في `MEGA_API_KEY`.
3. نفذ:
   ```bash
   npm run test-mega-api
   ```
4. النتيجة هتقولك بوضوح:
   - **✅ لو رجع بيانات JSON بنفس شكل التوثيق** → الملف حقيقي، ونقدر نبني عليه بثقة.
   - **❌ لو رجع 404 أو صفحة HTML** → الملف غير دقيق، ومحتاجين نرجع لصاحب المنصة.

لو الاختبار نجح، الباك إند هيحاول تلقائيًا (best effort) يحدّث حالة وتتبع الطلب في Mega Ai كل مرة أوتو تبعتلنا تحديث حالة (تقدر تتابع النتيجة في اللوج بسطر `[mega-push]`). لو فشل، مش هيوقف باقي السيستم — هيسجل الخطأ بس ويكمل عادي.

## أهم حاجة ناقصة لسه

- **API تحديث Mega Ai نفسها** — لسه مش مؤكد وجوده. لحد ما يتأكد، أي تحديث حالة جاي من أوتو بيتسجل محليًا بس في `src/store/orders.json`، ومش بيوصل تلقائيًا لصفحة الطلب في Mega Ai.
- **مرسول** — محتاجين توثيق API رسمي + مفتاح حقيقي قبل ما نقدر نكتب `mrsoolClient.js` فعليًا.

---

## إشعارات واتساب لتتبّع الشحنة

المشتري والبائع بياخدوا رسالة واتساب في كل مرحلة من مراحل الشحنة.

### الإعداد — عن طريق WaFinal (مش ميتا)

الإشعارات بتتبعت دلوقتي عن طريق **WaFinal**، نفس نظام الواتساب اللي
بيشغّل بوت المبيعات على المنصّة أصلاً — رقم شغّال فعلياً، من غير حساب
Facebook Developer ولا قوالب معتمدة ولا نافذة الـ٢٤ ساعة بتاعة ميتا.

على سيرفر Mega Ai نفّذ:

```bash
php artisan whatsapp:wafinal-creds --slug=hujj
```

هيطبعلك 3 قيم، انسخهم في `.env` هنا:

```
WAFINAL_BASE_URL=...
WAFINAL_API_TOKEN=...
WAFINAL_INSTANCE_ID=...
```

> لازم يكون المتجر وصّل رقم واتساب من لوحة التحكم (الإعدادات ← واتساب)
> قبل ما الأمر ده يرجّع نتيجة.

باقي المفاتيح ليها قيم افتراضية شغّالة:

| المفتاح | الافتراضي | يعمل إيه |
|---|---|---|
| `WHATSAPP_ENABLED` | `true` | يقفل كل الإشعارات لو `false` |
| `WHATSAPP_NOTIFY_VENDOR` | `true` | يبعت للبائع كمان مش المشتري بس |
| `WHATSAPP_COUNTRY_CODE` | `966` | يحوّل `05x` لـ `9665x` |
| `WHATSAPP_STORE_NAME` | `القريات` | الاسم اللي يظهر في الرسالة |

### التجربة

```bash
npm run test-whatsapp -- 966512345678
npm run test-whatsapp -- 966512345678 delivered
```

بيعمل طلب وهمي ويبعت رسالة فعلية، ويطبع سبب الفشل لو فشل.

### الحالات المدعومة

| حالة أوتو | الرسالة |
|---|---|
| created / new / pending | تم تجهيز الشحنة |
| picked / collected | المندوب استلمها من البائع |
| shipped / in transit | في الطريق |
| out for delivery | المندوب في طريقه للعميل |
| delivered | تم التسليم |
| failed / undelivered | تعذّر التسليم |
| returned | مرتجع |
| cancelled | ملغي |

أي حالة تانية بتتسجّل في اللوج من غير إشعار — عشان ما نبعتش رسالة غلط.

**مفيش تكرار:** كل حالة بتتبعت مرة واحدة لكل طلب، حتى لو أوتو بعتت
نفس الويب هوك أكتر من مرة.

**فشل الإشعار ما بيكسرش حاجة:** لو واتساب وقع، الرد لأوتو بيفضل `200`
والشحنة بتكمل عادي.

---

## البيانات الجديدة الجاية من Mega Ai

`/shipping/rate-callback` بقى بياخد بيانات أغنى:

```json
{
  "ship_to":  { "city_id": 40891, "city_name": "Qurayyat", "address": "...", "phone": "..." },
  "items":    [ { "name": "...", "qty": 2, "unit_weight": 0.35, "vendor_id": 204 } ],
  "totals":   { "total_weight": 0.82, "total_qty": 3, "sub_total": 420.90 },
  "buyer":    { "name": "...", "phone": "..." },
  "vendors":  [ { "vendor_id": 204, "store_name": "...", "phone": "..." } ],
  "store":    { "id": 45, "name": "القريات", "currency": "ر.س" }
}
```

الحقول القديمة (`country_id` / `state_id` / `city_id` / `total`) لسه موجودة،
فالكود القديم ما وقعش.

**الوزن:** بياخده من `totals.total_weight`. لو طلع صفر (منتج مستورد
من غير `product_weight`)، بيحسب تقدير = عدد القطع × `SHIPPING_FALLBACK_ITEM_WEIGHT`
(٠.٥ كجم افتراضياً) بدل ما يبعت صفر لأوتو ويطلع سعر شحن غلط.
