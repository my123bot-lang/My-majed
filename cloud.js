/**
 * تشغيل سحابي — لوحة التحكم + كوبري الحسبة + Webhook Interakt
 * Railway / Render / Fly / Docker:
 *   npm run cloud
 *   أو: node cloud.js
 */
process.env.CLOUD = "1";

const { startServer, PORT, HOST } = require("./server");

console.log("");
console.log("============================================");
console.log("  Cloud mode — Majed WhatsApp via Interakt");
console.log(`  Listening ${HOST}:${PORT}`);
console.log("  Calc bridge:  POST /api/calc/personal");
console.log("  Interakt WH:  POST /webhooks/interakt");
console.log("  Admin UI:     GET  /");
console.log("============================================");
console.log("");

startServer({ openAdminBrowser: false });
