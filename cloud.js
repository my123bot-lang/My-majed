/**
 * تشغيل سحابي — كوبري Interakt → نفس حسبة وردود البوت الأصلي
 * npm run cloud
 */
process.env.CLOUD = "1";

const { startServer, PORT, HOST } = require("./server");
const interakt = require("./lib/interakt-client");

console.log("");
console.log("============================================");
console.log("  Cloud — Majed (original calc + Interakt)");
console.log(`  Listening ${HOST}:${PORT}`);
console.log("  Calc:           handlers + calculations.js");
console.log("  Bridge:         POST /webhooks/interakt");
console.log(
  "  Interakt send:  ",
  interakt.isConfigured()
    ? `ON (template ${interakt.getConfig().replyTemplate})`
    : "MISSING INTERAKT_API_KEY"
);
console.log("  Admin / portal: GET  /");
console.log("============================================");
console.log("");

startServer({ openAdminBrowser: false });
