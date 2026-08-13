/**
 * سجل العملاء — رقم الجوال + حالة (تمويل شخصي | مرفوض | عقاري | …) + تفاصيل
 * data/customer-leads.json
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LEADS_PATH = path.join(DATA_DIR, "customer-leads.json");
const MAX_LEADS = 3000;

const STATUS_LABELS = {
  qualified: "مؤهل",
  personal_finance: "تمويل شخصي",
  rejected: "مرفوض",
  property: "عقاري",
  service_stop: "إيقاف خدمات",
  combo_offer: "مؤهل — أخذ عرض بديل",
};

const JOB_CATEGORY_LABELS = {
  military: "عسكري",
  civilian: "مدني",
  retired: "متقاعد",
};

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const {
  phoneFromChatId,
  normalizeSaudiDisplay,
  digitsOnly,
  phoneToWhatsAppDigits,
} = require("./contact-phone");
const { getCurrentWaAccountId, setCurrentWaAccountId } = require("./current-wa-account");
const waAccounts = require("./whatsapp-accounts-store");

/** سجلات قبل هذا التاريخ بدون وسْم → تُحسب لماجد */
const DUAL_WA_CUTOFF_ISO = "2026-06-02T08:00:00.000Z";

function resolveWaAccountMeta() {
  let id = getCurrentWaAccountId();
  if (!id && process.env.WA_ACCOUNT_ID) {
    id = String(process.env.WA_ACCOUNT_ID).trim();
    setCurrentWaAccountId(id);
  }
  if (!id) return { waAccountId: null, waAccountLabel: null };
  try {
    const acc = waAccounts.getAccountById(id);
    return { waAccountId: acc.id, waAccountLabel: acc.label };
  } catch (_) {
    return { waAccountId: id, waAccountLabel: id };
  }
}

function formatPhone(from, session) {
  if (session?.phoneDisplay) return session.phoneDisplay;

  const fromSession = normalizeSaudiDisplay(session?.whatsappNumber);
  if (fromSession) return fromSession;

  const fromChat = phoneFromChatId(from);
  if (fromChat) return fromChat;

  const raw = digitsOnly(
    typeof from === "string" ? from.split("@")[0] : ""
  );
  if (!raw) return "—";
  return normalizeSaudiDisplay(raw) || raw;
}

function isPersonalFinancingSession(session) {
  const inquiry = session?.inquiryType;
  const finance = session?.financeType;
  return (
    inquiry === "تمويل شخصي" ||
    finance === "شخصي" ||
    (!inquiry && !finance)
  );
}

function resolveStatus(session, event) {
  if (event === "rejected") {
    return { key: "rejected", label: STATUS_LABELS.rejected };
  }

  if (session?.comboPackage) {
    return { key: "combo_offer", label: STATUS_LABELS.combo_offer };
  }

  if (session?.inquiryType === "إيقاف خدمات") {
    if (event === "success" || event === "qualified") {
      return { key: "service_stop", label: STATUS_LABELS.service_stop };
    }
  }

  if (session?.financeType === "عقاري") {
    if (event === "success" || event === "qualified") {
      return { key: "property", label: STATUS_LABELS.property };
    }
  }

  if (event === "qualified" || event === "success") {
    if (isPersonalFinancingSession(session)) {
      return { key: "personal_finance", label: STATUS_LABELS.personal_finance };
    }
    return { key: "qualified", label: STATUS_LABELS.qualified };
  }

  return { key: "rejected", label: STATUS_LABELS.rejected };
}

function shouldStoreLead(session, event) {
  if (!session) return event === "rejected";
  const skip = ["ساعات الدوام", "موقعنا"];
  if (skip.includes(session.inquiryType) && event !== "rejected") return false;
  if (session.inquiryType === "إيقاف الرد الآلي") return false;
  return true;
}

function buildRecord(from, session, event) {
  const status = resolveStatus(session, event);
  const jobCategory = session?.jobCategory || null;
  const waMeta = resolveWaAccountMeta();

  let contactAgentName = session?.contactAgentName || null;
  let contactAgentPhone = session?.contactAgentPhone || null;
  let contactDelivery = session?.contactDelivery || null;

  if (session?.inquiryType === "إيقاف خدمات" && !contactAgentPhone) {
    const { loadSettingsForAccount } = require("./settings-store");
    const settings = loadSettingsForAccount(
      session?.waAccountId || waMeta.waAccountId || "majed"
    );
    contactAgentName = settings.serviceStopAgentName || contactAgentName;
    contactAgentPhone = settings.serviceStopAgentPhone || contactAgentPhone;
    contactDelivery = contactDelivery || "agent_direct";
  }

  return {
    id: newId(),
    waAccountId: waMeta.waAccountId,
    waAccountLabel: waMeta.waAccountLabel,
    phone: formatPhone(from, session),
    at: new Date().toISOString(),
    date: todayKey(),
    status: status.key,
    statusLabel: status.label,
    event,
    inquiryType: session?.inquiryType || null,
    financeType: session?.financeType || null,
    jobType: session?.jobType || null,
    sector: jobCategory ? JOB_CATEGORY_LABELS[jobCategory] || jobCategory : null,
    realEstate: session?.realEstateLabel || null,
    salary: session?.salary ?? session?.grossSalary ?? null,
    amount:
      session?.selectedAmount ??
      session?.roundedAmount ??
      session?.debtOffer?.amount ??
      null,
    loanTermYears: session?.loanTermYears ?? null,
    loanTermMonths: session?.loanTermMonths ?? null,
    comboPackage: Boolean(session?.comboPackage),
    applicationMethod: session?.applicationMethod || null,
    contactAgentName,
    contactAgentPhone,
    contactDelivery,
    portalUrl: session?.portalUrl || null,
    debtAmount: session?.debtPurchaseAmount ?? null,
    commitments:
      session?.flow === "debt_purchase"
        ? (session?.commitments ?? null)
        : null,
    applicationOrderNumber: session?.applicationOrderNumber || null,
    orderNumberAt: session?.orderNumberAt || null,
  };
}

function leadEligibleForOrderNumber(row) {
  if (!row) return false;
  if (resolveSubmissionType(row) === "electronic") return true;
  if (row.followUpSentAt) return true;
  if (row.contactDelivery === "electronic_link") return true;
  if (row.portalUrl) return true;
  return false;
}

function phoneMatchKey(phone) {
  const d = digitsOnly(phone);
  if (!d) return "";
  if (d.startsWith("9665") && d.length >= 12) return d.slice(-9);
  if (d.startsWith("05") && d.length === 10) return d.slice(-9);
  if (d.startsWith("5") && d.length === 9) return d;
  return d.length >= 9 ? d.slice(-9) : d;
}

function findLeadsForOrderNumber(phone, waAccountId) {
  const phoneKey = String(phone || "").trim();
  if (!phoneKey || phoneKey === "—") return [];

  const store = loadStore();
  const wa = String(waAccountId || "").trim();
  const key = phoneMatchKey(phoneKey);

  const matchRows = (requireWa) =>
    store.leads.filter((row) => {
      if (phoneMatchKey(row.phone) !== key) return false;
      if (requireWa && wa && row.waAccountId !== wa) return false;
      return leadEligibleForOrderNumber(row);
    });

  let rows = matchRows(true);
  if (!rows.length && wa) rows = matchRows(false);

  return rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

function findLeadForOrderNumber(phone, waAccountId) {
  const list = findLeadsForOrderNumber(phone, waAccountId);
  return list[0] || null;
}

/** دمج سجلات مكررة لنفس الجوال — عرض واحد في اللوحة */
function consolidateLeadsByPhone(leads) {
  const groups = new Map();

  for (const row of leads) {
    const key = `${row.waAccountId || ""}|${row.phone || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const merged = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    const primary = rows[0];
    const withOrder = rows.find((r) => r.applicationOrderNumber);
    const withFollowUp = rows.find((r) => r.followUpSentAt);

    const withNote = rows.find((r) => r.orderStatusNote);
    const withMark = rows
      .filter((r) => r.manualMark)
      .sort(
        (a, b) =>
          new Date(b.manualMarkAt || b.at || 0) - new Date(a.manualMarkAt || a.at || 0)
      )[0];

    merged.push({
      ...primary,
      applicationOrderNumber:
        withOrder?.applicationOrderNumber || primary.applicationOrderNumber,
      orderNumberAt: withOrder?.orderNumberAt || primary.orderNumberAt,
      orderStatusNote: withNote?.orderStatusNote || primary.orderStatusNote,
      orderStatusNoteAt: withNote?.orderStatusNoteAt || primary.orderStatusNoteAt,
      manualMark: withMark?.manualMark || primary.manualMark || null,
      manualMarkAt: withMark?.manualMarkAt || primary.manualMarkAt || null,
      followUpSentAt: withFollowUp?.followUpSentAt || primary.followUpSentAt,
      followUpMessage: withFollowUp?.followUpMessage || primary.followUpMessage,
      contactDelivery: primary.contactDelivery || rows.find((r) => r.contactDelivery)?.contactDelivery,
      portalUrl: primary.portalUrl || rows.find((r) => r.portalUrl)?.portalUrl,
      applicationMethod:
        primary.applicationMethod || rows.find((r) => r.applicationMethod)?.applicationMethod,
    });
  }

  return merged.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
}

function setLeadOrderNumber(leadId, orderNumber) {
  const { normalizeOrderNumber } = require("./order-number");
  const id = String(leadId || "").trim();
  let num = String(orderNumber || "").trim();
  if (!id) throw new Error("معرّف العميل مطلوب");

  if (num) {
    const normalized = normalizeOrderNumber(num);
    if (!normalized) {
      throw new Error("رقم الطلب يجب أن يبدأ بـ 101 (أرقام فقط)");
    }
    num = normalized;
  }

  const store = loadStore();
  const idx = store.leads.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("العميل غير موجود في السجل");

  const row = store.leads[idx];

  if (!num) {
    for (let i = 0; i < store.leads.length; i++) {
      if (
        store.leads[i].phone === row.phone &&
        store.leads[i].waAccountId === row.waAccountId
      ) {
        store.leads[i] = {
          ...store.leads[i],
          applicationOrderNumber: null,
          orderNumberAt: null,
        };
      }
    }
    saveStore(store);
    return store.leads[idx];
  }

  applyOrderNumberToEligibleLeads(row.phone, row.waAccountId, num);
  const refreshed = loadStore();
  const updated = refreshed.leads.find((r) => r.id === id);
  return updated || row;
}

const MAX_STATUS_NOTE_LEN = 2000;

function setLeadStatusNote(leadId, note) {
  const id = String(leadId || "").trim();
  const text = String(note || "")
    .trim()
    .slice(0, MAX_STATUS_NOTE_LEN);
  if (!id) throw new Error("معرّف العميل مطلوب");

  const store = loadStore();
  const idx = store.leads.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("العميل غير موجود في السجل");

  const row = store.leads[idx];
  const now = new Date().toISOString();

  for (let i = 0; i < store.leads.length; i++) {
    if (
      store.leads[i].phone === row.phone &&
      store.leads[i].waAccountId === row.waAccountId
    ) {
      store.leads[i] = {
        ...store.leads[i],
        orderStatusNote: text || null,
        orderStatusNoteAt: text ? now : null,
      };
    }
  }
  saveStore(store);
  return store.leads.find((r) => r.id === id) || row;
}

/** علامة يدوية: done · rejected · waiting · reminder */
const MANUAL_MARK_KEYS = ["done", "rejected", "waiting", "reminder"];

function normalizeManualMark(mark) {
  const v = String(mark ?? "")
    .trim()
    .toLowerCase();
  if (!v || v === "clear" || v === "none" || v === "null") return null;
  if (v === "done" || v === "منفذ" || v === "green") return "done";
  if (v === "rejected" || v === "مرفوض" || v === "red") return "rejected";
  if (v === "waiting" || v === "انتظار" || v === "orange") return "waiting";
  if (v === "reminder" || v === "تذكير" || v === "purple") return "reminder";
  throw new Error(
    "العلامة: تذكير (بنفسجي) · انتظار · منفذ · مرفوض · أو فارغة"
  );
}

function setLeadManualMark(leadId, mark) {
  const id = String(leadId || "").trim();
  if (!id) throw new Error("معرّف العميل مطلوب");

  const value = normalizeManualMark(mark);
  const store = loadStore();
  const idx = store.leads.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("العميل غير موجود في السجل");

  const row = store.leads[idx];
  const now = new Date().toISOString();

  for (let i = 0; i < store.leads.length; i++) {
    if (
      store.leads[i].phone === row.phone &&
      store.leads[i].waAccountId === row.waAccountId
    ) {
      store.leads[i] = {
        ...store.leads[i],
        manualMark: value,
        manualMarkAt: value ? now : null,
      };
    }
  }
  saveStore(store);
  return store.leads.find((r) => r.id === id) || row;
}

/**
 * عند رد العميل برقم الطلب بعد الرابط أو رسالة المتابعة
 * @returns {{ ok: boolean, leadId?: string, orderNumber?: string, phone?: string, updated?: boolean }|null}
 */
function applyOrderNumberToEligibleLeads(phone, waAccountId, orderNumber) {
  const targets = findLeadsForOrderNumber(phone, waAccountId);
  if (!targets.length) return { updated: false, leadId: null, count: 0 };

  const store = loadStore();
  const now = new Date().toISOString();
  let updated = false;
  let primaryId = targets[0].id;

  for (const lead of targets) {
    const idx = store.leads.findIndex((r) => r.id === lead.id);
    if (idx < 0) continue;
    if (store.leads[idx].applicationOrderNumber === orderNumber) continue;
    store.leads[idx] = {
      ...store.leads[idx],
      applicationOrderNumber: orderNumber,
      orderNumberAt: now,
    };
    updated = true;
  }

  if (updated) {
    saveStore(store);
    console.log(
      "[سجل العملاء] رقم طلب",
      phone,
      orderNumber,
      targets[0].waAccountLabel || targets[0].waAccountId || "",
      `(${targets.length} سجل)`
    );
  }

  return { updated, leadId: primaryId, count: targets.length };
}

async function tryCaptureOrderNumberFromMessage(msg, text, session) {
  const { extractOrderNumber, normalizeOrderNumber } = require("./order-number");
  const { resolvePhoneFromMessage } = require("./contact-phone");
  const orderNumber = normalizeOrderNumber(extractOrderNumber(text));
  if (!orderNumber) return null;

  let phone = null;
  if (msg && typeof msg === "object" && msg.from) {
    phone = await resolvePhoneFromMessage(msg);
  }
  if (!phone || phone === "—") {
    phone = formatPhone(msg?.from || msg, session);
  }
  if (!phone || phone === "—") {
    console.warn(
      "[رقم طلب] لم يُعرف جوال العميل —",
      msg?.from || msg
    );
    return null;
  }

  const waMeta = resolveWaAccountMeta();
  const targets = findLeadsForOrderNumber(phone, waMeta.waAccountId);
  if (!targets.length) {
    console.warn(
      "[رقم طلب] لا سجل مؤهل —",
      phone,
      orderNumber,
      waMeta.waAccountId || "?"
    );
    return null;
  }

  const already = targets.find(
    (r) => r.applicationOrderNumber === orderNumber
  );
  if (already) {
    return {
      ok: true,
      leadId: already.id,
      orderNumber,
      phone: already.phone,
      updated: false,
    };
  }

  const result = applyOrderNumberToEligibleLeads(
    phone,
    waMeta.waAccountId,
    orderNumber
  );
  if (!result.updated && !result.leadId) return null;

  return {
    ok: true,
    leadId: result.leadId,
    orderNumber,
    phone,
    updated: result.updated,
  };
}

const DEFAULT_LEGACY_WA = { waAccountId: "majed", waAccountLabel: "ماجد" };

function normalizeLeadRow(row) {
  if (!row || typeof row !== "object") return row;
  let next = { ...row };

  if (next.comboPackage && next.status === "property") {
    next.status = "combo_offer";
    next.statusLabel = STATUS_LABELS.combo_offer;
  }

  /** تصحيح سجلات إيقاف الخدمات — كانت تُسجَّل خطأً كـ «عقاري» */
  if (next.inquiryType === "إيقاف خدمات") {
    if (next.status === "property" || next.statusLabel === STATUS_LABELS.property) {
      next.status = "service_stop";
      next.statusLabel = STATUS_LABELS.service_stop;
    }
    if (!next.contactAgentPhone) {
      const { loadSettingsForAccount } = require("./settings-store");
      const settings = loadSettingsForAccount(next.waAccountId || "majed");
      next.contactAgentName =
        settings.serviceStopAgentName || next.contactAgentName;
      next.contactAgentPhone =
        settings.serviceStopAgentPhone || next.contactAgentPhone;
      next.contactDelivery = next.contactDelivery || "agent_direct";
    }
  }

  /** تصحيح سجلات قديمة — مسار التمويل الشخصي */
  if (next.inquiryType === "تمويل شخصي" || next.financeType === "شخصي") {
    if (
      next.status === "property" ||
      next.status === "qualified" ||
      next.statusLabel === "مؤهل" ||
      next.statusLabel === "مؤهل تمويل شخصي"
    ) {
      if (!next.comboPackage) {
        next.status = "personal_finance";
        next.statusLabel = STATUS_LABELS.personal_finance;
      }
    }
  }

  /** سجلات قديمة بلا حساب — تُنسب لماجد */
  if (!next.waAccountId) {
    const at = next.at ? new Date(next.at) : new Date(0);
    if (at < new Date(DUAL_WA_CUTOFF_ISO)) {
      next.waAccountId = DEFAULT_LEGACY_WA.waAccountId;
      next.waAccountLabel = DEFAULT_LEGACY_WA.waAccountLabel;
    }
  }

  return next;
}

function loadStore() {
  try {
    if (fs.existsSync(LEADS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(LEADS_PATH, "utf8"));
      if (Array.isArray(raw.leads)) {
        let changed = false;
        const leads = raw.leads.map((row) => {
          const next = normalizeLeadRow(row);
          if (
            next.status !== row.status ||
            next.statusLabel !== row.statusLabel ||
            next.waAccountId !== row.waAccountId ||
            next.waAccountLabel !== row.waAccountLabel ||
            next.contactAgentName !== row.contactAgentName ||
            next.contactAgentPhone !== row.contactAgentPhone ||
            next.contactDelivery !== row.contactDelivery
          ) {
            changed = true;
          }
          return next;
        });
        const store = { updatedAt: raw.updatedAt || null, leads };
        if (changed) saveStore(store);
        return store;
      }
    }
  } catch (err) {
    console.warn("تعذر قراءة customer-leads.json:", err.message);
  }
  return { updatedAt: null, leads: [] };
}

function saveStore(store) {
  store.updatedAt = new Date().toISOString();
  if (store.leads.length > MAX_LEADS) {
    store.leads = store.leads.slice(-MAX_LEADS);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LEADS_PATH, JSON.stringify(store, null, 2), "utf8");
}

function findRecentLeadIndex(leads, phone) {
  if (!phone || phone === "—") return -1;
  const maxAge = 2 * 60 * 60 * 1000;
  const now = Date.now();
  for (let i = leads.length - 1; i >= 0; i -= 1) {
    if (leads[i].phone !== phone) continue;
    if (now - new Date(leads[i].at).getTime() <= maxAge) return i;
    break;
  }
  return -1;
}

function appendLead(from, session, event) {
  try {
    if (!shouldStoreLead(session, event)) return;

    const store = loadStore();
    const record = buildRecord(from, session, event);
    const idx = findRecentLeadIndex(store.leads, record.phone);

    if (idx >= 0 && (event === "success" || event === "qualified")) {
      const prev = store.leads[idx];
      store.leads[idx] = {
        ...prev,
        ...record,
        id: prev.id,
        at: record.at,
      };
    } else if (idx >= 0 && event === "rejected") {
      store.leads[idx] = { ...store.leads[idx], ...record, id: store.leads[idx].id };
    } else {
      store.leads.push(record);
    }

    saveStore(store);
    console.log(
      "[سجل العملاء]",
      record.phone,
      record.statusLabel,
      record.waAccountLabel || record.waAccountId || "بدون جوال",
      record.inquiryType || ""
    );
  } catch (err) {
    console.warn("customer-leads:", err.message);
  }
}

function recordQualified(from, session) {
  appendLead(from, session, "qualified");
}

function recordRejected(from, session) {
  appendLead(from, session, "rejected");
}

function recordSuccess(from, session) {
  appendLead(from, session, "success");
}

function resolveApplicationMethod(row) {
  if (row?.applicationMethod === "electronic" || row?.applicationMethod === "branch") {
    return row.applicationMethod;
  }
  const delivery = row?.contactDelivery;
  if (delivery === "electronic_link") return "electronic";
  if (delivery === "branch") return "branch";
  return null;
}

/** نوع التقديم في اللوحة: شخصي إلكتروني | فرع | باقة عقاري+شخصي */
function resolveSubmissionType(row) {
  if (row?.comboPackage) return "combo";
  const method = resolveApplicationMethod(row);
  if (method === "electronic" || method === "branch") return method;
  return null;
}

function listElectronicFollowUpCandidates(options = {}) {
  const store = loadStore();
  const waAccountId = String(options.waAccountId || "").trim();
  const onlyUnsent = options.onlyUnsent !== false;
  const leadId = String(options.leadId || "").trim();

  let list = store.leads.filter(
    (row) =>
      resolveApplicationMethod(row) === "electronic" && !row?.comboPackage
  );

  if (waAccountId) {
    list = list.filter((r) => r.waAccountId === waAccountId);
  }
  if (onlyUnsent) {
    list = list.filter((r) => !r.followUpSentAt);
  }
  if (leadId) {
    list = list.filter((r) => r.id === leadId);
  }

  return list;
}

function markFollowUpSent(leadId, message) {
  const id = String(leadId || "").trim();
  if (!id) return false;

  const store = loadStore();
  const idx = store.leads.findIndex((r) => r.id === id);
  if (idx < 0) return false;

  store.leads[idx] = {
    ...store.leads[idx],
    followUpSentAt: new Date().toISOString(),
    followUpMessage: String(message || "").trim(),
  };
  saveStore(store);
  return true;
}

function queueElectronicFollowUp(options = {}) {
  const outbound = require("./outbound-wa-queue");
  const message = String(options.message || "").trim();
  if (!message) {
    throw new Error("نص الرسالة مطلوب");
  }

  const candidates = listElectronicFollowUpCandidates(options);
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      count: candidates.length,
      leads: candidates.map((r) => ({
        id: r.id,
        phone: r.phone,
        waAccountId: r.waAccountId,
        waAccountLabel: r.waAccountLabel,
        followUpSentAt: r.followUpSentAt || null,
      })),
    };
  }

  const queued = [];
  for (const lead of candidates) {
    if (!lead.waAccountId) continue;
    const item = outbound.enqueue({
      waAccountId: lead.waAccountId,
      phone: lead.phone,
      message,
      leadId: lead.id,
    });
    queued.push({
      queueId: item.id,
      leadId: lead.id,
      phone: lead.phone,
      waAccountId: lead.waAccountId,
    });
  }

  return { ok: true, queued: queued.length, items: queued };
}

function getLeads(options = {}) {
  const store = loadStore();
  let list = consolidateLeadsByPhone(store.leads);

  const status = String(options.status || "").trim();
  if (status && STATUS_LABELS[status]) {
    list = list.filter((r) => r.status === status);
  }

  const waAccountId = String(options.waAccountId || "").trim();
  if (waAccountId) {
    list = list.filter((r) => r.waAccountId === waAccountId);
  }

  const applicationMethod = String(options.applicationMethod || "").trim();
  if (
    applicationMethod === "electronic" ||
    applicationMethod === "branch" ||
    applicationMethod === "combo"
  ) {
    list = list.filter((r) => resolveSubmissionType(r) === applicationMethod);
  }

  const manualMark = String(options.manualMark || "").trim();
  if (
    manualMark === "waiting" ||
    manualMark === "reminder" ||
    manualMark === "done" ||
    manualMark === "rejected"
  ) {
    list = list.filter((r) => r.manualMark === manualMark);
  } else if (manualMark === "none") {
    list = list.filter((r) => !r.manualMark);
  }

  const phoneSearch = String(options.phoneSearch || "").trim();
  const phoneQueryDigits = digitsOnly(phoneSearch);
  if (phoneQueryDigits.length >= 3) {
    list = list.filter((r) => {
      const d = digitsOnly(r.phone);
      const wa = phoneToWhatsAppDigits(r.phone);
      return (
        d.includes(phoneQueryDigits) ||
        wa.includes(phoneQueryDigits) ||
        phoneQueryDigits.includes(d) ||
        (phoneQueryDigits.length >= 4 &&
          (d.endsWith(phoneQueryDigits) || d.endsWith(phoneQueryDigits.slice(-9))))
      );
    });
  }

  const orderNumberSearch = String(options.orderNumberSearch || "").trim();
  const orderQueryDigits = digitsOnly(orderNumberSearch);
  if (orderQueryDigits.length >= 3) {
    list = list.filter((r) => {
      const on = digitsOnly(r.applicationOrderNumber);
      return on && on.includes(orderQueryDigits);
    });
  }

  const searchActive =
    phoneQueryDigits.length >= 3 || orderQueryDigits.length >= 3;
  const limit = Math.min(
    Math.max(Number(options.limit) || (searchActive ? 500 : 200), 1),
    500
  );
  const page = Math.max(Number(options.page) || 1, 1);
  const start = (page - 1) * limit;
  const slice = list.slice(start, start + limit);

  const outboundQueue = require("./outbound-wa-queue");
  const queueByLead = outboundQueue.getLatestByLeadIds(slice.map((r) => r.id));
  const leadsWithQueue = slice.map((row) => ({
    ...row,
    followUpQueue: queueByLead[row.id] || null,
  }));

  const counts = {
    qualified: 0,
    personal_finance: 0,
    rejected: 0,
    property: 0,
    service_stop: 0,
    combo_offer: 0,
  };
  const source = waAccountId
    ? store.leads.filter((r) => r.waAccountId === waAccountId)
    : store.leads;
  for (const row of source) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }

  const applicationCounts = { electronic: 0, branch: 0, combo: 0, other: 0 };
  for (const row of source) {
    const type = resolveSubmissionType(row);
    if (type === "electronic") applicationCounts.electronic += 1;
    else if (type === "branch") applicationCounts.branch += 1;
    else if (type === "combo") applicationCounts.combo += 1;
    else applicationCounts.other += 1;
  }

  const consolidatedForMarks = consolidateLeadsByPhone(source);
  const manualMarkCounts = {
    waiting: 0,
    reminder: 0,
    done: 0,
    rejected: 0,
    none: 0,
  };
  for (const row of consolidatedForMarks) {
    const key = row.manualMark || "none";
    if (manualMarkCounts[key] !== undefined) manualMarkCounts[key] += 1;
  }

  const uniqueTotal = consolidatedForMarks.length;

  const accountOptions = waAccounts
    .listAccounts()
    .accounts.filter((a) => a.id !== "admin")
    .map((a) => ({ id: a.id, label: a.label }));

  return {
    ok: true,
    updatedAt: store.updatedAt,
    waAccountId: waAccountId || null,
    phoneSearch: phoneSearch || null,
    orderNumberSearch: orderNumberSearch || null,
    manualMark: manualMark || null,
    accountOptions,
    uniqueTotal,
    total: list.length,
    page,
    limit,
    counts,
    applicationCounts,
    manualMarkCounts,
    followUpQueue: outboundQueue.getQueueSummary(waAccountId || null),
    statusLabels: STATUS_LABELS,
    leads: leadsWithQueue,
  };
}

function migrateAllLeadsFile() {
  const store = loadStore();
  return store.leads.length;
}

/**
 * تحديد حساب واتساب لفتح المحادثة من اللوحة (حتى مع تبويب «الكل»)
 */
function resolveWaAccountForOpenChat(phone, hints = {}) {
  let id = String(hints.waAccountId || "").trim();
  if (id) return { waAccountId: id, source: "request" };

  const label = String(hints.waAccountLabel || "").trim();
  if (label) {
    try {
      const accounts = waAccounts.listAccounts().accounts || [];
      const byLabel = accounts.find((a) => a.label === label || a.id === label);
      if (byLabel?.id) return { waAccountId: byLabel.id, source: "label" };
    } catch (_) {}
  }

  const targetDigits =
    digitsOnly(formatPhone(phone)) || digitsOnly(String(phone || ""));
  if (!targetDigits) return { waAccountId: null, source: null };

  const store = loadStore();
  const matches = store.leads
    .filter((r) => {
      if (!r.waAccountId) return false;
      const d = digitsOnly(r.phone);
      return d && d === targetDigits;
    })
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  if (!matches.length) return { waAccountId: null, source: null };

  const uniqueIds = [...new Set(matches.map((m) => m.waAccountId))];
  if (uniqueIds.length === 1) {
    return { waAccountId: uniqueIds[0], source: "lead" };
  }
  return { waAccountId: matches[0].waAccountId, source: "lead-latest" };
}

function deleteLeadById(leadId) {
  const id = String(leadId || "").trim();
  if (!id) throw new Error("معرّف العميل مطلوب");

  const store = loadStore();
  const idx = store.leads.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("العميل غير موجود في السجل");

  const removed = store.leads[idx];
  store.leads.splice(idx, 1);
  saveStore(store);

  console.log(
    "[سجل العملاء] حذف",
    removed.phone,
    removed.waAccountLabel || removed.waAccountId || "",
    id
  );

  return { ok: true, deleted: removed };
}

module.exports = {
  recordQualified,
  recordRejected,
  recordSuccess,
  getLeads,
  deleteLeadById,
  formatPhone,
  migrateAllLeadsFile,
  markFollowUpSent,
  queueElectronicFollowUp,
  listElectronicFollowUpCandidates,
  tryCaptureOrderNumberFromMessage,
  setLeadOrderNumber,
  setLeadStatusNote,
  setLeadManualMark,
  MANUAL_MARK_KEYS,
  applyOrderNumberToEligibleLeads,
  leadEligibleForOrderNumber,
  findLeadForOrderNumber,
  findLeadsForOrderNumber,
  consolidateLeadsByPhone,
  resolveWaAccountForOpenChat,
  resolveApplicationMethod,
  resolveSubmissionType,
  STATUS_LABELS,
  LEADS_PATH,
};
