/**
 * الصفحة المنسوخة من لوحة رائد مربوطة بسجل ماجد
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
assert.ok(html.includes("IBM Plex Sans Arabic"), "Raed font");
assert.ok(html.includes("وش صار"), "outcome column");
assert.ok(html.includes("أخذ رابط التمويل"), "finance_link outcome");
assert.ok(html.includes("رابط — بدون متابعة"), "pending list");
assert.ok(html.includes("رابط — تمت المتابعة"), "sent list");
assert.ok(html.includes("رابط — متابعة بلس"), "plus list");
assert.ok(html.includes("حلول تمويلية"), "financing solutions");
assert.ok(html.includes("بحث برقم الجوال"), "home phone search");
assert.ok(html.includes("تفتح صفحة مستقلة"), "independent list pages");
assert.ok(html.includes("20260820r4"), "Raed UI version");
assert.ok(!html.includes("النسخ الاحتياطي"), "backup panel removed from home");
assert.ok(!html.includes("التخزين مؤقت"), "persistence banner removed from home");
assert.ok(html.includes("لم تُرسل متابعة"), "follow-up badge");
assert.ok(html.includes("عملاء ماجد") || html.includes(">ماجد<"), "Majed branding");
assert.ok(!html.includes("رائد الحربي"), "no Raed name");
assert.ok(html.includes("/admin/api"), "Raed API paths");
assert.ok(html.includes("متابعة جماعية"), "bulk follow-up card");
assert.ok(html.includes("/customers/lookup"), "customer page lookup");
assert.ok(html.includes("function openList"), "openList pages");

process.env.CUSTOMERS_DATA_DIR = fs.mkdtempSync(
  path.join(require("os").tmpdir(), "majed-raed-")
);
const {
  requireLeadByPhone,
  getLeads,
  setLeadManual,
  setLeadRejected,
  setLeadFollowupPlus,
  markLeadFollowupSent,
  setLeadOutcome,
  upsertLeadByPhone,
  LEADS_PATH,
  DATA_DIR,
} = require("../lib/customer-leads");
fs.mkdirSync(DATA_DIR, { recursive: true });
const now = new Date().toISOString();
fs.writeFileSync(
  LEADS_PATH,
  JSON.stringify({
    leads: [
      {
        id: "x1",
        phone: "0555000111",
        at: now,
        waAccountId: "majed",
        applicationMethod: "electronic",
        status: "personal_finance",
      },
    ],
  }),
  "utf8"
);
const lead = requireLeadByPhone("555000111");
assert.equal(lead.id, "x1");

const pending = getLeads({ day: "finance_link_pending" });
assert.ok(pending.leads.some((r) => r.id === "x1"), "pending tab has unsent link");

markLeadFollowupSent("x1", "هل تم تقديم الطلب؟");
const sent = getLeads({ day: "finance_link_sent" });
assert.ok(sent.leads.some((r) => r.id === "x1"), "sent tab after follow-up");
assert.ok(
  !getLeads({ day: "finance_link_pending" }).leads.some((r) => r.id === "x1"),
  "leaves pending after follow-up"
);

setLeadFollowupPlus("x1", true);
assert.ok(
  getLeads({ day: "finance_link_plus" }).leads.some((r) => r.id === "x1"),
  "plus tab"
);

setLeadOutcome("x1", "حلول تمويلية");
assert.ok(
  getLeads({ day: "financing_solutions" }).leads.some((r) => r.id === "x1"),
  "financing solutions tab"
);

setLeadManual("x1", true);
assert.ok(getLeads({ day: "manual" }).leads.some((r) => r.id === "x1"), "manual tab");
assert.ok(
  !getLeads({ day: "financing_solutions" }).leads.some((r) => r.id === "x1"),
  "manual hidden from outcome tabs"
);

setLeadRejected("x1", true);
assert.ok(getLeads({ day: "rejected" }).leads.some((r) => r.id === "x1"), "rejected tab");

const created = upsertLeadByPhone("0555111222", { manual: true });
assert.equal(created.phone, "0555111222");
assert.ok(getLeads({ day: "manual" }).leads.some((r) => r.phone === "0555111222"), "add manual phone");

const counts = getLeads({ day: "all", limit: 1 }).tabCounts;
assert.ok(counts.manual >= 1, "manual count");
assert.ok(counts.rejected >= 1, "rejected count");

console.log("smoke-raed-admin: OK");
