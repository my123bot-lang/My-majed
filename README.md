# بوت ماجد — الحسبة الأصلية + كوبري Interakt

المصدر الصحيح هو أرشيف البوت الأصلي (`whatsapp_direct_bot`):  
**الحسبة** = `lib/calculations.js` + `lib/handlers.js` + `lib/messages.js`  
**الكوبري** = استقبال واتساب عبر Interakt ثم تمرير الرسالة لنفس الـ handlers، مع لوحة الإدارة/البوابة الأصلية (`/` و `/p/...`).

> ملاحظة تقنية فقط: Interakt يرسل الرد عبر قالب `bot_reply` فيه `{{1}}`.  
> هذا غلاف نقل فقط — المنطق والأسئلة والحسبة من البوت الأصلي كما هي.

## التدفق (الكوبري)

```
عميل واتساب
  → Interakt
  → POST /webhooks/interakt
  → handlers (نفس حسبة البوت الأول)
  → رد عبر قالب bot_reply {{1}}
  → العميل
```

## إعداد Interakt

1. API Key + Webhook Secret
2. Webhook URL: `https://YOUR-DOMAIN/webhooks/interakt`
3. فعّل: **Message received from customers**
4. قالب معتمد:
   - الاسم: `bot_reply`
   - اللغة: `ar`
   - النص: `{{1}}.`

بدون اعتماد القالب لن يخرج رد (قيود Interakt/Meta).

## التشغيل السحابي

```bash
npm install
cp .env.example .env
# INTERAKT_API_KEY + INTERAKT_WEBHOOK_SECRET
npm run cloud
```

- لوحة الإدارة الأصلية: `GET /`
- بوابة المندوب: روابط `/p/...` من `portal-access`
- Webhook: `POST /webhooks/interakt`

Docker / Render جاهزان (`Dockerfile`, `render.yaml`).

### تشغيل حي (نفق مؤقت)

- لوحة: https://romantic-medications-bargains-reward.trycloudflare.com/
- Webhook: `https://romantic-medications-bargains-reward.trycloudflare.com/webhooks/interakt`

> الرابط مؤقت. للرفع الدائم انشر على Render ثم حدّث Webhook Interakt.

### رفع دائم على Render

1. [Render](https://dashboard.render.com) → Blueprint / Web Service من المستودع
2. Start: `node cloud.js` — Health: `/api/health`
3. متغيرات: `INTERAKT_API_KEY` · `INTERAKT_WEBHOOK_SECRET` · `CLOUD=1` · `INTERAKT_REPLY_TEMPLATE=bot_reply` · `INTERAKT_REPLY_LANGUAGE=ar` · `INTERAKT_COUNTRY_CODE=+966`
4. حدّث Webhook إلى النطاق الدائم

## محلي (واتساب ويب)

```bash
npm start          # node bot.js majed
npm run admin
```
