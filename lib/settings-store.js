/**
 * إعدادات التواصل — ملف منفصل لكل جوال واتساب
 * data/settings-by-wa.json
 */
const fs = require("fs");
const path = require("path");
const CONFIG = require("../config");
const waAccounts = require("./whatsapp-accounts-store");

const DATA_DIR = path.join(__dirname, "..", "data");
const BY_WA_PATH = path.join(DATA_DIR, "settings-by-wa.json");
const LEGACY_PATH = path.join(DATA_DIR, "settings.json");

const FIELD_LABELS = {
  personalAgentName: "التمويل الشخصي — الاسم",
  personalAgentPhone: "التمويل الشخصي — الرقم",
  branchEmployeeName: "زيارة الفرع — الاسم",
  branchEmployeePhone: "زيارة الفرع — الرقم",
  propertyComboAgentName: "الباقة — المسؤول العقاري",
  propertyComboAgentPhone: "الباقة — رقم المسؤول 1",
  propertyComboAgentPhone2: "الباقة — رقم المسؤول 2",
  propertyComboContactFooter: "الباقة — توقيع الرسالة",
  portalUrl: "رابط التقديم",
  serviceStopAgentName: "إيقاف الخدمات — الاسم",
  serviceStopAgentPhone: "إيقاف الخدمات — الرقم",
  serviceStopContactHint: "نص التواصل (إيقاف خدمات)",
};

/** قيم افتراضية عند أول تشغيل — تُستبدل من اللوحة */
const ACCOUNT_SEEDS = {
  majed: {
    personalAgentName: "ماجد",
    personalAgentPhone: "0507009290",
    branchEmployeeName: "ماجد",
    branchEmployeePhone: "0507009290",
    propertyComboAgentName: "المسؤول العقاري",
    propertyComboAgentPhone: "0506279834",
    propertyComboAgentPhone2: "0546473109",
    propertyComboContactFooter: "من طرف ماجد\nبالتوفيق ربي ييسر أمرك",
    serviceStopAgentName: "أبو تركي",
    serviceStopAgentPhone: "0506279834",
    serviceStopContactHint: "من طرف ماجد",
  },
};

function getDefaults() {
  const f = CONFIG.financing;
  const hint =
    f.serviceStopContactHint || CONFIG.brand.contactHint || "من طرف ماجد";
  const personalName = f.personalAgentName || f.employeeName;
  const personalPhone = f.personalAgentPhone || f.employeePhone;
  const comboFooter =
    f.propertyComboContactFooter ||
    "من طرف ماجد\nبالتوفيق ربي ييسر أمرك";
  const comboPhones = Array.isArray(f.propertyComboAgentPhones)
    ? f.propertyComboAgentPhones
    : ["0506279834", "0546473109"];

  return {
    personalAgentName: personalName,
    personalAgentPhone: personalPhone,
    branchEmployeeName: f.branchEmployeeName || personalName,
    branchEmployeePhone: f.branchEmployeePhone || personalPhone,
    propertyComboAgentName: f.propertyComboAgentName || "المسؤول العقاري",
    propertyComboAgentPhone: f.propertyComboAgentPhone || comboPhones[0],
    propertyComboAgentPhone2:
      f.propertyComboAgentPhone2 || comboPhones[1] || comboPhones[0],
    propertyComboContactFooter: comboFooter,
    employeeName: personalName,
    employeePhone: personalPhone,
    portalUrl: f.portalUrl,
    serviceStopAgentName: f.serviceStopAgentName || personalName,
    serviceStopAgentPhone: f.serviceStopAgentPhone || personalPhone,
    serviceStopContactHint: hint,
    ownerControlPhones: "",
  };
}

function normalizeSettings(raw) {
  const defaults = getDefaults();
  const src = raw && typeof raw === "object" ? raw : {};

  const legacyName = String(
    src.personalAgentName ?? src.employeeName ?? defaults.personalAgentName
  ).trim();
  const legacyPhone = String(
    src.personalAgentPhone ?? src.employeePhone ?? defaults.personalAgentPhone
  ).trim();

  return {
    personalAgentName: legacyName,
    personalAgentPhone: legacyPhone,
    branchEmployeeName: String(
      src.branchEmployeeName ?? defaults.branchEmployeeName
    ).trim(),
    branchEmployeePhone: String(
      src.branchEmployeePhone ?? defaults.branchEmployeePhone
    ).trim(),
    propertyComboAgentName: String(
      src.propertyComboAgentName ?? defaults.propertyComboAgentName
    ).trim(),
    propertyComboAgentPhone: String(
      src.propertyComboAgentPhone ?? defaults.propertyComboAgentPhone
    ).trim(),
    propertyComboAgentPhone2: String(
      src.propertyComboAgentPhone2 ?? defaults.propertyComboAgentPhone2
    ).trim(),
    propertyComboContactFooter: String(
      src.propertyComboContactFooter ?? defaults.propertyComboContactFooter
    ).trim(),
    employeeName: legacyName,
    employeePhone: legacyPhone,
    portalUrl: String(src.portalUrl ?? defaults.portalUrl).trim(),
    serviceStopAgentName: String(
      src.serviceStopAgentName ?? defaults.serviceStopAgentName
    ).trim(),
    serviceStopAgentPhone: String(
      src.serviceStopAgentPhone ?? defaults.serviceStopAgentPhone
    ).trim(),
    serviceStopContactHint: String(
      src.serviceStopContactHint ?? defaults.serviceStopContactHint
    ).trim(),
    /** أرقام واتساب اللي تقدر توقف/تشغّل الرد الآلي (مفصولة بفاصلة) — لا تظهر للعميل */
    ownerControlPhones: String(
      src.ownerControlPhones ?? defaults.ownerControlPhones ?? ""
    ).trim(),
  };
}

function seedForAccount(accountId) {
  const id = String(accountId || "").trim();
  const seed = ACCOUNT_SEEDS[id] || {};
  return normalizeSettings({ ...getDefaults(), ...seed });
}

function readLegacySettingsFile() {
  try {
    if (fs.existsSync(LEGACY_PATH)) {
      return normalizeSettings(JSON.parse(fs.readFileSync(LEGACY_PATH, "utf8")));
    }
  } catch (err) {
    console.warn("تعذر قراءة settings.json:", err.message);
  }
  return null;
}

function buildInitialStore() {
  const legacy = readLegacySettingsFile();
  const accounts = {};

  for (const acc of waAccounts.listAccounts().accounts) {
    if (!acc.id || acc.id === "admin") continue;
    const seed = seedForAccount(acc.id);
    if (acc.id === "majed" && legacy) {
      accounts[acc.id] = normalizeSettings({ ...seed, ...legacy });
    } else {
      accounts[acc.id] = seed;
    }
  }

  if (!accounts.majed) {
    accounts.majed = legacy || seedForAccount("majed");
  }

  return { updatedAt: new Date().toISOString(), accounts };
}

function loadSettingsStore() {
  try {
    if (fs.existsSync(BY_WA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BY_WA_PATH, "utf8"));
      if (raw.accounts && typeof raw.accounts === "object") {
        const accounts = {};
        for (const [id, row] of Object.entries(raw.accounts)) {
          // تجاهل حسابات رايد/عبدالرحمن المحذوفة
          if (id === "0488" || id === "wa_1780305984859") continue;
          accounts[id] = normalizeSettings(row);
        }
        return { updatedAt: raw.updatedAt || null, accounts };
      }
    }
  } catch (err) {
    console.warn("تعذر قراءة settings-by-wa.json:", err.message);
  }

  const initial = buildInitialStore();
  saveSettingsStore(initial);
  return initial;
}

function saveSettingsStore(store) {
  store.updatedAt = new Date().toISOString();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const json = JSON.stringify(store, null, 2);
  const tmpPath = BY_WA_PATH + ".tmp";
  fs.writeFileSync(tmpPath, json, "utf8");
  fs.renameSync(tmpPath, BY_WA_PATH);
}

function listSettingsAccounts() {
  const store = loadSettingsStore();
  const waList = waAccounts
    .listAccounts()
    .accounts.filter((a) => a.id && a.id !== "admin");

  return waList.map((acc) => ({
    waAccountId: acc.id,
    label: acc.label || acc.id,
    settings: store.accounts[acc.id] || seedForAccount(acc.id),
  }));
}

function loadSettingsForAccount(waAccountId) {
  const id = String(waAccountId || "").trim();
  if (!id) return getDefaults();

  const store = loadSettingsStore();
  if (store.accounts[id]) {
    return { ...store.accounts[id] };
  }

  const seeded = seedForAccount(id);
  store.accounts[id] = seeded;
  saveSettingsStore(store);
  return { ...seeded };
}

/** @deprecated — استخدم loadSettingsForAccount */
function loadSettings(waAccountId) {
  return loadSettingsForAccount(waAccountId);
}

function mergeInput(input, prev) {
  const src = input && typeof input === "object" ? input : {};
  const patch = {};

  const assign = (key, value) => {
    if (value === undefined || value === null) return;
    const t = String(value).trim();
    if (t) patch[key] = t;
  };

  assign("personalAgentName", src.personalAgentName ?? src.employeeName);
  assign("personalAgentPhone", src.personalAgentPhone ?? src.employeePhone);
  assign("branchEmployeeName", src.branchEmployeeName);
  assign("branchEmployeePhone", src.branchEmployeePhone);
  assign("propertyComboAgentName", src.propertyComboAgentName);
  assign("propertyComboAgentPhone", src.propertyComboAgentPhone);
  assign("propertyComboAgentPhone2", src.propertyComboAgentPhone2);
  assign("propertyComboContactFooter", src.propertyComboContactFooter);
  assign("portalUrl", src.portalUrl);
  assign("serviceStopAgentName", src.serviceStopAgentName);
  assign("serviceStopAgentPhone", src.serviceStopAgentPhone);
  assign("serviceStopContactHint", src.serviceStopContactHint);
  // اختياري — يُسمح بتفريغه
  if (src.ownerControlPhones !== undefined && src.ownerControlPhones !== null) {
    patch.ownerControlPhones = String(src.ownerControlPhones).trim();
  }

  return normalizeSettings({ ...prev, ...patch });
}

function saveSettingsForAccount(waAccountId, input) {
  const id = String(waAccountId || "").trim();
  if (!id) {
    throw new Error("يجب تحديد جوال واتساب");
  }

  const store = loadSettingsStore();
  const prev = store.accounts[id] || seedForAccount(id);
  const next = mergeInput(input, prev);

  const missing = Object.keys(FIELD_LABELS).filter((key) => !next[key]);
  if (missing.length) {
    throw new Error(
      "حقول ناقصة: " + missing.map((k) => FIELD_LABELS[k]).join("، ")
    );
  }

  store.accounts[id] = next;
  saveSettingsStore(store);
  console.log("[settings] تم الحفظ:", id, BY_WA_PATH);
  return next;
}

/** @deprecated */
function saveSettings(input, waAccountId) {
  const id = waAccountId || "majed";
  return saveSettingsForAccount(id, input);
}

/**
 * أرقام التحكم فقط من الحقل الصريح ownerControlPhones.
 * لا تُؤخذ أرقام المندوبين/التواصل (مثل 0507009290 رقم البوت أو أرقام العملاء) —
 * تلك أرقام تظهر للعملاء وليست لجوال التحكم.
 */
function collectOwnerControlPhonesFromSettings() {
  const store = loadSettingsStore();
  const phones = [];
  for (const s of Object.values(store.accounts || {})) {
    if (!s || typeof s !== "object") continue;
    const extra = String(s.ownerControlPhones || "").split(/[,;\n]+/);
    for (const p of extra) {
      if (String(p || "").trim()) phones.push(p.trim());
    }
  }
  return phones.filter(Boolean);
}

module.exports = {
  loadSettings,
  loadSettingsForAccount,
  saveSettings,
  saveSettingsForAccount,
  listSettingsAccounts,
  collectOwnerControlPhonesFromSettings,
  mergeInput,
  getDefaults,
  seedForAccount,
  BY_WA_PATH,
  LEGACY_PATH: BY_WA_PATH,
  SETTINGS_PATH: BY_WA_PATH,
  FIELD_LABELS,
};
