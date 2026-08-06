/**
 * تفعيل حساب واتساب في اللوحة (قبل إعادة تشغيل البوت)
 * npm run set-active-wa -- majed
 */
const { setActiveAccount, getActiveAccount } = require("../lib/whatsapp-accounts-store");

const id = process.argv[2];
if (!id) {
  console.error("الاستخدام: node scripts/set-active-wa.js <معرّف>");
  console.error("مثال: node scripts/set-active-wa.js majed");
  process.exit(1);
}

try {
  const acc = setActiveAccount(id);
  console.log("تم التفعيل:", acc.label, `(${acc.id})`);
  console.log("الخطوة التالية: أوقف البوت ثم شغّل start-bot.bat");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
