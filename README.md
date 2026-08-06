# بوت ماجد على واتساب (Interakt)

العميل يفتح واتساب ويكتب مثلاً **`1`** → البوت يسأله **«أي قطاع؟»** → يكمل الحسبة خطوة بخطوة (راتب، عقاري، التزامات، عرض المبلغ…).

نفس المنطق الأصلي: `handlers` + `config` + `calculations`.

## التدفق

```
عميل يكتب 1
  → Interakt
  → POST /webhooks/interakt
  → handlers (الحسبة الأصلية)
  → رد نص حر على واتساب
  → العميل
```

الإرسال: **نص حر** داخل نافذة 24 ساعة بعد رسالة العميل (`INTERAKT_SEND_MODE=auto`).  
قالب `bot_reply` احتياطي فقط إذا انتهت النافذة.

## إعداد Interakt

1. API Key + Webhook Secret
2. Webhook: `https://YOUR-DOMAIN/webhooks/interakt`
3. فعّل **Message received from customers**
4. (اختياري) اعتمد قالب `bot_reply` / `ar` نص `{{1}}.` للاحتياطي

## تشغيل

```bash
npm install
cp .env.example .env
npm run cloud
```

نفق مؤقت حالياً:
- لوحة: https://romantic-medications-bargains-reward.trycloudflare.com/
- Webhook: `https://romantic-medications-bargains-reward.trycloudflare.com/webhooks/interakt`

للرفع الدائم: Render (`render.yaml`) ثم حدّث Webhook.

## محلي (واتساب ويب)

```bash
npm start
npm run admin
```
