/**
 * الصفحة المنسوخة من لوحة رائد مربوطة بسجل ماجد
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "../public/admin.html"), "utf8");
assert.ok(html.includes("IBM Plex Sans Arabic"), "Raed font");
assert.ok(html.includes("وش صار"), "outcome column");
assert.ok(html.includes("أخذ رابط التمويل"), "finance_link tab");
assert.ok(html.includes("لم تُرسل متابعة"), "follow-up filter");
assert.ok(html.includes("عملاء ماجد") || html.includes(">ماجد<"), "Majed branding");
assert.ok(!html.includes("رائد الحربي"), "no Raed name");
assert.ok(html.includes("/admin/api"), "Raed API paths");
assert.ok(html.includes("متابعة جماعية"), "bulk follow-up card");

process.env.CUSTOMERS_DATA_DIR = fs.mkdtempSync(
  path.join(require("os").tmpdir(), "majed-raed-")
);
const {
  requireLeadByPhone,
  LEADS_PATH,
  DATA_DIR,
} = require("../lib/customer-leads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(
  LEADS_PATH,
  JSON.stringify({
    leads: [
      {
        id: "x1",
        phone: "0555000111",
        at: new Date().toISOString(),
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
console.log("smoke-raed-admin: OK");
