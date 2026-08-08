# بوت ماجد على واتساب (Interakt) — سحابة دائمة

العميل يفتح واتساب ويختار من الأزرار/القائمة → الحسبة الأصلية (`handlers` + `calculations`).

## رفع دائم على Render (موصى به)

1. ادخل [dashboard.render.com](https://dashboard.render.com) وسجّل بحساب GitHub
2. **New** → **Blueprint** → اختر مستودع `My-majed`
   - أو **Web Service** من الفرع `main`
3. الإعدادات:
   - **Branch:** `main` (لا تستخدم فرع `cursor/import-whatsapp-bot-66cf` القديم)
   - **Build:** `npm ci --omit=dev`
   - **Start:** `node cloud.js`
   - **Health Check:** `/api/health`
   - **Plan:** `Starter` (لا تستخدم Free — ينام ويكسر الـ Webhook)
4. Environment Variables:
   - `CLOUD=1`
   - `ADMIN_HOST=0.0.0.0`
   - `INTERAKT_API_KEY` = مفتاحك من Interakt
   - `INTERAKT_WEBHOOK_SECRET` = سر الـ Webhook
   - `INTERAKT_SEND_MODE=auto`
   - `INTERAKT_COUNTRY_CODE=+966`
   - `INTERAKT_REPLY_TEMPLATE=bot_reply`
   - `INTERAKT_REPLY_LANGUAGE=ar`
5. بعد النشر انسخ الرابط مثل:
   `https://my-majed.onrender.com`
6. في Interakt → Developer Settings → Webhook URL:
   `https://YOUR-RENDER-URL/webhooks/interakt`
   وفعّل **Message received from customers**

### إيقاف الرد الآلي لعميل واحد (أنت فقط)

إذا **رقم البوت = واتساب العمل** (مثل `0507009290`): لا يمكن إظهار زر خاص لك داخل قائمة العميل (القائمة يراها العميل). استخدم:

| الطريقة | النتيجة |
|---------|---------|
| من صندوق **Interakt** أو واتساب ويب المحلي: أرسل للعميل `stop` / `إيقاف` | يوقف الرد الآلي لهذا العميل فقط |
| `start` / `تشغيل` لنفس العميل | يستأنف الرد الآلي |
| زر **إيقاف الرد الآلي** في سجل العملاء | إيقاف/تشغيل لهذا العميل |
| فتح محادثة العميل من اللوحة | يوقف الرد الآلي تلقائياً |
| أي رد يدوي منك على العميل (إن وصل الحدث للخادم) | يوقف الرد الآلي لهذا العميل |
| رسالة `stop` من **العميل** | لا أثر |

اختياري — جوال شخصي **غير رقم البوت**: أضفه في الإعدادات → أرقام التحكم، ثم راسل البوت منه → تظهر لك فقط أزرار إيقاف/تشغيل في قائمته.

| التشغيل | أرسل `stop` للعميل | يعمل؟ |
|---------|---------------------|-------|
| محلي `npm start` | نعم من رقم البوت داخل شات العميل | نعم |
| صندوق Interakt (ويب) | نعم — يصل كرسالة صادرة ويُوقف البوت | نعم |
| تطبيق واتساب الأعمال | نعم بعد تفعيل **Coexistence + smb_message_echoes** أدناه | بعد الإعداد |

### تفعيل stop من تطبيق واتساب الأعمال (نفس الرقم)

Interakt وحده لا يرسل للخادم ما تكتبه من تطبيق الأعمال. الحل الرسمي من Meta:

1. فعّل **WhatsApp Coexistence** في Interakt لنفس رقم العمل (رقم البوت = واتساب الأعمال)  
   الدليل: [Interakt Coexistence](https://www.interakt.shop/resource-center/whatsapp-coexistence/)
2. في Meta Developer → تطبيق WhatsApp → Webhooks:
   - Callback URL: `https://YOUR-RENDER-URL/webhooks/meta`
   - Verify token: قيمة `META_WA_VERIFY_TOKEN` (مثلاً `majed_verify`)
   - اشترك في الحقل **`smb_message_echoes`**
3. في Render أضف (إن لزم للتوقيع): `META_APP_SECRET` و`META_WA_VERIFY_TOKEN`
4. افتح تطبيق الأعمال مرة كل 13 يوماً على الأقل (شرط Coexistence)
5. اختبر: من التطبيق أرسل لعميل `stop` — يجب أن يتوقف الرد الآلي

إذا تعذّر ربط `smb_message_echoes` (لأن Interakt يمتلك الـ WABA): استخدم صندوق Interakt أو زر سجل العملاء، أو اطلب من Interakt توجيه أصداء التطبيق إلى ويب هوكك.

الملف الجاهز: `render.yaml`

## تشغيل محلي / نفق مؤقت (للتطوير فقط)

```bash
npm install
cp .env.example .env
npm run cloud
```

النفق الحالي مؤقت ويتقفل مع انتهاء جلسة الوكيل.

## محلي واتساب ويب

```bash
npm start
npm run admin
```
