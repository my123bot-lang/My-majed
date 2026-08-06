# WhatsApp Bot — ماجد على Interakt + السحابة

**نفس نظام الردود الأصلي** (`handlers` + `config` + الحسبة) — على Interakt والسحابة.

> ملاحظة تقنية فقط: Interakt يفرض إرسال الرد عبر قالب واحد `bot_reply` نصه `{{1}}`.  
> هذا غلاف نقل، مو تغيير للمنطق أو أسئلة البوت.

## التدفق

```
عميل → Interakt → webhook /webhooks/interakt
                 → handlers (نفس البوت الأول)
                 → رد عبر قالب bot_reply {{1}}
                 → العميل
```

## إعداد Interakt (مرة واحدة)

1. Developer Settings → API Key + Webhook Secret (تم)
2. Webhook URL:
   `https://YOUR-DOMAIN/webhooks/interakt`
3. فعّل: **Message received from customers**
4. Templates → أنشئ واعتمد:
   - الاسم: `bot_reply`
   - اللغة: `ar`
   - الفئة: Utility
   - النص: `{{1}}`

بدون اعتماد هذا القالب لن يخرج أي رد (قيود Interakt/Meta).

## التشغيل السحابي

```bash
npm install
cp .env.example .env
# INTERAKT_API_KEY + INTERAKT_WEBHOOK_SECRET
npm run cloud
```

Docker / Render جاهزان (`Dockerfile`, `render.yaml`).

## كوبري الحسبة

نفس معادلات البوت:

- `POST /api/calc/personal`
- `POST /api/calc/debt`
- `GET  /api/calc/rates`

## محلي (واتساب ويب) للتطوير

```bash
npm start          # node bot.js majed
npm run admin
```
