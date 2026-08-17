/**
 * واجهة لوحة رائد — نفس مسارات /admin/api حتى تعمل الصفحة المنسوخة كما هي
 */
const express = require("express");
const CONFIG = require("../config");
const {
  getLeads,
  setLeadOutcome,
  setLeadWorkplace,
  setLeadArchived,
  setLeadStatusNote,
  setLeadOrderNumber,
  exportLeadsBackup,
  writeLeadsBackupCopy,
  importLeadsBackup,
  getFollowUpSafeSettings,
  getPersistenceInfo,
  queueElectronicFollowUp,
  requireLeadByPhone,
  resolveWorkplaceId,
  resolveWaAccountForOpenChat,
} = require("../lib/customer-leads");
const { setPausedByPhone, isPausedByPhone } = require("../lib/owner-chat-control");

const router = express.Router();

function toRaedCustomer(row) {
  const workplace = row.workplace || resolveWorkplaceId(row);
  let jobCategory = row.jobCategory || null;
  let civilianSubtype = row.civilianSector || null;
  if (workplace === "military") jobCategory = "military";
  if (workplace === "government") {
    jobCategory = "civilian";
    civilianSubtype = "government";
  }
  if (workplace === "private") {
    jobCategory = "civilian";
    civilianSubtype = "private";
  }
  const paused = isPausedByPhone(row.phone, row.waAccountId || null);
  let phone = String(row.phone || "").replace(/\D/g, "");
  if (phone.startsWith("966")) phone = phone.slice(3);
  if (phone.startsWith("5") && phone.length === 9) phone = "0" + phone;
  return {
    phone: phone || row.phone,
    lastInboundAt: row.at || null,
    lastSeenAt: row.at || null,
    firstSeenAt: row.at || null,
    syncedAt: row.at || null,
    jobCategory,
    civilianSubtype,
    companyName: row.employerCompany || null,
    orderNumber: row.applicationOrderNumber || "",
    outcome: row.outcomeLabel || "",
    notes: row.orderStatusNote || "",
    paused: Boolean(paused),
    archived: Boolean(row.archived),
    lastOutboundPreview: row.followUpMessage || "",
    lastOutboundAt: row.followUpSentAt || null,
    id: row.id,
    waAccountId: row.waAccountId || null,
    countryCode: "+966",
  };
}

function tabCountsFromPack(pack) {
  const c = pack.tabCounts || pack.counts || {};
  return {
    today: c.today || 0,
    yesterday: c.yesterday || 0,
    all: c.all || 0,
    finance_link: c.finance_link || 0,
    order_number: c.order_number || 0,
    package: c.package || 0,
    limit_exhausted: c.limit_exhausted || 0,
    service_stop: c.service_stop || 0,
    archive: c.archive || 0,
    customersToday: c.today || 0,
    customersYesterday: c.yesterday || 0,
    customersAll: c.all || 0,
    customersArchive: c.archive || 0,
    customersFinanceLink: c.finance_link || 0,
    customersOrderNumber: c.order_number || 0,
    customersPackage: c.package || 0,
    customersLimitExhausted: c.limit_exhausted || 0,
    customersServiceStop: c.service_stop || 0,
  };
}

router.get("/status", (_req, res) => {
  const pack = getLeads({ day: "all", limit: 1 });
  const persistence = pack.persistence || getPersistenceInfo(pack.total);
  res.json({
    ok: true,
    persistence,
    counts: tabCountsFromPack(pack),
    outboundSafe: pack.outboundSafe || getFollowUpSafeSettings(),
    followUpPreview: pack.followUpPreview || CONFIG.followUp?.electronicMessage || "",
    outboundDelayMs: pack.outboundSafe?.delayMs || CONFIG.followUp?.minDelayMs || 8000,
  });
});

router.get("/customers", (req, res) => {
  try {
    const day = String(req.query.day || "today").trim();
    const phonesOnly = req.query.phonesOnly === "1" || req.query.phonesOnly === "true";
    const pack = getLeads({
      day,
      limit: req.query.limit,
      offset: req.query.offset,
      phonesOnly,
    });
    const counts = tabCountsFromPack(pack);
    if (phonesOnly) {
      return res.json({
        ok: true,
        day,
        count: pack.count,
        phones: pack.phones || [],
        counts,
      });
    }
    res.json({
      ok: true,
      day: pack.day || day,
      timezone: pack.timezone || "Asia/Riyadh",
      count: pack.total,
      hasMore: pack.hasMore,
      customers: (pack.leads || []).map(toRaedCustomer),
      counts,
      persistence: pack.persistence,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/workplace", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.body?.phone);
    const leadOut = setLeadWorkplace(lead.id, req.body?.workplace);
    res.json({ ok: true, lead: leadOut });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/outcome", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.body?.phone);
    const leadOut = setLeadOutcome(lead.id, req.body?.outcome);
    res.json({ ok: true, lead: leadOut });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/notes", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.body?.notesPhone || req.body?.phone);
    const leadOut = setLeadStatusNote(lead.id, req.body?.notes);
    res.json({ ok: true, lead: leadOut });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/order-number", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.body?.phone);
    const leadOut = setLeadOrderNumber(lead.id, req.body?.orderNumber);
    res.json({ ok: true, lead: leadOut });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/archive", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.body?.phone);
    const leadOut = setLeadArchived(lead.id, req.body?.archived !== false);
    res.json({ ok: true, lead: leadOut });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get("/customers/export", (_req, res) => {
  try {
    const backup = exportLeadsBackup();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="customers-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/customers/backup", (_req, res) => {
  try {
    res.json(writeLeadsBackupCopy());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/customers/import", (req, res) => {
  try {
    const payload = req.body || {};
    const incoming = Array.isArray(payload.customers)
      ? payload.customers.map((c) => ({
          phone: c.phone,
          at: c.at || c.lastInboundAt || c.firstSeenAt || new Date().toISOString(),
          applicationOrderNumber: c.orderNumber || c.applicationOrderNumber || null,
          orderStatusNote: c.notes || c.orderStatusNote || null,
          outcome: c.outcome || null,
          archived: Boolean(c.archived),
          jobCategory: c.jobCategory || null,
          civilianSector: c.civilianSubtype || c.civilianSector || null,
          employerCompany: c.companyName || c.employerCompany || null,
          followUpSentAt: c.lastOutboundAt || c.followUpSentAt || null,
          followUpMessage: c.lastOutboundPreview || c.followUpMessage || null,
        }))
      : payload.leads;
    res.json(importLeadsBackup(incoming ? { leads: incoming } : payload));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/sync-interakt", (_req, res) => {
  const pack = getLeads({ day: "all", limit: 1 });
  res.json({
    ok: true,
    fetched: 0,
    created: 0,
    updated: 0,
    saved: { ok: true },
    persistence: pack.persistence,
    preferDay: pack.tabCounts?.today ? "today" : "all",
    hint: "عملاء ماجد يُسجَّلون تلقائياً من المحادثات. استخدم البكب للاستيراد.",
  });
});

router.post("/send-followup", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.body?.phone);
    const message =
      String(req.body?.message || "").trim() ||
      CONFIG.followUp?.electronicMessage ||
      "";
    const result = queueElectronicFollowUp({
      message,
      leadId: lead.id,
      onlyUnsent: false,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/bulk-followup", (req, res) => {
  try {
    const body = req.body || {};
    const message =
      String(body.message || "").trim() || CONFIG.followUp?.electronicMessage || "";
    const result = queueElectronicFollowUp({
      message,
      delayMs: body.delayMs,
      limit: body.limit,
      onlyUnsent: true,
    });
    res.json({
      ok: true,
      sent: result.queued || result.sent || 0,
      failed: result.failed || 0,
      skipped: result.skipped || 0,
      dailyRemaining: result.dailyRemaining,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/pause", (req, res) => {
  try {
    const phone = req.body?.phone;
    const { waAccountId } = resolveWaAccountForOpenChat(phone, {
      waAccountId: req.body?.waAccountId,
    });
    setPausedByPhone(phone, true, { waAccountId });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/resume", (req, res) => {
  try {
    const phone = req.body?.phone;
    const { waAccountId } = resolveWaAccountForOpenChat(phone, {
      waAccountId: req.body?.waAccountId,
    });
    setPausedByPhone(phone, false, { waAccountId });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/reset", (req, res) => {
  try {
    const phone = req.body?.phone;
    const session = require("../lib/session");
    session.clearSessionsMatching(phone);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/send-menu", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.body?.phone);
    const message = "مرحبا";
    if (!lead.waAccountId) {
      return res.json({ ok: true, queued: 0, hint: "لا يوجد جوال بوت مربوط لهذا العميل" });
    }
    const outbound = require("../lib/outbound-wa-queue");
    outbound.enqueue({
      waAccountId: lead.waAccountId,
      phone: lead.phone,
      message,
      leadId: lead.id,
    });
    res.json({ ok: true, queued: 1 });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
