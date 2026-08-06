/**
 * حسابات واتساب المتعددة — data/whatsapp-accounts.json
 * كل حساب له مجلد جلسة منفصل عبر LocalAuth({ clientId })
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "whatsapp-accounts.json");

function defaultStore() {
  return {
    updatedAt: new Date().toISOString(),
    activeId: "majed",
    accounts: [
      {
        id: "majed",
        label: "ماجد",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

const KNOWN_ACCOUNT_LABELS = {
  majed: "ماجد",
};

function readSettingsAccountIds() {
  const settingsPath = path.join(DATA_DIR, "settings-by-wa.json");
  try {
    if (!fs.existsSync(settingsPath)) return [];
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return Object.keys(raw.accounts || {}).filter((id) => id && id !== "main");
  } catch (_) {
    return [];
  }
}

/** استعادة الحسابات إذا بقي فقط main/admin بعد تلف الملف */
function repairAccountsIfNeeded(store) {
  const skip = new Set(["admin", "main"]);
  const runnable = store.accounts.filter((a) => !skip.has(a.id));
  if (runnable.length > 0) return store;

  const ids = readSettingsAccountIds();
  if (!ids.length) return store;

  const now = new Date().toISOString();
  const restored = ids.map((id) => ({
    id: String(id).trim(),
    label: KNOWN_ACCOUNT_LABELS[id] || String(id),
    createdAt: now,
  }));

  const keepAdmin = store.accounts.filter((a) => a.id === "admin");
  const next = {
    ...store,
    activeId: ids.includes(store.activeId) ? store.activeId : ids[0],
    accounts: [...keepAdmin, ...restored],
  };
  saveStore(next);
  console.warn(
    "[حسابات واتساب] تم استعادة",
    restored.length,
    "حساب/حسابات من settings-by-wa.json"
  );
  return next;
}

const REMOVED_ACCOUNT_IDS = new Set(["0488", "wa_1780305984859"]);

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      if (Array.isArray(raw.accounts) && raw.accounts.length) {
        let accounts = raw.accounts
          .map((a) => ({
            id: String(a.id).trim(),
            label: String(a.label || a.id).trim(),
            createdAt: a.createdAt || new Date().toISOString(),
          }))
          .filter((a) => !REMOVED_ACCOUNT_IDS.has(a.id));

        if (!accounts.length) {
          accounts = defaultStore().accounts;
        }

        let activeId = String(raw.activeId || "").trim();
        if (
          REMOVED_ACCOUNT_IDS.has(activeId) ||
          !accounts.some((a) => a.id === activeId)
        ) {
          activeId = accounts[0].id;
        }

        let store = {
          ...defaultStore(),
          ...raw,
          activeId,
          accounts,
        };
        if (
          accounts.length !== raw.accounts.length ||
          activeId !== String(raw.activeId || "").trim()
        ) {
          saveStore(store);
        }
        return repairAccountsIfNeeded(store);
      }
    }
  } catch (err) {
    console.warn("تعذر قراءة whatsapp-accounts.json:", err.message);
  }
  const store = defaultStore();
  saveStore(store);
  return repairAccountsIfNeeded(store);
}

function saveStore(store) {
  store.updatedAt = new Date().toISOString();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  return store;
}

function slugifyId(input) {
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  return s || `wa_${Date.now()}`;
}

function validateId(id) {
  const s = String(id || "").trim();
  if (!/^[a-z0-9_-]{2,32}$/i.test(s)) {
    throw new Error("معرّف الحساب: حروف إنجليزية وأرقام و _ فقط (2–32)");
  }
  return s.toLowerCase();
}

function listAccounts() {
  const store = loadStore();
  return {
    activeId: store.activeId,
    accounts: store.accounts.map((a) => ({
      ...a,
      isActive: a.id === store.activeId,
    })),
  };
}

function getActiveAccount() {
  const store = loadStore();
  const acc =
    store.accounts.find((a) => a.id === store.activeId) || store.accounts[0];
  return acc;
}

function getAccountById(id) {
  const accountId = validateId(id);
  const acc = loadStore().accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("الحساب غير موجود");
  return acc;
}

/** حسابات التشغيل المزدوج — استثناء معرّفات قديمة/تجريبية */
function listRunnableAccounts() {
  const skip = new Set(["admin", "main"]);
  return loadStore().accounts.filter((a) => !skip.has(a.id));
}

function addAccount({ label, id }) {
  const store = loadStore();
  const accountId = id ? validateId(id) : slugifyId(label);
  if (store.accounts.some((a) => a.id === accountId)) {
    throw new Error("معرّف الحساب مستخدم مسبقاً");
  }
  const labelText = String(label || accountId).trim();
  if (!labelText) throw new Error("اسم الحساب مطلوب");

  const account = {
    id: accountId,
    label: labelText,
    createdAt: new Date().toISOString(),
  };
  store.accounts.push(account);
  saveStore(store);
  return account;
}

function setActiveAccount(id) {
  const store = loadStore();
  const accountId = validateId(id);
  if (!store.accounts.some((a) => a.id === accountId)) {
    throw new Error("الحساب غير موجود");
  }
  store.activeId = accountId;
  saveStore(store);
  return getActiveAccount();
}

function deleteAccount(id) {
  const store = loadStore();
  const accountId = validateId(id);
  if (store.activeId === accountId) {
    throw new Error("لا يمكن حذف الحساب النشط — فعّل حساباً آخر أولاً");
  }
  if (store.accounts.length <= 1) {
    throw new Error("يجب بقاء حساب واحد على الأقل");
  }
  store.accounts = store.accounts.filter((a) => a.id !== accountId);
  saveStore(store);
  return { ok: true };
}

module.exports = {
  STORE_PATH,
  loadStore,
  listAccounts,
  getActiveAccount,
  getAccountById,
  listRunnableAccounts,
  addAccount,
  setActiveAccount,
  deleteAccount,
  slugifyId,
};
