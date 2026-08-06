# WhatsApp Direct Bot (ماجد)

بوت واتساب للتمويل الشخصي وشراء المديونية، مع لوحة تحكم إدارية — حساب **ماجد** فقط.

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
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
# PUPPETEER_HEADLESS=1
# WA_ACCOUNT_ID=majed
```

## التشغيل

### لوحة التحكم

```bash
npm run admin
```

افتح `http://127.0.0.1:3000` — عند أول تشغيل أنشئ مستخدم المدير من الواجهة.

### بوت واتساب (ماجد)

```bash
npm start
# أو
node bot.js majed
# Windows: start-majed.bat أو start-bot.bat
```

امسح QR من نافذة Chrome أو من لوحة التحكم.

## الحساب

| المعرّف | التسمية |
|---------|---------|
| `majed` | ماجد |

الإعدادات في `data/settings-by-wa.json` و `data/settings.json`.

## الأمان

المستودع عام — لا ترفع جلسات واتساب (`.wwebjs_auth`) ولا كلمات مرور اللوحة ولا سجل العملاء.

## تعديل الرسائل والشروط

عدّل `config.js` فقط لتغيير النصوص، النسب، الحدود، وأرقام التواصل. منطق التدفق في `lib/handlers.js`.
