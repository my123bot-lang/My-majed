/**
 * إحصائية التواصل — إجمالي + حسب جوال واتساب (data/call-stats.json)
 */
const fs = require("fs");
const path = require("path");
const { getCurrentWaAccountId } = require("./current-wa-account");
const waAccounts = require("./whatsapp-accounts-store");
const { digitsOnly } = require("./contact-phone");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_STATS_PATH = path.join(DATA_DIR, "call-stats.json");
const LEADS_PATH = path.join(DATA_DIR, "customer-leads.json");

function getStatsPath() {
  const override = String(process.env.CALL_STATS_PATH || "").trim();
  return override || DEFAULT_STATS_PATH;
}

const INQUIRY_KEYS = [
  "personal",
  "debt_purchase",
  "service_stop",
  "hours",
  "location",
  "after_sales",
  "pause_auto_reply",
  "assistant_contact",
];

const INQUIRY_LABELS = {
  personal: "تمويل شخصي",
  debt_purchase: "شراء مديونية",
  service_stop: "إيقاف خدمات",
  hours: "ساعات الدوام",
  location: "موقعنا",
  after_sales: "خدمات مابعد البيع",
  pause_auto_reply: "إيقاف الرد الآلي",
  assistant_contact: "رقم المساعد",
};

function emptyBucket() {
  return {
    contacts: 0,
    conversations: 0,
    customers: 0,
    inquiries: {
      personal: 0,
      debt_purchase: 0,
      service_stop: 0,
      hours: 0,
      location: 0,
      after_sales: 0,
      pause_auto_reply: 0,
      assistant_contact: 0,
    },
    qualified: 0,
    success: 0,
    rejected: 0,
    applications: { electronic: 0, branch: 0 },
  };
}

function emptyStore() {
  return {
    updatedAt: new Date().toISOString(),
    totals: emptyBucket(),
    daily: {},
    byAccount: {},
  };
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** مفتاح فريد للجوال — آخر 9 أرقام للشبكات السعودية */
function customerKey(phone) {
  const d = digitsOnly(phone);
  if (!d) {
    const raw = String(phone || "").trim();
    if (!raw) return "";
    const user = raw.includes("@") ? raw.split("@")[0] : raw;
    return user.slice(-16) || "";
  }
  if (d.startsWith("9665") && d.length >= 12) return d.slice(-9);
  if (d.startsWith("05") && d.length === 10) return d.slice(-9);
  if (d.startsWith("5") && d.length === 9) return d;
  if (d.length >= 8) return d.slice(-12);
  return d;
}

function lastNDayKeys(count, now = new Date()) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(todayKey(d));
  }
  return keys;
}

function copyPhoneMap(source) {
  const out = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function copyDailyPhones(source) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const [day, phones] of Object.entries(source)) {
    if (Array.isArray(phones)) {
      out[day] = [...new Set(phones.filter(Boolean).map(String))];
    } else if (phones && typeof phones === "object") {
      out[day] = Object.keys(phones);
    }
  }
  return out;
}

function addUniqueCustomer(acc, day, phone) {
  const key = customerKey(phone);
  if (!key) return false;
  if (!acc.dailyPhones[day]) acc.dailyPhones[day] = [];
  let changed = false;
  if (!acc.dailyPhones[day].includes(key)) {
    acc.dailyPhones[day].push(key);
    changed = true;
  }
  if (!acc.allPhones[key] || String(day) < String(acc.allPhones[key])) {
    acc.allPhones[key] = day;
    changed = true;
  }
  if (acc.daily[day]) acc.daily[day].customers = acc.dailyPhones[day].length;
  acc.totals.customers = Object.keys(acc.allPhones).length;
  return changed;
}

function collectPhoneMaps(accounts) {
  const allPhones = {};
  const dailyPhones = {};
  for (const acc of accounts) {
    for (const [key, firstDay] of Object.entries(acc.allPhones || {})) {
      if (!allPhones[key] || String(firstDay) < String(allPhones[key])) {
        allPhones[key] = firstDay;
      }
    }
    for (const [day, phones] of Object.entries(acc.dailyPhones || {})) {
      if (!dailyPhones[day]) dailyPhones[day] = new Set();
      for (const p of phones || []) dailyPhones[day].add(p);
    }
  }
  return { allPhones, dailyPhones };
}

function countUniqueLeads(waAccountId) {
  try {
    if (!fs.existsSync(LEADS_PATH)) return 0;
    const raw = JSON.parse(fs.readFileSync(LEADS_PATH, "utf8"));
    const leads = Array.isArray(raw.leads) ? raw.leads : [];
    const keys = new Set();
    for (const row of leads) {
      if (waAccountId && row.waAccountId && row.waAccountId !== waAccountId) continue;
      const key = customerKey(row.phone);
      if (key) keys.add(key);
    }
    return keys.size;
  } catch (_) {
    return 0;
  }
}

function mergeLeadPhones(store) {
  try {
    if (getStatsPath() !== DEFAULT_STATS_PATH) return false;
    if (!fs.existsSync(LEADS_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(LEADS_PATH, "utf8"));
    const leads = Array.isArray(raw.leads) ? raw.leads : [];
    let changed = false;
    for (const row of leads) {
      const key = customerKey(row.phone);
      if (!key) continue;
      const accountId = row.waAccountId || "majed";
      const acc = ensureAccount(store, accountId);
      const day = row.date || (row.at ? todayKey(new Date(row.at)) : todayKey());
      if (!acc.daily[day]) acc.daily[day] = emptyBucket();
      if (addUniqueCustomer(acc, day, row.phone)) changed = true;
    }
    return changed;
  } catch (_) {
    return false;
  }
}

function phonesOnDay(dailyPhones, day) {
  const v = dailyPhones[day];
  if (!v) return [];
  if (v instanceof Set) return [...v];
  if (Array.isArray(v)) return v;
  return Object.keys(v);
}

function customerSummary(allPhones, dailyPhones, waAccountId) {
  const weekKeys = lastNDayKeys(7);
  const weekSet = new Set();
  for (const day of weekKeys) {
    for (const p of phonesOnDay(dailyPhones, day)) weekSet.add(p);
  }
  let newThisWeek = 0;
  for (const firstDay of Object.values(allPhones)) {
    if (weekKeys.includes(String(firstDay))) newThisWeek += 1;
  }
  const today = todayKey();
  return {
    today: phonesOnDay(dailyPhones, today).length,
    week: weekSet.size,
    total: Object.keys(allPhones).length,
    newThisWeek,
    inLeads: countUniqueLeads(waAccountId || null),
  };
}

function mergeBucket(target, source) {
  if (!source || typeof source !== "object") return;
  target.contacts += Number(source.contacts) || 0;
  target.conversations += Number(source.conversations) || 0;
  target.qualified += Number(source.qualified) || 0;
  target.success += Number(source.success) || 0;
  target.rejected += Number(source.rejected) || 0;

  if (source.inquiries) {
    for (const key of INQUIRY_KEYS) {
      target.inquiries[key] += Number(source.inquiries[key]) || 0;
    }
  }
  if (source.applications) {
    target.applications.electronic += Number(source.applications.electronic) || 0;
    target.applications.branch += Number(source.applications.branch) || 0;
  }
}

function ensureAccount(store, accountId) {
  const id = accountId || "unknown";
  if (!store.byAccount[id]) {
    store.byAccount[id] = {
      totals: emptyBucket(),
      daily: {},
      allPhones: {},
      dailyPhones: {},
    };
  }
  const acc = store.byAccount[id];
  if (!acc.allPhones || typeof acc.allPhones !== "object") acc.allPhones = {};
  if (!acc.dailyPhones || typeof acc.dailyPhones !== "object") acc.dailyPhones = {};
  return acc;
}

function recomputeGlobalTotals(store) {
  store.totals = emptyBucket();
  store.daily = {};
  for (const acc of Object.values(store.byAccount)) {
    mergeBucket(store.totals, acc.totals);
    if (acc.dailyPhones) {
      for (const [day, phones] of Object.entries(acc.dailyPhones)) {
        if (acc.daily[day]) acc.daily[day].customers = (phones || []).length;
      }
    }
    acc.totals.customers = Object.keys(acc.allPhones || {}).length;
    for (const [day, bucket] of Object.entries(acc.daily || {})) {
      if (!store.daily[day]) store.daily[day] = emptyBucket();
      mergeBucket(store.daily[day], bucket);
    }
  }
  const { allPhones, dailyPhones } = collectPhoneMaps(Object.values(store.byAccount));
  store.totals.customers = Object.keys(allPhones).length;
  for (const [day, set] of Object.entries(dailyPhones)) {
    if (!store.daily[day]) store.daily[day] = emptyBucket();
    store.daily[day].customers = set.size;
  }
}

function normalizeStore(raw) {
  const store = emptyStore();
  if (!raw || typeof raw !== "object") return store;

  if (raw.byAccount && typeof raw.byAccount === "object") {
    for (const [id, acc] of Object.entries(raw.byAccount)) {
      const slot = ensureAccount(store, id);
      if (acc.totals) mergeBucket(slot.totals, acc.totals);
      if (acc.daily) {
        for (const [day, bucket] of Object.entries(acc.daily)) {
          slot.daily[day] = emptyBucket();
          mergeBucket(slot.daily[day], bucket);
        }
      }
      slot.allPhones = copyPhoneMap(acc.allPhones);
      slot.dailyPhones = copyDailyPhones(acc.dailyPhones);
    }
  }

  if (Object.keys(store.byAccount).length === 0 && raw.totals) {
    const majed = ensureAccount(store, "majed");
    mergeBucket(majed.totals, raw.totals);
    if (raw.daily) {
      for (const [day, bucket] of Object.entries(raw.daily)) {
        majed.daily[day] = emptyBucket();
        mergeBucket(majed.daily[day], bucket);
      }
    }
  }

  const legacy = store.byAccount._legacy;
  if (legacy) {
    const majed = ensureAccount(store, "majed");
    mergeBucket(majed.totals, legacy.totals);
    for (const [day, bucket] of Object.entries(legacy.daily || {})) {
      if (!majed.daily[day]) majed.daily[day] = emptyBucket();
      mergeBucket(majed.daily[day], bucket);
    }
    Object.assign(majed.allPhones, copyPhoneMap(legacy.allPhones));
    for (const [day, phones] of Object.entries(copyDailyPhones(legacy.dailyPhones))) {
      majed.dailyPhones[day] = [
        ...new Set([...(majed.dailyPhones[day] || []), ...phones]),
      ];
    }
    delete store.byAccount._legacy;
  }

  const unknown = store.byAccount.unknown;
  if (unknown) {
    const majed = ensureAccount(store, "majed");
    mergeBucket(majed.totals, unknown.totals);
    for (const [day, bucket] of Object.entries(unknown.daily || {})) {
      if (!majed.daily[day]) majed.daily[day] = emptyBucket();
      mergeBucket(majed.daily[day], bucket);
    }
    Object.assign(majed.allPhones, copyPhoneMap(unknown.allPhones));
    for (const [day, phones] of Object.entries(copyDailyPhones(unknown.dailyPhones))) {
      majed.dailyPhones[day] = [
        ...new Set([...(majed.dailyPhones[day] || []), ...phones]),
      ];
    }
    delete store.byAccount.unknown;
  }

  recomputeGlobalTotals(store);
  store.updatedAt = raw.updatedAt || store.updatedAt;
  return store;
}

function loadStore() {
  try {
    const statsPath = getStatsPath();
    if (fs.existsSync(statsPath)) {
      const raw = JSON.parse(fs.readFileSync(statsPath, "utf8"));
      const store = normalizeStore(raw);
      const hadLegacyRoot = !raw.byAccount && raw.totals;
      const hadLegacyBucket = raw.byAccount?._legacy || raw.byAccount?.unknown;
      if (hadLegacyRoot || hadLegacyBucket) {
        saveStore(store);
      }
      return store;
    }
  } catch (err) {
    console.warn("تعذر قراءة call-stats.json:", err.message);
  }
  return emptyStore();
}

function saveStore(store) {
  store.updatedAt = new Date().toISOString();
  const statsPath = getStatsPath();
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(store, null, 2), "utf8");
}

function getTrackableAccounts() {
  return waAccounts.listAccounts().accounts.filter((a) => a.id !== "admin");
}

function accountLabel(accountId) {
  try {
    return waAccounts.getAccountById(accountId).label;
  } catch (_) {
    if (accountId === "_legacy") return "سجل قديم (قبل التقسيم)";
    if (accountId === "unknown") return "غير محدد";
    return accountId;
  }
}

function record(mutate, afterAccount) {
  try {
    const store = loadStore();
    let accountId = getCurrentWaAccountId();
    if (!accountId && process.env.WA_ACCOUNT_ID) {
      accountId = String(process.env.WA_ACCOUNT_ID).trim();
    }
    accountId = accountId || "unknown";
    const acc = ensureAccount(store, accountId);
    const day = todayKey();
    if (!acc.daily[day]) acc.daily[day] = emptyBucket();
    mutate(acc.totals);
    mutate(acc.daily[day]);
    if (typeof afterAccount === "function") afterAccount(acc, day);
    recomputeGlobalTotals(store);
    saveStore(store);
  } catch (err) {
    console.warn("call-stats:", err.message);
  }
}

function getLastDaysFromDaily(dailyMap, count = 7) {
  const rows = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    const bucket = (dailyMap && dailyMap[key]) || emptyBucket();
    rows.push({ date: key, ...bucket });
  }
  return rows;
}

function getAccountSlice(store, accountId) {
  const acc = store.byAccount[accountId] || {
    totals: emptyBucket(),
    daily: {},
    allPhones: {},
    dailyPhones: {},
  };
  const today = todayKey();
  return {
    waAccountId: accountId,
    label: accountLabel(accountId),
    today: acc.daily[today] || emptyBucket(),
    totals: acc.totals,
    last7Days: getLastDaysFromDaily(acc.daily, 7),
    customers: customerSummary(acc.allPhones || {}, acc.dailyPhones || {}, accountId),
  };
}

function getDashboardStats(options = {}) {
  const store = loadStore();
  if (mergeLeadPhones(store)) {
    recomputeGlobalTotals(store);
    saveStore(store);
  }
  const today = todayKey();
  const waAccountId = options.waAccountId
    ? String(options.waAccountId).trim()
    : null;

  if (waAccountId) {
    return {
      updatedAt: store.updatedAt,
      inquiryLabels: INQUIRY_LABELS,
      ...getAccountSlice(store, waAccountId),
    };
  }

  const tracked = getTrackableAccounts();
  const accounts = tracked.map((a) => getAccountSlice(store, a.id));

  for (const id of Object.keys(store.byAccount)) {
    if (id === "admin") continue;
    if (accounts.some((x) => x.waAccountId === id)) continue;
    accounts.push(getAccountSlice(store, id));
  }

  const maps = collectPhoneMaps(Object.values(store.byAccount));
  return {
    updatedAt: store.updatedAt,
    inquiryLabels: INQUIRY_LABELS,
    accounts,
    today: store.daily[today] || emptyBucket(),
    totals: store.totals,
    last7Days: getLastDaysFromDaily(store.daily, 7),
    customers: customerSummary(maps.allPhones, maps.dailyPhones, null),
  };
}

function recordInboundContact(phone) {
  record(
    (b) => {
      b.contacts += 1;
    },
    (acc, day) => {
      addUniqueCustomer(acc, day, phone);
    }
  );
}

function recordConversationStart() {
  record((b) => {
    b.conversations += 1;
  });
}

function recordInquiryType(type) {
  if (!INQUIRY_KEYS.includes(type)) return;
  record((b) => {
    b.inquiries[type] += 1;
  });
}

function recordQualified() {
  record((b) => {
    b.qualified += 1;
  });
}

function recordOutcome(outcome) {
  record((b) => {
    if (outcome === "success") b.success += 1;
    if (outcome === "rejected") b.rejected += 1;
  });
}

function recordApplication(method) {
  record((b) => {
    if (method === "electronic") b.applications.electronic += 1;
    if (method === "branch") b.applications.branch += 1;
  });
}

module.exports = {
  recordInboundContact,
  recordConversationStart,
  recordInquiryType,
  recordQualified,
  recordOutcome,
  recordApplication,
  getDashboardStats,
  getTrackableAccounts,
  customerKey,
  STATS_PATH: DEFAULT_STATS_PATH,
  getStatsPath,
};
