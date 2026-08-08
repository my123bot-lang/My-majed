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
7. (موصى به) أضف متغير `OWNER_CONTROL_PHONES` = رقم جوالك الشخصي (مثال `9665xxxxxxxx`)
   لإيقاف/تشغيل عميل من السحابة أرسل من ذلك الجوال **إلى رقم البوت**:
   - `stop 05xxxxxxxx`
   - `start 05xxxxxxxx`
   - أو من اللوحة: زر **إيقاف الرد / تشغيل الرد** بجانب رقم العميل

### مهم: Stop من محادثة العميل على Interakt

كتابة `Stop` داخل محادثة العميل من تطبيق واتساب الأعمال **لا تصل** لخادم Render.
وثائق Interakt توصل فقط:
- `message_received` = رسائل العميل الواردة
- `message_api_*` = حالة قوالب الحملات/API

لذلك مسار «اكتب stop في الشات» يعمل على **واتساب ويب المحلي** (`npm start`) فقط،
أما الإنتاج على Interakt فاستخدم اللوحة أو `OWNER_CONTROL_PHONES`.

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
