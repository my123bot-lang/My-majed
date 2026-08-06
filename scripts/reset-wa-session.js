/**
 * إعادة ضبط جلسة واتساب (عند خطأ Execution context was destroyed)
 * npm run reset-wa-session
 * npm run reset-wa-session -- majed
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const waAccounts = require("../lib/whatsapp-accounts-store");
const { getSessionDir, getWwebjsAuthPath } = require("../lib/wwebjs-auth-path");

const arg = process.argv.slice(2).find((a) => a && !a.startsWith("-"));
const clientId = arg || waAccounts.getActiveAccount().id;
const sessionDir = getSessionDir(clientId);
const legacyDir = path.join(__dirname, "..", ".wwebjs_auth", `session-${clientId}`);

console.log("الحساب:", clientId);
console.log("مجلد الجلسة:", getWwebjsAuthPath());

try {
  if (process.platform === "win32") {
    execSync("taskkill /F /IM chrome.exe /T 2>nul", { stdio: "ignore" });
  }
} catch (_) {}

for (const dir of [sessionDir, legacyDir]) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("تم حذف:", dir);
  }
}

console.log("\nالخطوة التالية:");
console.log("  start-bot.bat");
console.log("  امسح QR من Chrome او لوحة التحكم");
