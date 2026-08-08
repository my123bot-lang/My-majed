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
7. أضف متغير `OWNER_CONTROL_PHONES` = **جوالك الشخصي** (غير رقم البوت) مثل `9665xxxxxxxx`
   ثم من ذلك الجوال أرسل **إلى رقم البوت**:
   - `stop` → يوقف آخر عميل راسل البوت
   - `start` → يشغّله
   - `stop 05xxxxxxxx` / `start 05xxxxxxxx` → عميل محدد
   - أو من اللوحة: زر **إيقاف الرد / تشغيل الرد**

### إيقاف عميل واحد واستئنافه

| الأمر | النتيجة |
|-------|---------|
| `stop` / `إيقاف` | إيقاف الرد الآلي لهذا العميل فقط |
| `start` / `تشغيل` | استئناف الرد الآلي لهذا العميل |
| فتح محادثة العميل من اللوحة | يوقف الرد الآلي لهذا العميل تلقائياً |
| قائمة البوت من **رقم التحكم** | من واتساب «ماجد للتمويل» أرسل لبوت «تمويلك سعودي»: `مرحبا` أو `تحكم` — يظهر لك فقط أزرار إيقاف/تشغيل. أضف رقم ماجد في اللوحة → الإعدادات → أرقام التحكم |
| أي رد يدوي منك | يوقف الرد الآلي لهذا العميل تلقائياً (إن وصل الحدث للخادم) |

| التشغيل | اكتب `stop` في شات العميل من تطبيق واتساب | يعمل؟ |
|---------|---------------------------------------------|-------|
| محلي `npm start` | نعم (وأي رد يدوي منك يوقف البوت لهذا العميل) | نعم |
| سحابة Interakt / Render | **لا** — Interakt لا يرسل webhook لرسائلك الصادرة من التطبيق | استخدم زر «إيقاف الرد» أو من جوالك إلى رقم البوت: `stop` / `stop 05xxxxxxxx` |

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
