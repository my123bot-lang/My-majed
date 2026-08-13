/**
 * اختبار عدد العملاء الفريدين في الإحصائية.
 * تشغيل: node scripts/smoke-customer-stats.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "majed-stats-"));
const statsFile = path.join(tmpDir, "call-stats.json");
process.env.CALL_STATS_PATH = statsFile;
process.env.WA_ACCOUNT_ID = "majed";

const { setCurrentWaAccountId } = require("../lib/current-wa-account");
setCurrentWaAccountId("majed");

const {
  recordInboundContact,
  getDashboardStats,
  customerKey,
} = require("../lib/call-stats");

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

ok(customerKey("0501112233") === "501112233", "customerKey 05xxxxxxxx");
ok(customerKey("966501112233") === "501112233", "customerKey 9665");
ok(customerKey("501112233") === "501112233", "customerKey 5xxxxxxxx");
ok(customerKey("0501112233") === customerKey("966501112233"), "same phone same key");

recordInboundContact("0501112233");
recordInboundContact("0501112233");
recordInboundContact("+966501112233");
recordInboundContact("0550000001");

const stats = getDashboardStats();
ok(stats.totals.contacts === 4, `contacts=4 got ${stats.totals.contacts}`);
ok(stats.totals.customers === 2, `unique customers=2 got ${stats.totals.customers}`);
ok(stats.customers.today === 2, `today unique=2 got ${stats.customers.today}`);
ok(stats.customers.total === 2, `total unique=2 got ${stats.customers.total}`);
ok(stats.customers.week === 2, `week unique=2 got ${stats.customers.week}`);
ok(stats.customers.newThisWeek === 2, `new this week=2 got ${stats.customers.newThisWeek}`);
ok(stats.today.customers === 2, `today bucket customers=2 got ${stats.today.customers}`);

const majed = getDashboardStats({ waAccountId: "majed" });
ok(majed.customers.total === 2, `majed unique=2 got ${majed.customers.total}`);
ok((majed.last7Days || []).some((row) => row.date && row.customers === 2), "last7Days includes today unique=2");

try {
  fs.unlinkSync(statsFile);
  fs.rmdirSync(tmpDir);
} catch (_) {
  /* ignore */
}

console.log("smoke-customer-stats: ok");
