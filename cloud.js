/**
 * تشغيل سحابي — Interakt + كوبري الحسبة + نفس نظام ردود البوت الأصلي
 * npm run cloud
 */
process.env.CLOUD = "1";

const { startServer, PORT, HOST } = require("./server");
const interakt = require("./lib/interakt-client");

console.log("");
console.log("============================================");
console.log("  Cloud — Majed bot via Interakt");
console.log(`  Listening ${HOST}:${PORT}`);
console.log("  Same handlers/config as original bot");
console.log("  Calc bridge:    POST /api/calc/personal");
console.log("  Interakt WH:    POST /webhooks/interakt");
console.log(
  "  Interakt send:  ",
  interakt.isConfigured()
    ? `ON (template ${interakt.getConfig().replyTemplate})`
    : "MISSING INTERAKT_API_KEY"
);
console.log("  Admin UI:       GET  /");
console.log("============================================");
console.log("");

startServer({ openAdminBrowser: false });
