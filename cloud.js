/**
 * تشغيل سحابي — كوبري Interakt → نفس حسبة وردود البوت الأصلي
 * npm run cloud
 */
require("./lib/load-env").loadEnvFile();
process.env.CLOUD = "1";

const { startServer, PORT, HOST } = require("./server");
const interakt = require("./lib/interakt-client");
const { logOwnerControlBanner } = require("./lib/owner-remote-control");
const { autoRestoreOnBootIfEmpty } = require("./lib/interakt-sync");

console.log("");
console.log("============================================");
console.log("  Cloud — Majed (original calc + Interakt)");
console.log(`  Listening ${HOST}:${PORT}`);
console.log("  Calc:           handlers + calculations.js");
console.log("  Bridge:         POST /webhooks/interakt");
console.log(
  "  Interakt send:  ",
  interakt.isConfigured()
    ? `ON (mode ${interakt.getConfig().sendMode})`
    : "MISSING INTERAKT_API_KEY"
);
console.log("  Admin / portal: GET  /");
logOwnerControlBanner(" ");
console.log("============================================");
console.log("");

startServer({ openAdminBrowser: false });
autoRestoreOnBootIfEmpty();
