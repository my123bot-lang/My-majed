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
| زر **إيقاف الرد الآلي** أمام رقم العميل في سجل العملاء | إيقاف/تشغيل لهذا العميل |
| فتح محادثة العميل من اللوحة | يوقف الرد الآلي تلقائياً |
| من صندوق Interakt: اكتب `stop` / `إيقاف` داخل شات العميل | يوقف هذا العميل فقط |
| أي رد يدوي منك على العميل (إن وصل الحدث للخادم) | يوقف الرد الآلي لهذا العميل |
| محلي `npm start`: اكتب `stop` داخل شات العميل من رقم البوت | يوقف هذا العميل فقط |
| رسالة `stop` من **العميل** | لا أثر |

اختياري — جوال شخصي **غير رقم البوت**: أضفه في الإعدادات → أرقام التحكم، ثم راسل البوت منه → تظهر لك فقط أزرار إيقاف/تشغيل في قائمته.

| التشغيل | اكتب `stop` داخل شات العميل من تطبيق واتساب الأعمال | يعمل؟ |
|---------|-----------------------------------------------------|-------|
| محلي `npm start` | نعم (وأي رد يدوي منك يوقف البوت لهذا العميل) | نعم |
| سحابة Interakt / Render | غالباً **لا** من تطبيق الأعمال | صندوق Interakt أو زر سجل العملاء |

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
