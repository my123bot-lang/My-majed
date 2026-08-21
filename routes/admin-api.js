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
  setLeadManual,
  setLeadRejected,
  setLeadFollowupPlus,
  setLeadStatusNote,
  setLeadOrderNumber,
  exportLeadsBackup,
  writeLeadsBackupCopy,
  importLeadsBackup,
  getFollowUpSafeSettings,
  getPersistenceInfo,
  requireLeadByPhone,
  findLeadByPhone,
  upsertLeadByPhone,
  resolveWorkplaceId,
  resolveWaAccountForOpenChat,
} = require("../lib/customer-leads");
const { setPausedByPhone, isPausedByPhone } = require("../lib/owner-chat-control");
const followup = require("../lib/admin-followup");
const { findSessionByPhone } = require("../lib/session");

const router = express.Router();

function toRaedCustomer(row, { withLive = false } = {}) {
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
  const customer = {
    phone: phone || row.phone,
    lastInboundAt: row.lastInboundAt || row.at || null,
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
    manual: Boolean(row.manual),
    rejected: Boolean(row.rejected),
    followupPlus: Boolean(row.followupPlus),
    followupSent: Boolean(row.followupSent),
    lastOutboundPreview: row.followUpMessage || row.lastOutboundPreview || "",
    lastOutboundAt: row.followUpSentAt || row.lastOutboundAt || null,
    lastInboundText: row.lastInboundText || "",
    events: Array.isArray(row.events) ? row.events : [],
    flow: row.flow || row.inquiryType || "",
    step: row.step || "",
    maxAmount: row.maxAmount ?? row.amount ?? null,
    id: row.id,
    waAccountId: row.waAccountId || null,
    countryCode: "+966",
  };
  if (withLive) {
    const live = findSessionByPhone(row.phone);
    if (live?.session) {
      customer.live = {
        draft: {
          flow: live.session.flow || live.session.inquiryType || "",
          step: live.session.step || "",
        },
        session: {
          maxAmount:
            live.session.roundedAmount ??
            live.session.selectedAmount ??
            live.session.maxAmount ??
            null,
        },
      };
      customer.flow = customer.flow || live.session.flow || live.session.inquiryType || "";
      customer.step = customer.step || live.session.step || "";
      if (customer.maxAmount == null) {
        customer.maxAmount =
          live.session.roundedAmount ?? live.session.selectedAmount ?? null;
      }
    }
  }
  return customer;
}

function tabCountsFromPack(pack) {
  const c = pack.tabCounts || pack.counts || {};
  return {
    today: c.today || 0,
    yesterday: c.yesterday || 0,
    all: c.all || 0,
    finance_link: c.finance_link || 0,
    finance_link_pending: c.finance_link_pending || 0,
    finance_link_sent: c.finance_link_sent || 0,
    finance_link_plus: c.finance_link_plus || 0,
    order_number: c.order_number || 0,
    package: c.package || 0,
    limit_exhausted: c.limit_exhausted || 0,
    service_stop: c.service_stop || 0,
    financing_solutions: c.financing_solutions || 0,
    archive: c.archive || 0,
    manual: c.manual || 0,
    rejected: c.rejected || 0,
    customersToday: c.today || 0,
    customersYesterday: c.yesterday || 0,
    customersAll: c.all || 0,
    customersArchive: c.archive || 0,
    customersFinanceLink: c.finance_link || 0,
    customersFinanceLinkPending: c.finance_link_pending || 0,
    customersFinanceLinkSent: c.finance_link_sent || 0,
    customersFinanceLinkPlus: c.finance_link_plus || 0,
    customersOrderNumber: c.order_number || 0,
    customersPackage: c.package || 0,
    customersLimitExhausted: c.limit_exhausted || 0,
    customersServiceStop: c.service_stop || 0,
    customersFinancingSolutions: c.financing_solutions || 0,
    customersManual: c.manual || 0,
    customersRejected: c.rejected || 0,
  };
}

function requireOrCreate(phone, patch = {}) {
  const existing = findLeadByPhone(phone);
  if (existing) {
    const id = existing.id;
    if (patch.manual != null) return setLeadManual(id, patch.manual);
    if (patch.rejected != null) return setLeadRejected(id, patch.rejected);
    if (patch.followupPlus != null) return setLeadFollowupPlus(id, patch.followupPlus);
    return existing;
  }
  return upsertLeadByPhone(phone, patch);
}

router.get("/debug/last-webhook", (_req, res) => {
  const fs = require("fs");
  function readJsonSafe(p) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) {
      return null;
    }
  }
  res.json({
    ok: true,
    lastInbound: readJsonSafe("/tmp/interakt-last-inbound.json"),
    lastOutbound: readJsonSafe("/tmp/interakt-last-outbound.json"),
    serverNow: new Date().toISOString(),
  });
});

router.get("/debug/session", (req, res) => {
  const phone = String(req.query?.phone || "").trim();
  const { sessions, isClosed, getClosedState } = require("../lib/session");
  const { digitsOnly } = require("../lib/contact-phone");
  const needle = digitsOnly(phone).replace(/^966/, "").replace(/^0+/, "");
  const matches = [];
  for (const [chatId, session] of Object.entries(sessions)) {
    const d = digitsOnly(chatId).replace(/^966/, "").replace(/^0+/, "");
    if (!needle || d.endsWith(needle) || needle.endsWith(d)) {
      matches.push({ chatId, session });
    }
  }
  const closedMatches = [];
  const { isPausedByPhone } = require("../lib/owner-chat-control");
  res.json({
    ok: true,
    phone,
    sessionCount: Object.keys(sessions).length,
    matches,
    isClosed: isClosed(`${needle}@c.us`),
    closedState: getClosedState(`${needle}@c.us`),
    paused: isPausedByPhone(phone, null),
  });
});

router.get("/status", (_req, res) => {
  const pack = getLeads({ day: "all", limit: 1 });
  const persistence = pack.persistence || getPersistenceInfo(pack.total);
  res.json({
    ok: true,
    persistence,
    counts: tabCountsFromPack(pack),
    outboundSafe: pack.outboundSafe || getFollowUpSafeSettings(),
    followUpPreview: pack.followUpPreview || CONFIG.followUp?.electronicMessage || "",
    followUpPlusPreview: CONFIG.followUp?.plusMessage || "",
    followUpTemplate: { name: process.env.INTERAKT_FOLLOWUP_TEMPLATE || "" },
    outboundDelayMs: pack.outboundSafe?.delayMs || CONFIG.followUp?.minDelayMs || 8000,
    bulkJob: followup.getBulkJob(),
  });
});

router.get("/customers/lookup", (req, res) => {
  try {
    const lead = requireLeadByPhone(req.query?.phone);
    const decorated = getLeads({
      phoneSearch: lead.phone,
      limit: 1,
    }).leads?.[0] || lead;
    res.json({ ok: true, customer: toRaedCustomer(decorated, { withLive: true }) });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

router.get("/customers/search", (req, res) => {
  try {
    const pack = getLeads({
      phoneSearch: req.query?.phone || "",
      limit: 20,
    });
    res.json({
      ok: true,
      customers: (pack.leads || []).map((row) => toRaedCustomer(row)),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get("/customers/followup-template-csv", (_req, res) => {
  try {
    res.json(followup.csvForOutsideWindow());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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
      customers: (pack.leads || []).map((row) => toRaedCustomer(row)),
      counts,
      persistence: pack.persistence,
      today: pack.today || undefined,
      yesterday: pack.yesterday || undefined,
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

router.post("/customers/manual", (req, res) => {
  try {
    const leadOut = requireOrCreate(req.body?.phone, { manual: req.body?.manual !== false });
    const patched = setLeadManual(leadOut.id, req.body?.manual !== false);
    res.json({ ok: true, lead: patched });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/rejected", (req, res) => {
  try {
    const leadOut = requireOrCreate(req.body?.phone, { rejected: req.body?.rejected !== false });
    const patched = setLeadRejected(leadOut.id, req.body?.rejected !== false);
    res.json({ ok: true, lead: patched });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/customers/followup-plus", (req, res) => {
  try {
    const leadOut = requireOrCreate(req.body?.phone, {
      followupPlus: req.body?.plus !== false,
      followupSent: true,
      outcome: "finance_link",
    });
    const patched = setLeadFollowupPlus(leadOut.id, req.body?.plus !== false);
    res.json({ ok: true, lead: patched });
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
          manual: Boolean(c.manual),
          rejected: Boolean(c.rejected),
          followupPlus: Boolean(c.followupPlus),
          followupSent: Boolean(c.followupSent),
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

router.post("/customers/sync-interakt", async (req, res) => {
  try {
    const interakt = require("../lib/interakt-client");
    if (!interakt.isConfigured()) {
      return res.status(400).json({
        ok: false,
        error: "INTERAKT_API_KEY غير مضبوط على Render",
      });
    }
    const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 3650);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const noFilter = req.body?.noFilter === true;
    const debug = req.body?.debug === true;
    const incoming = [];
    let offset = 0;
    let fetched = 0;
    let firstRaw = null;
    for (let page = 0; page < 200; page++) {
      const pack = await interakt.listUsersPage({
        offset,
        limit: 100,
        sinceIso: noFilter ? null : since,
      });
      if (debug && firstRaw == null) firstRaw = pack.raw;
      fetched += pack.users.length;
      for (const user of pack.users) {
        const phone =
          user.phoneNumber ||
          user.phone_number ||
          user.phone ||
          user.traits?.phone ||
          user.traits?.phoneNumber ||
          "";
        const country = user.countryCode || user.country_code || user.traits?.countryCode || "+966";
        const at =
          user.created_at_utc ||
          user.createdAt ||
          user.traits?.created_at_utc ||
          new Date().toISOString();
        incoming.push({
          phone: `${country}${phone}`,
          at,
          lastInboundAt: at,
          waAccountId: "majed",
          waAccountLabel: "ماجد",
        });
      }
      if (!pack.hasNext || !pack.users.length) break;
      offset += 100;
    }
    const imported = incoming.length
      ? importLeadsBackup({ leads: incoming })
      : { ok: true, imported: 0, updated: 0, total: 0, persistence: getPersistenceInfo(0) };
    const pack = getLeads({ day: "all", limit: 1 });
    res.json({
      ok: true,
      fetched,
      created: imported.imported || 0,
      updated: imported.updated || 0,
      saved: { ok: true },
      persistence: imported.persistence || pack.persistence,
      preferDay: pack.tabCounts?.today ? "today" : "all",
      hint: incoming.length
        ? "الأرقام رجعت من إنترأكت. الملاحظات و«وش صار» ما ترجع إلا من ملف بكب."
        : "ما لقينا أرقام في إنترأكت لهذه الفترة.",
      ...(debug ? { debugRaw: firstRaw } : {}),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/send-followup", async (req, res) => {
  try {
    const result = await followup.sendOneFollowup({
      phone: req.body?.phone,
      kind: req.body?.kind,
      message: req.body?.message,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/bulk-followup", (req, res) => {
  try {
    const body = req.body || {};
    const result = followup.startBulkFollowup({
      fromOutcome: body.fromOutcome,
      via: body.via,
      message: body.message,
      delayMs: body.delayMs,
      limit: body.limit,
      templateName: body.templateName,
      bodyValues: body.bodyValues,
      fromList: body.fromList,
    });
    res.json({
      ok: true,
      sent: result.queued || 0,
      started: result.started,
      queued: result.queued,
      failed: 0,
      skipped: 0,
      deferred: result.deferred,
      pollMs: result.pollMs,
      bulkJob: result.bulkJob,
      dailyRemaining: getFollowUpSafeSettings().dailyRemaining,
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

router.post("/send-menu", async (req, res) => {
  try {
    const result = await followup.sendMenu(req.body?.phone);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
