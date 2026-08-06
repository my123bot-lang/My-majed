/**
 * يزيل قفل Chrome العالق بعد إغلاق البوت بشكل غير طبيعي.
 * تشغيل: npm run unlock
 */
const fs = require("fs");
const path = require("path");
const { getWwebjsAuthPath } = require("../lib/wwebjs-auth-path");

const lockFiles = [
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "lockfile",
];

function unlockDir(sessionDir) {
  let removed = 0;
  for (const name of lockFiles) {
    const filePath = path.join(sessionDir, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      fs.unlinkSync(filePath);
      removed += 1;
      console.log("تم حذف:", filePath);
    } catch (err) {
      console.warn("تعذر حذف", filePath, "— أغلق Chrome:", err.message);
    }
  }
  return removed;
}

const authRoot = getWwebjsAuthPath();
console.log("مجلد الجلسات:", authRoot);

if (!fs.existsSync(authRoot)) {
  console.log("لا توجد جلسة محفوظة — لا حاجة لفك القفل.");
  process.exit(0);
}

const onlyAccountId = process.argv[2] ? String(process.argv[2]).trim() : null;
const onlySessionName = onlyAccountId ? `session-${onlyAccountId}` : null;

let total = 0;
const entries = fs.readdirSync(authRoot, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  if (!entry.name.startsWith("session-")) continue;
  if (onlySessionName && entry.name !== onlySessionName) continue;
  total += unlockDir(path.join(authRoot, entry.name));
}

if (total === 0) {
  console.log(
    "لم يُعثر على ملفات قفل. إن استمر الخطأ: أغلق Chrome من مدير المهام ثم start-bot.bat"
  );
} else {
  console.log(`تم فك ${total} ملف قفل. شغّل: start-bot.bat`);
}
