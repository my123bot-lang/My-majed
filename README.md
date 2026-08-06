# WhatsApp Direct Bot (رائد الحربي)

بوت واتساب للتمويل الشخصي وشراء المديونية، مع لوحة تحكم إدارية متعددة الحسابات.

مصدر الأرشيف: `whatsapp_direct_bot 08062026.rar` (8 يونيو 2026).

## المتطلبات

- Node.js 18+
- Google Chrome (Windows) أو Chromium (Linux)
- حساب واتساب لمسح رمز QR عند أول تشغيل

## التثبيت

```bash
npm install
cp .env.example .env
```

عدّل `.env` حسب الحاجة:

```env
ADMIN_PORT=3000
ADMIN_HOST=0.0.0.0
# ADMIN_PASSWORD=optional-legacy-password
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
# PUPPETEER_HEADLESS=1
# WA_ACCOUNT_ID=majed
# WWEBJS_AUTH_PATH=/var/lib/whatsapp_direct_bot_wwebjs
```

## التشغيل

### لوحة التحكم

```bash
npm run admin
```

افتح `http://127.0.0.1:3000` — عند أول تشغيل أنشئ مستخدم المدير من الواجهة.

### بوت واتساب

```bash
# الحساب النشط في data/whatsapp-accounts.json
npm start

# حساب محدد (ماجد / رايد / عبدالرحمن)
node bot.js majed
node bot.js 0488
node bot.js wa_1780305984859
```

على Windows يمكنك استخدام ملفات `.bat` مثل `start-majed.bat` و `start-bot.bat`.

امسح QR من نافذة Chrome أو من لوحة التحكم.

## الحسابات المضمّنة

| المعرّف | التسمية |
|---------|---------|
| `0488` | رايد |
| `wa_1780305984859` | عبدالرحمن |
| `majed` | ماجد |

الإعدادات لكل حساب في `data/settings-by-wa.json` و `data/settings.json`.

## الأمان

المستودع عام — **لم يُرفع**:

- جلسات واتساب (`.wwebjs_auth`)
- كلمات مرور لوحة التحكم
- سجل العملاء وأرقام الجوال
- رموز روابط البوابة

انسخ بيانات التشغيل محلياً من نسختك الاحتياطية إن احتجتها. لا ترفع `.env` أو مجلد الجلسات.

## تعديل الرسائل والشروط

عدّل `config.js` فقط لتغيير النصوص، النسب، الحدود، وأرقام التواصل. منطق التدفق في `lib/handlers.js`.
