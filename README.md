# بوت ماجد على واتساب (Interakt) — سحابة دائمة

العميل يفتح واتساب ويختار من الأزرار/القائمة → الحسبة الأصلية (`handlers` + `calculations`).

## رفع دائم على Render (موصى به)

1. ادخل [dashboard.render.com](https://dashboard.render.com) وسجّل بحساب GitHub
2. **New** → **Blueprint** → اختر مستودع `My-majed`
   - أو **Web Service** من الفرع `main` / `cursor/import-whatsapp-bot-66cf`
3. الإعدادات:
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
   `https://majed-whatsapp-bot.onrender.com`
6. في Interakt → Developer Settings → Webhook URL:
   `https://YOUR-RENDER-URL/webhooks/interakt`
   وفعّل **Message received from customers**
7. أضف رقم واتساب **ماجد للتمويل** (أو جوالك) في اللوحة → الإعدادات → أرقام التحكم، أو `OWNER_CONTROL_PHONES`
8. من **واتساب ماجد** افتح محادثة بوت **تمويلك سعودي** وأرسل `مرحبا` أو `تحكم`:
   - يظهر لك فقط زرّا **إيقاف الرد الآلي** / **تشغيل الرد الآلي**
   - العميل العادي لا يرى هذين الخيارين في قائمته

### إيقاف عميل واحد من محادثة واتساب (أنت فقط)

| من محادثة واتساب | النتيجة |
|------------------|---------|
| من رقم ماجد → بوت تمويلك: اضغط **إيقاف الرد الآلي** في القائمة/الأزرار | يوقف آخر عميل راسل البوت |
| من رقم ماجد → بوت تمويلك: **تشغيل الرد الآلي** | يستأنف آخر عميل |
| `stop` / `إيقاف` أو `stop 05xxxxxxxx` من رقم التحكم إلى البوت | نفس الإيقاف بالنص |
| محلي `npm start`: اكتب `stop` داخل شات العميل (من رقم البوت) | يوقف هذا العميل فقط |
| رسالة `stop` من **العميل** | لا أثر — العميل لا يتحكم |

| التشغيل | اكتب `stop` داخل شات العميل من تطبيق واتساب الأعمال | يعمل؟ |
|---------|-----------------------------------------------------|-------|
| محلي `npm start` | نعم (وأي رد يدوي منك يوقف البوت لهذا العميل) | نعم |
| سحابة Interakt / Render | **لا** — Interakt لا يرسل webhook لرسائلك الصادرة من التطبيق | من واتساب ماجد إلى رقم البوت: زر القائمة أو `stop` / `stop 05xxxxxxxx` |

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
