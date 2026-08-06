/**
 * تشغيل سحابي — لوحة + كوبري حسبة + Meta WhatsApp Cloud API
 * npm run cloud
 */
process.env.CLOUD = "1";

const { startServer, PORT, HOST } = require("./server");
const meta = require("./lib/meta-client");

console.log("");
console.log("============================================");
console.log("  Cloud mode — Majed via Meta Cloud API");
console.log(`  Listening ${HOST}:${PORT}`);
console.log("  Calc bridge:   POST /api/calc/personal");
console.log("  Meta webhook:  GET/POST /webhooks/meta");
console.log(
  "  Meta send:     ",
  meta.isConfigured() ? "configured" : "MISSING TOKEN / PHONE_NUMBER_ID"
);
console.log("  Admin UI:      GET  /");
console.log("============================================");
console.log("");

startServer({ openAdminBrowser: false });
