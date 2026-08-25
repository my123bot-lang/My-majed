/**
 * سجل العملاء — رقم الجوال + حالة (تمويل شخصي | مرفوض | عقاري | …) + تفاصيل
 * data/customer-leads.json
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR =
  process.env.CUSTOMERS_DATA_DIR ||
  process.env.DATA_DIR ||
  path.join(__dirname, "..", "data");
const LEADS_PATH = path.join(DATA_DIR, "customer-leads.json");
const QUOTA_PATH = path.join(DATA_DIR, "followup-quota.json");
const MAX_LEADS = 3000;
const RIYADH_TZ = "Asia/Riyadh";
const FOLLOWUP_WINDOW_HOURS = 20;

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

const OUTCOMES = [
  { id: "finance_link", label: "أخذ رابط التمويل" },
  { id: "package", label: "أخذ باقة" },
  { id: "limit_exhausted", label: "مستنفذ حد" },
  { id: "service_stop", label: "إيقاف خدمات" },
  { id: "financing_solutions", label: "حلول تمويلية" },
  { id: "order_number", label: "رقم طلب" },
];

const OUTCOME_BY_ID = Object.fromEntries(OUTCOMES.map((o) => [o.id, o]));
const OUTCOME_BY_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.label, o]));

const WORKPLACES = [
  { id: "government", label: "حكومي" },
  { id: "private", label: "خاص" },
  { id: "military", label: "عسكري" },
];

const CRM_DAYS = [
  "today",
  "yesterday",
  "all",
  "finance_link",
  "finance_link_pending",
  "finance_link_sent",
  "finance_link_plus",
  "order_number",
  "package",
  "limit_exhausted",
  "service_stop",
  "financing_solutions",
  "archive",
  "manual",
  "rejected",
];

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function todayKey(date = new Date(), timeZone = RIYADH_TZ) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const pick = (type) => parts.find((p) => p.type === type)?.value;
    const y = pick("year");
    const m = pick("month");
    const d = pick("day");
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (_) {}
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDateKey(key, days) {
  const [y, m, d] = String(key || "")
    .split("-")
    .map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

function leadDateKey(row) {
  if (row?.at) {
    const t = new Date(row.at);
    if (!Number.isNaN(t.getTime())) return todayKey(t);
  }
  return String(row?.date || "");
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
    jobCategory: jobCategory || null,
    civilianSector: session?.civilianSector || null,
    civilianSectorLabel: session?.civilianSectorLabel || null,
    employerCompany: session?.employerCompany || null,
    archived: false,
    outcome: inferOutcomeId({
      comboPackage: Boolean(session?.comboPackage),
      applicationMethod: session?.applicationMethod || null,
      contactDelivery,
      portalUrl: session?.portalUrl || null,
      applicationOrderNumber: session?.applicationOrderNumber || null,
      status: status.key,
    }),
    workplace: inferWorkplaceId({
      jobCategory,
      civilianSector: session?.civilianSector || null,
    }),
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
      outcome: rows.find((r) => r.outcome)?.outcome || primary.outcome || null,
      workplace: rows.find((r) => r.workplace)?.workplace || primary.workplace || null,
      archived: rows.some((r) => r.archived),
      jobCategory: primary.jobCategory || rows.find((r) => r.jobCategory)?.jobCategory || null,
      civilianSector:
        primary.civilianSector || rows.find((r) => r.civilianSector)?.civilianSector || null,
      employerCompany:
        primary.employerCompany || rows.find((r) => r.employerCompany)?.employerCompany || null,
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
          outcome:
            store.leads[i].outcome === "order_number"
              ? "finance_link"
              : store.leads[i].outcome,
        };
      }
    }
    saveStore(store);
    return decorateCrmLead(store.leads[idx]);
  }

  applyOrderNumberToEligibleLeads(row.phone, row.waAccountId, num);
  const refreshed = loadStore();
  for (let i = 0; i < refreshed.leads.length; i++) {
    if (
      refreshed.leads[i].phone === row.phone &&
      refreshed.leads[i].waAccountId === row.waAccountId
    ) {
      refreshed.leads[i] = {
        ...refreshed.leads[i],
        outcome: "order_number",
        outcomeAt: new Date().toISOString(),
      };
    }
  }
  saveStore(refreshed);
  const updated = refreshed.leads.find((r) => r.id === id);
  return decorateCrmLead(updated || row);
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

function normalizeOutcomeId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (OUTCOME_BY_ID[raw]) return raw;
  if (OUTCOME_BY_LABEL[raw]) return OUTCOME_BY_LABEL[raw].id;
  return null;
}

function inferOutcomeId(row) {
  if (row?.applicationOrderNumber) return "order_number";
  if (row?.comboPackage || resolveSubmissionType(row) === "combo") return "package";
  if (row?.status === "service_stop" || row?.inquiryType === "إيقاف خدمات") {
    return "service_stop";
  }
  if (resolveApplicationMethod(row) === "electronic") return "finance_link";
  return null;
}

function resolveOutcomeId(row) {
  return normalizeOutcomeId(row?.outcome) || inferOutcomeId(row);
}

function resolveOutcomeLabel(row) {
  const id = resolveOutcomeId(row);
  return id ? OUTCOME_BY_ID[id].label : "";
}

function normalizeWorkplaceId(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "clear" || raw === "none") return null;
  if (raw === "government" || raw === "gov" || raw === "حكومي") return "government";
  if (raw === "private" || raw === "خاص" || raw === "قطاع خاص") return "private";
  if (raw === "military" || raw === "عسكري") return "military";
  return null;
}

function inferWorkplaceId(row) {
  const job = String(row?.jobCategory || "").trim();
  if (job === "military") return "military";
  const sector = String(row?.civilianSector || "").trim();
  if (sector === "government" || sector === "gov") return "government";
  if (sector === "private") return "private";
  const type = String(row?.jobType || row?.civilianSectorLabel || row?.sector || "");
  if (/عسكري/.test(type)) return "military";
  if (/حكومي/.test(type)) return "government";
  if (/خاص/.test(type)) return "private";
  return null;
}

function resolveWorkplaceId(row) {
  return normalizeWorkplaceId(row?.workplace) || inferWorkplaceId(row);
}

function resolveWorkplaceLabel(row) {
  const id = resolveWorkplaceId(row);
  if (id === "government") return "حكومي";
  if (id === "private") return "خاص";
  if (id === "military") return "عسكري";
  if (row?.employerCompany) return String(row.employerCompany);
  if (row?.jobCategory === "retired" || row?.sector === "متقاعد") return "متقاعد";
  return "";
}

function followupStatusOf(row, withinHours = FOLLOWUP_WINDOW_HOURS) {
  const q = row?.followUpQueue;
  if (q && (q.status === "pending" || q.status === "processing")) {
    return {
      sent: false,
      pending: true,
      label: "في الطابور",
      at: q.createdAt || null,
    };
  }
  if (q && q.status === "failed" && !row?.followUpSentAt) {
    return {
      sent: false,
      failed: true,
      label: "فشل",
      at: q.createdAt || null,
      error: q.error || null,
    };
  }
  if (!row?.followUpSentAt) {
    return { sent: false, label: "لم تُرسل متابعة", at: null };
  }
  const at = Date.parse(row.followUpSentAt);
  if (!Number.isFinite(at)) {
    return { sent: true, label: "تمت المتابعة", at: row.followUpSentAt };
  }
  const windowMs = Number(withinHours || FOLLOWUP_WINDOW_HOURS) * 60 * 60 * 1000;
  if (Date.now() - at <= windowMs) {
    return {
      sent: true,
      recent: true,
      label: "تمت المتابعة",
      at: row.followUpSentAt,
    };
  }
  return {
    sent: true,
    recent: false,
    label: "متابعة سابقة",
    at: row.followUpSentAt,
  };
}

function looksLikeFollowupMessage(text) {
  const s = String(text || "");
  return /هل تم تقديم الطلب/i.test(s) || /ارسل رقم الطلب/i.test(s) || /هل قدمت تمويل/i.test(s);
}

function hasFirstFollowup(row) {
  return Boolean(row?.followupSent) || Boolean(row?.followUpSentAt) || looksLikeFollowupMessage(row?.followUpMessage);
}

function isIsoDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day || ""));
}

function lastActivityAt(row) {
  return row?.lastInboundAt || row?.at || row?.firstSeenAt || null;
}

function withinWhatsAppWindow(row, hours = 24) {
  const at = Date.parse(lastActivityAt(row) || "");
  if (!Number.isFinite(at)) return false;
  return Date.now() - at <= hours * 60 * 60 * 1000;
}

function decorateCrmLead(row) {
  const outcomeId = resolveOutcomeId(row);
  const workplaceId = resolveWorkplaceId(row);
  return {
    ...row,
    outcome: outcomeId,
    outcomeLabel: outcomeId ? OUTCOME_BY_ID[outcomeId].label : "",
    workplace: workplaceId,
    workplaceLabel: resolveWorkplaceLabel(row),
    followUpStatus: followupStatusOf(row),
    archived: Boolean(row?.archived),
    manual: Boolean(row?.manual),
    rejected: Boolean(row?.rejected),
    followupPlus: Boolean(row?.followupPlus),
    followupSent: hasFirstFollowup(row),
  };
}

function matchesCrmDay(row, day, today = todayKey(), yesterday = shiftDateKey(todayKey(), -1)) {
  const archived = Boolean(row?.archived);
  const manual = Boolean(row?.manual);
  const rejected = Boolean(row?.rejected);
  const plus = Boolean(row?.followupPlus);
  const sent = hasFirstFollowup(row);
  const outcomeId = resolveOutcomeId(row);

  if (day === "archive") return archived;
  if (archived) return false;

  if (day === "rejected") return rejected;
  if (day === "manual") return manual && !rejected;
  if (rejected || manual) {
    return day === "all" || !day;
  }

  if (day === "finance_link_plus") return plus;
  if (day === "finance_link_sent") {
    return !plus && sent && outcomeId === "finance_link";
  }
  if (day === "finance_link_pending") {
    return !plus && !sent && outcomeId === "finance_link";
  }
  if (day === "today") return leadDateKey(row) === today;
  if (day === "yesterday") return leadDateKey(row) === yesterday;
  if (isIsoDay(day)) return leadDateKey(row) === day;
  if (day === "all" || !day) return true;
  return outcomeId === day;
}

function emptyTabCounts() {
  return {
    today: 0,
    yesterday: 0,
    all: 0,
    finance_link: 0,
    finance_link_pending: 0,
    finance_link_sent: 0,
    finance_link_plus: 0,
    order_number: 0,
    package: 0,
    limit_exhausted: 0,
    service_stop: 0,
    financing_solutions: 0,
    archive: 0,
    manual: 0,
    rejected: 0,
  };
}

function computeTabCounts(rows) {
  const today = todayKey();
  const yesterday = shiftDateKey(today, -1);
  const counts = emptyTabCounts();
  const keys = Object.keys(counts);
  for (const row of rows) {
    for (const key of keys) {
      if (matchesCrmDay(row, key, today, yesterday)) counts[key] += 1;
    }
  }
  return counts;
}

function getPersistenceInfo(count) {
  const envDir = process.env.CUSTOMERS_DATA_DIR || process.env.DATA_DIR || "";
  const durable = Boolean(String(envDir).trim());
  return {
    durable,
    dataDir: DATA_DIR,
    path: LEADS_PATH,
    count: Number(count) || 0,
  };
}

function loadQuota() {
  try {
    if (fs.existsSync(QUOTA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(QUOTA_PATH, "utf8"));
      if (raw && typeof raw === "object") return raw;
    }
  } catch (err) {
    console.warn("تعذر قراءة followup-quota.json:", err.message);
  }
  return { date: todayKey(), sent: 0 };
}

function saveQuota(quota) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = QUOTA_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(quota, null, 2), "utf8");
  fs.renameSync(tmp, QUOTA_PATH);
}

function getFollowUpQuota() {
  const today = todayKey();
  const quota = loadQuota();
  if (quota.date !== today) {
    return { date: today, sent: 0 };
  }
  return { date: today, sent: Number(quota.sent) || 0 };
}

function addFollowUpQuota(n) {
  const current = getFollowUpQuota();
  const next = { date: current.date, sent: current.sent + Math.max(Number(n) || 0, 0) };
  saveQuota(next);
  return next;
}

function getFollowUpSafeSettings() {
  let followUp = {};
  try {
    followUp = require("../config").followUp || {};
  } catch (_) {}
  const dailyLimit = Math.max(Number(followUp.dailyLimit) || 250, 1);
  const minDelayMs = Math.max(Number(followUp.minDelayMs) || 8000, 8000);
  const maxBatchSize = Math.min(Math.max(Number(followUp.maxBatchSize) || 250, 1), 250);
  const skipHours = Number(followUp.skipIfFollowedUpWithinHours) || FOLLOWUP_WINDOW_HOURS;
  const quota = getFollowUpQuota();
  const rows = consolidateLeadsByPhone(loadStore().leads);
  const today = todayKey();
  const yesterday = shiftDateKey(today, -1);
  const pending = rows.filter((r) => matchesCrmDay(r, "finance_link_pending", today, yesterday));
  const sent = rows.filter((r) => matchesCrmDay(r, "finance_link_sent", today, yesterday));
  const plus = rows.filter((r) => matchesCrmDay(r, "finance_link_plus", today, yesterday));
  const financeLink = rows.filter((r) => matchesCrmDay(r, "finance_link", today, yesterday));
  return {
    dailyLimit,
    dailySent: quota.sent,
    dailyRemaining: Math.max(dailyLimit - quota.sent, 0),
    minDelayMs,
    maxBatchSize,
    skipIfFollowedUpWithinHours: skipHours,
    delayMs: minDelayMs,
    financeLinkTotal: financeLink.length,
    financeLinkPending: pending.length,
    financeLinkPendingInWindow: pending.filter((r) => withinWhatsAppWindow(r)).length,
    financeLinkPendingOutsideWindow: pending.filter((r) => !withinWhatsAppWindow(r)).length,
    financeLinkPlusEligible: sent.length,
    financeLinkPlus: plus.length,
  };
}

function applyLeadPatchById(leadId, patchFn) {
  const id = String(leadId || "").trim();
  if (!id) throw new Error("معرّف العميل مطلوب");
  const store = loadStore();
  const idx = store.leads.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("العميل غير موجود في السجل");
  const row = store.leads[idx];
  for (let i = 0; i < store.leads.length; i++) {
    if (
      store.leads[i].phone === row.phone &&
      store.leads[i].waAccountId === row.waAccountId
    ) {
      store.leads[i] = patchFn(store.leads[i], row);
    }
  }
  saveStore(store);
  return decorateCrmLead(store.leads.find((r) => r.id === id) || row);
}

function findLeadByPhone(phone, waAccountId) {
  const key = phoneMatchKey(phone);
  if (!key) return null;
  let list = consolidateLeadsByPhone(loadStore().leads);
  const wa = String(waAccountId || "").trim();
  if (wa) list = list.filter((r) => r.waAccountId === wa);
  return list.find((r) => phoneMatchKey(r.phone) === key) || null;
}

function requireLeadByPhone(phone, waAccountId) {
  const lead = findLeadByPhone(phone, waAccountId);
  if (!lead) throw new Error("العميل غير موجود في السجل");
  return lead;
}

function setLeadOutcome(leadId, outcome) {
  const id = normalizeOutcomeId(outcome);
  if (String(outcome || "").trim() && !id) {
    throw new Error("قيمة «وش صار» غير معروفة");
  }
  return applyLeadPatchById(leadId, (row) => ({
    ...row,
    outcome: id,
    outcomeAt: id ? new Date().toISOString() : null,
  }));
}

function setLeadWorkplace(leadId, workplace) {
  const id = normalizeWorkplaceId(workplace);
  if (String(workplace || "").trim() && workplace !== "clear" && !id) {
    throw new Error("جهة العمل: حكومي أو خاص أو عسكري");
  }
  return applyLeadPatchById(leadId, (row) => ({
    ...row,
    workplace: id,
    workplaceAt: id ? new Date().toISOString() : null,
  }));
}

function setLeadArchived(leadId, archived) {
  const value = Boolean(archived);
  return applyLeadPatchById(leadId, (row) => ({
    ...row,
    archived: value,
    archivedAt: value ? new Date().toISOString() : null,
  }));
}

function setLeadManual(leadId, manual) {
  const value = Boolean(manual);
  return applyLeadPatchById(leadId, (row) => ({
    ...row,
    manual: value,
    manualAt: value ? new Date().toISOString() : null,
    rejected: value ? false : row.rejected,
  }));
}

function setLeadRejected(leadId, rejected) {
  const value = Boolean(rejected);
  return applyLeadPatchById(leadId, (row) => ({
    ...row,
    rejected: value,
    rejectedAt: value ? new Date().toISOString() : null,
    manual: value ? false : row.manual,
  }));
}

function setLeadFollowupPlus(leadId, plus) {
  const value = Boolean(plus);
  return applyLeadPatchById(leadId, (row) => ({
    ...row,
    followupPlus: value,
    followupPlusAt: value ? new Date().toISOString() : null,
    followupSent: value ? true : row.followupSent,
  }));
}

function markLeadFollowupSent(leadId, message, extra = {}) {
  const now = new Date().toISOString();
  const text = String(message || "").trim();
  return applyLeadPatchById(leadId, (row) => {
    const event = {
      type: "outbound",
      at: now,
      text,
      mode: extra.mode || "text",
    };
    const events = Array.isArray(row.events) ? row.events.concat(event).slice(-80) : [event];
    return {
      ...row,
      followupSent: extra.plus ? true : true,
      followupPlus: extra.plus ? true : Boolean(row.followupPlus),
      followUpSentAt: now,
      followUpMessage: text,
      lastOutboundAt: now,
      lastOutboundPreview: text,
      events,
    };
  });
}

function appendLeadEvent(leadId, event) {
  if (!event || typeof event !== "object") return null;
  return applyLeadPatchById(leadId, (row) => {
    const events = Array.isArray(row.events) ? row.events.concat(event).slice(-80) : [event];
    return { ...row, events };
  });
}

function normalizeAdminPhone(phone) {
  const display = normalizeSaudiDisplay(phone);
  if (display) return display;
  let digits = digitsOnly(phone);
  if (digits.startsWith("966") && digits.length > 9) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  return digits ? `0${digits}` : "";
}

/**
 * أي رسالة واتساب واردة → يظهر الرقم في اللوحة فوراً، حتى لو ما بدأ القائمة
 * (مرحبا/هلا/السلام عليكم/1) وحتى لو الرد الآلي متوقف لهذه المحادثة.
 */
function recordInboundMessage(phone, { text = "", at = null } = {}) {
  const formatted = normalizeAdminPhone(phone);
  if (!formatted) return null;
  const now = at || new Date().toISOString();
  const preview = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const inboundEvent = { type: "inbound", at: now, text: preview };
  const existing = findLeadByPhone(formatted);
  if (existing) {
    return applyLeadPatchById(existing.id, (row) => {
      const events = Array.isArray(row.events)
        ? row.events.concat(inboundEvent).slice(-80)
        : [inboundEvent];
      return {
        ...row,
        lastInboundAt: now,
        lastSeenAt: now,
        lastInboundText: preview || row.lastInboundText || "",
        events,
      };
    });
  }
  return upsertLeadByPhone(formatted, {
    lastInboundAt: now,
    lastSeenAt: now,
    firstSeenAt: now,
    lastInboundText: preview,
    events: [inboundEvent],
  });
}

function upsertLeadByPhone(phone, patch = {}) {
  const formatted = normalizeAdminPhone(phone);
  if (!formatted) throw new Error("رقم الجوال غير صالح");
  const existing = findLeadByPhone(formatted);
  if (existing) {
    return applyLeadPatchById(existing.id, (row) => ({ ...row, ...patch }));
  }
  const store = loadStore();
  const now = new Date().toISOString();
  const row = normalizeLeadRow({
    id: newId(),
    phone: formatted,
    at: now,
    date: todayKey(),
    waAccountId: "majed",
    waAccountLabel: "ماجد",
    archived: false,
    ...patch,
  });
  store.leads.push(row);
  saveStore(store);
  return decorateCrmLead(row);
}

function exportLeadsBackup() {
  const store = loadStore();
  return {
    ok: true,
    exportedAt: new Date().toISOString(),
    version: "majed-leads-v1",
    leads: store.leads,
    count: store.leads.length,
  };
}

function writeLeadsBackupCopy() {
  const backup = exportLeadsBackup();
  const name = `customer-leads-backup-${todayKey()}.json`;
  const dest = path.join(DATA_DIR, name);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(backup, null, 2), "utf8");
  return { ok: true, path: dest, count: backup.count, summary: { counts: computeTabCounts(backup.leads) } };
}

function importLeadsBackup(payload) {
  const incoming = Array.isArray(payload?.leads)
    ? payload.leads
    : Array.isArray(payload?.customers)
      ? payload.customers
      : Array.isArray(payload)
        ? payload
        : [];
  if (!incoming.length) throw new Error("لا توجد سجلات للاستيراد");

  const store = loadStore();
  const index = new Map();
  store.leads.forEach((row, i) => {
    index.set(`${row.waAccountId || ""}|${phoneMatchKey(row.phone)}`, i);
  });

  let imported = 0;
  let updated = 0;
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const next = normalizeLeadRow({
      ...raw,
      id: raw.id || newId(),
      phone: raw.phone || raw.phoneNumber || "",
      at: raw.at || raw.lastInboundAt || raw.firstSeenAt || new Date().toISOString(),
    });
    if (!next.phone) continue;
    const key = `${next.waAccountId || ""}|${phoneMatchKey(next.phone)}`;
    const existingIdx = index.get(key);
    if (existingIdx == null) {
      store.leads.push(next);
      index.set(key, store.leads.length - 1);
      imported += 1;
    } else {
      const prev = store.leads[existingIdx];
      store.leads[existingIdx] = {
        ...prev,
        ...next,
        id: prev.id,
      };
      updated += 1;
    }
  }
  saveStore(store);
  return {
    ok: true,
    imported,
    updated,
    total: store.leads.length,
    persistence: getPersistenceInfo(store.leads.length),
  };
}

function listElectronicFollowUpCandidates(options = {}) {
  const store = loadStore();
  const waAccountId = String(options.waAccountId || "").trim();
  const onlyUnsent = options.onlyUnsent !== false;
  const leadId = String(options.leadId || "").trim();
  const skipHours =
    options.skipIfFollowedUpWithinHours != null
      ? Number(options.skipIfFollowedUpWithinHours)
      : FOLLOWUP_WINDOW_HOURS;

  let list = consolidateLeadsByPhone(store.leads).filter((row) => {
    if (row.archived) return false;
    const outcomeId = resolveOutcomeId(row);
    if (outcomeId === "finance_link") return true;
    return resolveApplicationMethod(row) === "electronic" && !row?.comboPackage;
  });

  if (waAccountId) {
    list = list.filter((r) => r.waAccountId === waAccountId);
  }
  if (onlyUnsent) {
    list = list.filter((r) => {
      const st = followupStatusOf(r, skipHours);
      if (st.pending) return false;
      return !st.recent;
    });
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

  const safe = getFollowUpSafeSettings();
  const skipHours =
    options.skipIfFollowedUpWithinHours != null
      ? Number(options.skipIfFollowedUpWithinHours)
      : safe.skipIfFollowedUpWithinHours;
  const maxBatch = Math.min(
    Math.max(Number(options.limit) || safe.maxBatchSize, 1),
    safe.maxBatchSize
  );
  const delayMs = Math.max(Number(options.delayMs) || safe.minDelayMs, safe.minDelayMs);

  const candidates = listElectronicFollowUpCandidates({
    ...options,
    skipIfFollowedUpWithinHours: skipHours,
  });
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      count: candidates.length,
      outboundSafe: safe,
      leads: candidates.map((r) => ({
        id: r.id,
        phone: r.phone,
        waAccountId: r.waAccountId,
        waAccountLabel: r.waAccountLabel,
        followUpSentAt: r.followUpSentAt || null,
      })),
    };
  }

  const remaining = safe.dailyRemaining;
  if (remaining <= 0) {
    throw new Error(`استُنفدت الحصة اليومية (${safe.dailyLimit}) — حاول غداً`);
  }

  const take = candidates.slice(0, Math.min(maxBatch, remaining));
  const queued = [];
  for (const lead of take) {
    if (!lead.waAccountId) continue;
    const item = outbound.enqueue({
      waAccountId: lead.waAccountId,
      phone: lead.phone,
      message,
      leadId: lead.id,
      delayMs,
    });
    queued.push({
      queueId: item.id,
      leadId: lead.id,
      phone: lead.phone,
      waAccountId: lead.waAccountId,
    });
  }

  if (queued.length) addFollowUpQuota(queued.length);

  const skipped = candidates.length - take.length;
  const quota = getFollowUpQuota();
  return {
    ok: true,
    queued: queued.length,
    sent: queued.length,
    skipped,
    failed: 0,
    dailyRemaining: Math.max(safe.dailyLimit - quota.sent, 0),
    items: queued,
  };
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

  const q = String(options.q || options.search || "").trim().toLowerCase();
  if (q) {
    list = list.filter((r) => {
      const hay = [
        r.phone,
        r.applicationOrderNumber,
        r.orderStatusNote,
        r.employerCompany,
        r.outcome,
        resolveOutcomeLabel(r),
        resolveWorkplaceLabel(r),
        r.sector,
        r.jobType,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const sourceForTabs = waAccountId
    ? consolidateLeadsByPhone(store.leads.filter((r) => r.waAccountId === waAccountId))
    : consolidateLeadsByPhone(store.leads);
  const tabCounts = computeTabCounts(sourceForTabs);

  const day = String(options.day || "").trim();
  if (day && (CRM_DAYS.includes(day) || isIsoDay(day))) {
    const today = todayKey();
    const yesterday = shiftDateKey(today, -1);
    list = list.filter((r) => matchesCrmDay(r, day, today, yesterday));
  }

  const followupFilter = String(options.followupFilter || "").trim();
  if (followupFilter === "pending" || followupFilter === "sent") {
    list = list.filter((r) => {
      const sent = followupStatusOf(r).sent;
      return followupFilter === "sent" ? sent : !sent;
    });
  }

  const searchActive =
    phoneQueryDigits.length >= 3 || orderQueryDigits.length >= 3 || Boolean(q);
  const limit = Math.min(
    Math.max(Number(options.limit) || (searchActive ? 500 : 100), 1),
    500
  );
  const page = Math.max(Number(options.page) || 1, 1);
  const offsetRaw = Number(options.offset);
  const start = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : (page - 1) * limit;
  const slice = list.slice(start, start + limit);
  const hasMore = start + slice.length < list.length;

  if (options.phonesOnly) {
    return {
      ok: true,
      day: day || "today",
      count: list.length,
      phones: list.map((r) => ({ phone: r.phone, waAccountId: r.waAccountId })),
    };
  }

  const outboundQueue = require("./outbound-wa-queue");
  const queueByLead = outboundQueue.getLatestByLeadIds(slice.map((r) => r.id));
  const leadsWithQueue = slice.map((row) =>
    decorateCrmLead({
      ...row,
      followUpQueue: queueByLead[row.id] || null,
    })
  );

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
    day: day || null,
    timezone: RIYADH_TZ,
    accountOptions,
    total: list.length,
    count: list.length,
    page,
    limit,
    offset: start,
    hasMore,
    counts: { ...counts, ...tabCounts },
    tabCounts,
    applicationCounts,
    manualMarkCounts,
    persistence: getPersistenceInfo(store.leads.length),
    outboundSafe: getFollowUpSafeSettings(),
    followUpPreview: (() => {
      try {
        return require("../config").followUp?.electronicMessage || "";
      } catch (_) {
        return "";
      }
    })(),
    followUpQueue: outboundQueue.getQueueSummary(waAccountId || null),
    statusLabels: STATUS_LABELS,
    outcomes: OUTCOMES,
    workplaces: WORKPLACES,
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
  setLeadOutcome,
  setLeadWorkplace,
  setLeadArchived,
  setLeadManual,
  setLeadRejected,
  setLeadFollowupPlus,
  markLeadFollowupSent,
  appendLeadEvent,
  recordInboundMessage,
  upsertLeadByPhone,
  normalizeAdminPhone,
  hasFirstFollowup,
  withinWhatsAppWindow,
  isIsoDay,
  findLeadByPhone,
  requireLeadByPhone,
  exportLeadsBackup,
  writeLeadsBackupCopy,
  importLeadsBackup,
  getFollowUpSafeSettings,
  addFollowUpQuota,
  getPersistenceInfo,
  followupStatusOf,
  resolveOutcomeId,
  resolveWorkplaceId,
  inferOutcomeId,
  matchesCrmDay,
  computeTabCounts,
  decorateCrmLead,
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
  OUTCOMES,
  WORKPLACES,
  LEADS_PATH,
  DATA_DIR,
};
