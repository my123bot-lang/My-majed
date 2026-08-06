# WhatsApp Bot — ماجد (Interakt + سحابة + كوبري الحسبة)

بوت تمويل شخصي عبر **Interakt WhatsApp API** مع نشر سحابي وكوبري HTTP للحسبة.

## المعمارية

```
عميل واتساب
    ↓
Interakt (رقم واتساب الرسمي)
    ↓ webhook message_received
الخادم السحابي (cloud.js)
    ├─ بوت المحادثة (handlers)
    ├─ كوبري الحسبة (/api/calc/*)
    └─ لوحة التحكم (/)
    ↓ قالب bot_reply {{1}}
Interakt → العميل
```

## التشغيل المحلي (سحابي)

```bash
npm install
cp .env.example .env
# عبّئ INTERAKT_API_KEY و INTERAKT_WEBHOOK_SECRET
npm run cloud
```

- لوحة التحكم: `http://127.0.0.1:3000`
- كوبري الحسبة: `POST /api/calc/personal`
- Webhook: `POST /webhooks/interakt`

## كوبري الحسبة

مصادقة اختيارية عبر `CALC_BRIDGE_API_KEY` (هيدر `X-Api-Key`).

### نسب الفوائد
`GET /api/calc/rates`

### تمويل شخصي
```bash
curl -X POST http://127.0.0.1:3000/api/calc/personal \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: YOUR_KEY' \
  -d '{
    "jobCategory": "civilian",
    "salary": 10000,
    "commitments": 1000,
    "realEstate": "none"
  }'
```

`jobCategory`: `military` | `civilian` | `retired`  
`realEstate`: `supported` | `unsupported` | `none` | `old`

### شراء مديونية
```bash
curl -X POST http://127.0.0.1:3000/api/calc/debt \
  -H 'Content-Type: application/json' \
  -d '{
    "jobCategory": "civilian",
    "salary": 12000,
    "commitments": 1500,
    "debtAmount": 20000
  }'
```

### قسط فقط
```bash
curl -X POST http://127.0.0.1:3000/api/calc/installment \
  -H 'Content-Type: application/json' \
  -d '{ "amount": 10000, "interestRate": 13, "jobCategory": "civilian" }'
```

يمكن ربط هذه المسارات من **Interakt Workflow / Zapier / Make** كخطوة «كوبري».

## إعداد Interakt

1. خطة **Advanced** على الأقل (لاستقبال webhooks للرسائل الواردة).
2. Developer Settings → انسخ **API Key** وحدد **Webhook URL**:
   `https://YOUR-DOMAIN/webhooks/interakt`
3. ضع نفس **Secret Key** في `INTERAKT_WEBHOOK_SECRET`.
4. أنشئ قالب واتساب معتمد:
   - الاسم: `bot_reply` (أو قيمة `INTERAKT_REPLY_TEMPLATE`)
   - اللغة: `ar`
   - الفئة: Utility
   - النص: `{{1}}`
5. اربط رقم واتساب بيزنس بماجد في Interakt.

> واجهة Interakt العامة ترسل **قوالب** فقط؛ لذلك الردود تمر عبر قالب `bot_reply` الذي يحمل نص الرد كاملاً في `{{1}}`.

## النشر السحابي

### Docker
```bash
docker build -t majed-bot .
docker run -p 3000:3000 --env-file .env majed-bot
```

### Render
- اربط المستودع؛ الملف `render.yaml` جاهز.
- عيّن الأسرار: `INTERAKT_API_KEY`, `INTERAKT_WEBHOOK_SECRET`, `CALC_BRIDGE_API_KEY`.

### Railway / أي Node host
```bash
npm run cloud
```
المتغير `PORT` يُقرأ تلقائياً.

بعد النشر: حدّث Webhook URL في Interakt إلى نطاقك العام (HTTPS).

## التشغيل القديم (واتساب ويب على جهازك)

ما زال متاحاً للتطوير المحلي:

```bash
npm start          # أو start-majed.bat
npm run admin
```

## الحساب

| المعرّف | التسمية |
|---------|---------|
| `majed` | ماجد |

## الأمان

لا ترفع `.env` ولا جلسات واتساب ولا سجل العملاء. المستودع عام.
