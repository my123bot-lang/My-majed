# WhatsApp Bot — ماجد (Meta Cloud API + كوبري الحسبة)

ردود **حرة** عبر WhatsApp Cloud API خلال 24 ساعة من رسالة العميل، مع لوحة تحكم وكوبري حسبة.

## المعمارية

```
عميل واتساب
    ↓
Meta WhatsApp Cloud API
    ↓ webhook /webhooks/meta
الخادم السحابي (cloud.js)
    ├─ بوت المحادثة (handlers) — رد حر نصّي
    ├─ كوبري الحسبة (/api/calc/*)
    └─ لوحة التحكم
```

## المطلوب من Meta

1. تطبيق على [developers.facebook.com](https://developers.facebook.com)
2. إضافة منتج **WhatsApp** وربط رقم الأعمال
3. انسخ:
   - **Temporary/Permanent Access Token** → `META_WA_TOKEN`
   - **Phone number ID** → `META_WA_PHONE_NUMBER_ID`
   - **App Secret** → `META_APP_SECRET`
4. Webhook URL: `https://YOUR-DOMAIN/webhooks/meta`
5. Verify token: نفس `META_WA_VERIFY_TOKEN` (افتراضي `majed_verify`)
6. اشترك في حقل **messages**

## التشغيل

```bash
npm install
cp .env.example .env
# عبّئ META_WA_TOKEN و META_WA_PHONE_NUMBER_ID
npm run cloud
```

- لوحة: `http://127.0.0.1:3000`
- Webhook: `POST/GET /webhooks/meta`
- حسبة: `POST /api/calc/personal`

## كوبري الحسبة

```bash
curl -X POST http://127.0.0.1:3000/api/calc/personal \
  -H 'Content-Type: application/json' \
  -d '{"jobCategory":"civilian","salary":10000,"commitments":1000,"realEstate":"none"}'
```

## نسب الفوائد

- عسكري: 18.5% | مدني/متقاعد: 13% | شراء مديونية: 12%

## ملاحظة

خارج نافذة 24 ساعة Meta ترفض النص الحر وتلزم قالب — هذا البوت للمحادثة التفاعلية بعد رسالة العميل.
