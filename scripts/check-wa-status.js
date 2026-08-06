/**
 * حالة جوالات واتساب — npm run check-wa
 */
const botStatus = require("../lib/bot-status");
const wa = require("../lib/whatsapp-accounts-store");

const statuses = botStatus.getAllStatusesForDashboard();
console.log("\n=== حالة البوتات ===\n");
for (const s of statuses) {
  const alive = s.botProcessAlive ? "شغّال" : "متوقف/قديم";
  const line = [
    s.label,
    `(${s.accountId})`,
    "|",
    s.status,
    "|",
    alive,
    s.phone ? `| ${s.phone}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(line);
  if (s.status !== "ready" && s.accountId !== "admin") {
    console.log(
      "  -> غير متصل: شغّل start-bot-account.bat",
      s.accountId,
      "وامسح QR إن لزم"
    );
  }
}
console.log("");
