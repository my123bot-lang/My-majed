/**
 * اختبار: استعادة سجل العملاء تلقائياً عند الإقلاع إن كان فاضياً بعد نشر جديد
 * (القرص المؤقت على Render يمسح customer-leads.json مع كل نشر).
 */
process.env.CUSTOMERS_DATA_DIR = require("fs").mkdtempSync(
  require("path").join(require("os").tmpdir(), "majed-interakt-sync-")
);
delete process.env.INTERAKT_API_KEY;

const assert = require("assert");
const { syncCustomersFromInterakt, autoRestoreOnBootIfEmpty } = require("../lib/interakt-sync");

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

(async () => {
  let threw = false;
  try {
    await syncCustomersFromInterakt({ days: 30 });
  } catch (err) {
    threw = true;
    ok(/INTERAKT_API_KEY/.test(err.message), "throws clear error without API key");
  }
  ok(threw, "syncCustomersFromInterakt requires INTERAKT_API_KEY");

  let ranAutoRestore = false;
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => {
    ranAutoRestore = true;
    return originalSetTimeout(fn, 0);
  };
  try {
    autoRestoreOnBootIfEmpty({ delayMs: 0 });
    ok(ranAutoRestore, "autoRestoreOnBootIfEmpty schedules a check");
    await new Promise((r) => originalSetTimeout(r, 50));
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  console.log("smoke-interakt-sync: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
