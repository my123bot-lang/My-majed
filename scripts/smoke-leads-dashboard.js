/**
 * اختبار لوحة العملاء: تبويبات، وش صار، شارات المتابعة، أرشيف، بكب
 */
process.env.CUSTOMERS_DATA_DIR = require("fs").mkdtempSync(
  require("path").join(require("os").tmpdir(), "majed-leads-")
);

const assert = require("assert");
const fs = require("fs");
const {
  inferOutcomeId,
  resolveWorkplaceId,
  followupStatusOf,
  matchesCrmDay,
  computeTabCounts,
  decorateCrmLead,
  getLeads,
  setLeadOutcome,
  setLeadWorkplace,
  setLeadArchived,
  exportLeadsBackup,
  importLeadsBackup,
  listElectronicFollowUpCandidates,
  DATA_DIR,
  LEADS_PATH,
} = require("../lib/customer-leads");

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

ok(DATA_DIR.includes("majed-leads-"), "uses temp CUSTOMERS_DATA_DIR");

const today = new Date().toISOString();
const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
const oldFollow = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
const recentFollow = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

ok(
  inferOutcomeId({ applicationMethod: "electronic" }) === "finance_link",
  "electronic → أخذ رابط التمويل"
);
ok(inferOutcomeId({ comboPackage: true }) === "package", "combo → باقة");
ok(
  inferOutcomeId({ status: "service_stop" }) === "service_stop",
  "service_stop outcome"
);
ok(
  inferOutcomeId({ applicationOrderNumber: "10112345" }) === "order_number",
  "order number wins"
);
ok(resolveWorkplaceId({ jobCategory: "military" }) === "military", "military workplace");
ok(
  resolveWorkplaceId({ jobCategory: "civilian", civilianSector: "government" }) ===
    "government",
  "gov workplace"
);

const pending = followupStatusOf({});
ok(!pending.sent && pending.label === "لم تُرسل متابعة", "badge: لم تُرسل متابعة");

const done = followupStatusOf({ followUpSentAt: recentFollow });
ok(done.sent && done.recent && done.label === "تمت المتابعة", "badge: تمت المتابعة");

const previous = followupStatusOf({ followUpSentAt: oldFollow });
ok(previous.sent && !previous.recent && previous.label === "متابعة سابقة", "badge: متابعة سابقة");

const queued = followupStatusOf({
  followUpQueue: { status: "pending", createdAt: today },
});
ok(queued.pending && queued.label === "في الطابور", "badge: في الطابور");

const sample = [
  {
    id: "a",
    phone: "0500000001",
    at: today,
    applicationMethod: "electronic",
    waAccountId: "majed",
  },
  {
    id: "b",
    phone: "0500000002",
    at: yesterday,
    comboPackage: true,
    waAccountId: "majed",
  },
  {
    id: "c",
    phone: "0500000003",
    at: today,
    status: "service_stop",
    archived: true,
    waAccountId: "majed",
  },
];
const counts = computeTabCounts(sample);
ok(counts.today === 1, `today count=${counts.today}`);
ok(counts.package === 1, `package count=${counts.package}`);
ok(counts.archive === 1, `archive count=${counts.archive}`);
ok(counts.all === 2, `all (non-archive) count=${counts.all}`);
ok(matchesCrmDay(sample[0], "finance_link"), "today electronic matches finance_link tab");
ok(matchesCrmDay(sample[2], "archive"), "archived matches archive tab");
ok(!matchesCrmDay(sample[2], "today"), "archived excluded from today");

const decorated = decorateCrmLead(sample[0]);
ok(decorated.outcome === "finance_link", "decorate outcome");
ok(decorated.followUpStatus.label === "لم تُرسل متابعة", "decorate follow-up badge");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(
  LEADS_PATH,
  JSON.stringify(
    {
      updatedAt: today,
      leads: [
        {
          id: "lead-1",
          phone: "0555111000",
          at: today,
          date: today.slice(0, 10),
          waAccountId: "majed",
          waAccountLabel: "ماجد",
          applicationMethod: "electronic",
          contactDelivery: "electronic_link",
          status: "personal_finance",
          statusLabel: "تمويل شخصي",
        },
        {
          id: "lead-2",
          phone: "0555111001",
          at: yesterday,
          waAccountId: "majed",
          comboPackage: true,
          status: "combo_offer",
          statusLabel: "مؤهل — أخذ عرض بديل",
        },
        {
          id: "lead-3",
          phone: "0555111002",
          at: today,
          waAccountId: "majed",
          applicationMethod: "electronic",
          followUpSentAt: recentFollow,
          status: "personal_finance",
        },
      ],
    },
    null,
    2
  ),
  "utf8"
);

const todayPack = getLeads({ day: "today", limit: 50 });
ok(todayPack.ok, "getLeads today ok");
ok(todayPack.tabCounts.finance_link >= 1, "tabCounts finance_link");
ok(
  todayPack.leads.every((r) => r.followUpStatus && r.followUpStatus.label),
  "each lead has follow-up badge"
);

const financePack = getLeads({ day: "finance_link" });
ok(
  financePack.leads.every((r) => r.outcome === "finance_link"),
  "finance_link tab filters outcome"
);

const pendingPack = getLeads({ day: "finance_link", followupFilter: "pending" });
ok(
  pendingPack.leads.every((r) => !r.followUpStatus.sent),
  "pending follow-up filter"
);
ok(
  pendingPack.leads.some((r) => r.phone === "0555111000"),
  "unsent electronic included in pending"
);

const phones = getLeads({ day: "today", phonesOnly: true });
ok(Array.isArray(phones.phones) && phones.count >= 1, "phonesOnly today");

const updated = setLeadOutcome("lead-1", "limit_exhausted");
ok(updated.outcome === "limit_exhausted", "set outcome وش صار");
ok(getLeads({ day: "limit_exhausted" }).leads.some((r) => r.id === "lead-1"), "limit_exhausted tab");

const work = setLeadWorkplace("lead-1", "government");
ok(work.workplace === "government", "set workplace حكومي");

setLeadArchived("lead-2", true);
ok(getLeads({ day: "archive" }).leads.some((r) => r.id === "lead-2"), "archive tab");
ok(!getLeads({ day: "package" }).leads.some((r) => r.id === "lead-2"), "archived hidden from package");

const backup = exportLeadsBackup();
ok(backup.leads.length >= 3, "export backup");
const imported = importLeadsBackup({
  leads: [
    {
      id: "lead-new",
      phone: "0555999888",
      at: today,
      waAccountId: "majed",
      applicationMethod: "electronic",
    },
  ],
});
ok(imported.imported === 1, `import created=${imported.imported}`);

const candidates = listElectronicFollowUpCandidates({ onlyUnsent: true });
ok(
  candidates.some((r) => r.id === "lead-new"),
  "bulk candidates include new finance_link"
);
ok(
  !candidates.some((r) => r.id === "lead-3"),
  "bulk skips recently followed"
);

console.log("smoke-leads-dashboard: all ok");
