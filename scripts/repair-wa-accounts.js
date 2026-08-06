/**
 * استعادة حسابات واتساب (رايد / عبدالرحمن / ماجد) إذا تلف whatsapp-accounts.json
 * npm run repair-wa-accounts
 */
const waAccounts = require("../lib/whatsapp-accounts-store");

const store = waAccounts.loadStore();
const runnable = waAccounts.listRunnableAccounts();

console.log("حسابات التشغيل:");
if (!runnable.length) {
  console.error("لا توجد حسابات — راجع data/whatsapp-accounts.json");
  process.exit(1);
}
for (const acc of runnable) {
  console.log(" -", acc.id, "—", acc.label);
}
console.log("النشط:", store.activeId || runnable[0].id);
