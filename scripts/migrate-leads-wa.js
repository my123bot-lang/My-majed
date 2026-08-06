/**
 * ترحيل سجل العملاء — وسْم ماجد + حالة عرض بديل
 * npm run migrate-leads
 */
const fs = require("fs");
const path = require("path");

const LEADS_PATH = path.join(__dirname, "..", "data", "customer-leads.json");
const leads = require("../lib/customer-leads");
const STATUS_LABELS = leads.STATUS_LABELS;

const DEFAULT = { waAccountId: "majed", waAccountLabel: "ماجد" };
const CUTOFF = new Date("2026-06-02T08:00:00.000Z");

function migrateRow(row) {
  let next = { ...row };
  if (next.comboPackage && next.status === "property") {
    next.status = "combo_offer";
    next.statusLabel = STATUS_LABELS.combo_offer;
  }
  if (!next.waAccountId && new Date(next.at || 0) < CUTOFF) {
    next.waAccountId = DEFAULT.waAccountId;
    next.waAccountLabel = DEFAULT.waAccountLabel;
  }
  return next;
}

const raw = JSON.parse(fs.readFileSync(LEADS_PATH, "utf8"));
let n = 0;
raw.leads = raw.leads.map((row) => {
  const next = migrateRow(row);
  if (
    next.waAccountId !== row.waAccountId ||
    next.status !== row.status
  ) {
    n += 1;
  }
  return next;
});
raw.updatedAt = new Date().toISOString();
fs.writeFileSync(LEADS_PATH, JSON.stringify(raw, null, 2), "utf8");
console.log("تم تحديث", n, "سجل من", raw.leads.length);
