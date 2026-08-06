/**
 * إحصائية التواصل — إجمالي + حسب جوال واتساب (data/call-stats.json)
 */
const fs = require("fs");
const path = require("path");
const { getCurrentWaAccountId } = require("./current-wa-account");
const waAccounts = require("./whatsapp-accounts-store");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATS_PATH = path.join(DATA_DIR, "call-stats.json");

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
    store.byAccount[id] = { totals: emptyBucket(), daily: {} };
  }
  return store.byAccount[id];
}

function recomputeGlobalTotals(store) {
  store.totals = emptyBucket();
  store.daily = {};
  for (const acc of Object.values(store.byAccount)) {
    mergeBucket(store.totals, acc.totals);
    for (const [day, bucket] of Object.entries(acc.daily || {})) {
      if (!store.daily[day]) store.daily[day] = emptyBucket();
      mergeBucket(store.daily[day], bucket);
    }
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
    delete store.byAccount.unknown;
  }

  recomputeGlobalTotals(store);
  store.updatedAt = raw.updatedAt || store.updatedAt;
  return store;
}

function loadStore() {
  try {
    if (fs.existsSync(STATS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATS_PATH, JSON.stringify(store, null, 2), "utf8");
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

function record(mutate) {
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
  const acc = store.byAccount[accountId] || { totals: emptyBucket(), daily: {} };
  const today = todayKey();
  return {
    waAccountId: accountId,
    label: accountLabel(accountId),
    today: acc.daily[today] || emptyBucket(),
    totals: acc.totals,
    last7Days: getLastDaysFromDaily(acc.daily, 7),
  };
}

function getDashboardStats(options = {}) {
  const store = loadStore();
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

  return {
    updatedAt: store.updatedAt,
    inquiryLabels: INQUIRY_LABELS,
    accounts,
    today: store.daily[today] || emptyBucket(),
    totals: store.totals,
    last7Days: getLastDaysFromDaily(store.daily, 7),
  };
}

function recordInboundContact() {
  record((b) => {
    b.contacts += 1;
  });
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
  STATS_PATH,
};
