/**
 * إرسال المتابعة من لوحة التحكم — نص حر داخل 24 ساعة أو قالب إنترأكت خارجها
 */
const CONFIG = require("../config");
const leads = require("./customer-leads");
const interakt = require("./interakt-client");
const menus = require("./menus");

let bulkJob = emptyJob();

function emptyJob() {
  return {
    running: false,
    queued: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    results: [],
    startedAt: null,
    finishedAt: null,
    via: null,
    lastPhone: null,
    lastError: null,
    error: null,
    hint: null,
  };
}

function getBulkJob() {
  return { ...bulkJob, results: (bulkJob.results || []).slice(-200) };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultMessage(kind) {
  if (kind === "ask-plus" || kind === "plus") {
    return String(CONFIG.followUp?.plusMessage || "").trim();
  }
  return String(CONFIG.followUp?.electronicMessage || "").trim();
}

function listTargets(fromOutcome) {
  const packDay =
    fromOutcome === "finance_link_plus"
      ? "finance_link_sent"
      : fromOutcome === "finance_link_plus_list"
        ? "finance_link_plus"
        : "finance_link_pending";
  return (leads.getLeads({ day: packDay, limit: 500 }).leads || []).slice();
}

function filterByWindow(rows, via) {
  if (via === "interakt") return rows.filter((r) => !leads.withinWhatsAppWindow(r));
  return rows.filter((r) => leads.withinWhatsAppWindow(r));
}

function csvForOutsideWindow() {
  const rows = filterByWindow(listTargets("finance_link"), "interakt");
  const lines = ["countryCode,phoneNumber"];
  const seen = new Set();
  for (const row of rows) {
    let phone = String(row.phone || "").replace(/\D/g, "").replace(/^0+/, "");
    if (phone.startsWith("966") && phone.length > 9) phone = phone.slice(3);
    if (!/^5\d{8}$/.test(phone) || seen.has(phone)) continue;
    seen.add(phone);
    lines.push(`+966,${phone}`);
  }
  return {
    ok: true,
    count: lines.length - 1,
    csv: `${lines.join("\n")}\n`,
    filename: "followup-outside-24h.csv",
  };
}

async function deliverMessage(phone, message, { via, templateName, bodyValues, lead } = {}) {
  if (via === "interakt") {
    if (!interakt.isConfigured()) {
      throw new Error("INTERAKT_API_KEY غير مضبوط");
    }
    const data = await interakt.sendNamedTemplate(phone, templateName, bodyValues);
    return { ok: true, interakt: { id: data?.id || data?.result?.id || null } };
  }
  if (interakt.isConfigured()) {
    const data = await interakt.sendWhatsAppTextViaInterakt(phone, message, "admin_followup");
    return { ok: true, interakt: { id: data?.data?.id || null } };
  }
  const outbound = require("./outbound-wa-queue");
  const waAccountId = lead?.waAccountId || "majed";
  if (!waAccountId) throw new Error("لا يوجد جوال بوت مربوط لهذا العميل");
  outbound.enqueue({
    waAccountId,
    phone,
    message,
    leadId: lead?.id,
  });
  return { ok: true, queued: true };
}

function markAfterSend(lead, { plus, message, via }) {
  if (!lead?.id) return;
  leads.markLeadFollowupSent(lead.id, message, {
    plus: Boolean(plus),
    mode: via === "interakt" ? "interakt" : "text",
  });
}

async function sendOneFollowup({ phone, kind, message }) {
  const lead = leads.requireLeadByPhone(phone);
  const plus = kind === "ask-plus" || kind === "plus";
  const text = String(message || "").trim() || defaultMessage(plus ? "plus" : "order");
  if (!text) throw new Error("نص الرسالة مطلوب");
  const result = await deliverMessage(lead.phone, text, { lead });
  markAfterSend(lead, { plus, message: text, via: "text" });
  return { ok: true, ...result, plus };
}

async function sendMenu(phone) {
  const lead = leads.requireLeadByPhone(phone);
  if (interakt.isConfigured()) {
    await interakt.sendInteractiveViaInterakt(lead.phone, menus.inquiryMain());
    leads.appendLeadEvent(lead.id, {
      type: "outbound",
      at: new Date().toISOString(),
      text: "قائمة الخيارات",
      mode: "menu",
    });
    return { ok: true, queued: 1 };
  }
  const outbound = require("./outbound-wa-queue");
  if (!lead.waAccountId) {
    return { ok: true, queued: 0, hint: "لا يوجد جوال بوت مربوط لهذا العميل" };
  }
  outbound.enqueue({
    waAccountId: lead.waAccountId,
    phone: lead.phone,
    message: "مرحبا",
    leadId: lead.id,
  });
  return { ok: true, queued: 1 };
}

function startBulkFollowup(options = {}) {
  if (bulkJob.running) {
    return { ok: true, started: true, queued: bulkJob.queued, bulkJob: getBulkJob(), pollMs: 2500 };
  }

  const fromOutcome = String(options.fromOutcome || "finance_link").trim();
  const via = options.via === "interakt" ? "interakt" : "";
  const plus =
    fromOutcome === "finance_link_plus" || fromOutcome === "finance_link_plus_list";
  const message =
    String(options.message || "").trim() || defaultMessage(plus ? "plus" : "order");
  if (via !== "interakt" && !message) {
    throw new Error("نص الرسالة مطلوب");
  }
  if (via === "interakt" && !String(options.templateName || "").trim()) {
    throw new Error("كود قالب إنترأكت مطلوب");
  }

  const delayMs = Math.max(Number(options.delayMs) || 8000, 8000);
  const candidates = filterByWindow(listTargets(fromOutcome), via || "text");
  const safe = leads.getFollowUpSafeSettings();
  const remaining = safe.dailyRemaining;
  if (remaining <= 0) {
    throw new Error(`استُنفدت الحصة اليومية (${safe.dailyLimit}) — حاول غداً`);
  }
  const maxBatch = Math.min(
    Math.max(Number(options.limit) || candidates.length || 1, 1),
    Math.max(safe.maxBatchSize, 1),
    remaining,
    250
  );
  const take = candidates.slice(0, maxBatch);
  const deferred = Math.max(candidates.length - take.length, 0);

  bulkJob = {
    ...emptyJob(),
    running: true,
    queued: take.length,
    deferred,
    startedAt: new Date().toISOString(),
    via: via || "text",
    hint: take.length ? null : "ما فيه أحد داخل/خارج النافذة حسب نوع الإرسال",
  };

  const bodyValues = options.bodyValues;
  const templateName = options.templateName;

  const run = async () => {
    try {
      for (const lead of take) {
        if (!bulkJob.running) break;
        try {
          const result = await deliverMessage(lead.phone, message, {
            via,
            templateName,
            bodyValues,
            lead,
          });
          markAfterSend(lead, { plus, message, via });
          try {
            leads.addFollowUpQuota(1);
          } catch (_) {}
          bulkJob.sent += 1;
          bulkJob.lastPhone = lead.phone;
          bulkJob.results.push({ phone: String(lead.phone || "").replace(/\D/g, ""), ok: true, ...result });
        } catch (err) {
          bulkJob.failed += 1;
          bulkJob.lastPhone = lead.phone;
          bulkJob.lastError = err.message;
          bulkJob.results.push({
            phone: String(lead.phone || "").replace(/\D/g, ""),
            ok: false,
            error: err.message,
          });
        }
        if (take.indexOf(lead) < take.length - 1) await sleep(delayMs);
      }
    } catch (err) {
      bulkJob.error = err.message;
    } finally {
      bulkJob.running = false;
      bulkJob.finishedAt = new Date().toISOString();
    }
  };

  run().catch((err) => {
    bulkJob.running = false;
    bulkJob.error = err.message;
    bulkJob.finishedAt = new Date().toISOString();
  });
  return {
    ok: true,
    started: true,
    queued: take.length,
    deferred,
    pollMs: 2500,
    bulkJob: getBulkJob(),
  };
}

module.exports = {
  getBulkJob,
  startBulkFollowup,
  sendOneFollowup,
  sendMenu,
  csvForOutsideWindow,
  defaultMessage,
};
