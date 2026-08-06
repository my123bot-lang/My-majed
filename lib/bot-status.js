/**
 * حالة البوت — ملف منفصل لكل حساب واتساب (تشغيل متعدد)
 * data/bot-status-{accountId}.json
 */
const fs = require("fs");
const path = require("path");
const waAccounts = require("./whatsapp-accounts-store");
const { debugPortForAccount } = require("./wa-debug-port");

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGACY_PATH = path.join(DATA_DIR, "bot-status.json");
/** بدون نبض حديث — يُعتبر البوت متوقفاً */
const STALE_MS = 90 * 1000;
/** وهو «ready» — يُسمح بفتح المحادثة من اللوحة لفترة أطول */
const STALE_READY_MS = 6 * 60 * 60 * 1000;

function emptyStatus(accountId = null, label = null) {
  return {
    updatedAt: null,
    accountId,
    label,
    status: "offline",
    qr: null,
    phone: null,
    reason: null,
    pid: null,
    botProcessAlive: false,
  };
}

function safeFilePart(accountId) {
  return String(accountId || "default").replace(/[^a-z0-9_-]/gi, "_");
}

function statusPathForAccount(accountId) {
  return path.join(DATA_DIR, `bot-status-${safeFilePart(accountId)}.json`);
}

function readStatusForAccount(accountId) {
  const path = statusPathForAccount(accountId);
  try {
    if (fs.existsSync(path)) {
      return { ...emptyStatus(), ...JSON.parse(fs.readFileSync(path, "utf8")) };
    }
  } catch (err) {
    console.warn("تعذر قراءة", path, err.message);
  }
  try {
    if (fs.existsSync(LEGACY_PATH)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_PATH, "utf8"));
      if (legacy.accountId === accountId) {
        return { ...emptyStatus(), ...legacy };
      }
    }
  } catch (_) {}
  return emptyStatus(accountId);
}

function isAlive(raw) {
  try {
    if (raw.updatedAt) {
      const age = Date.now() - new Date(raw.updatedAt).getTime();
      const limit =
        raw.status === "ready" || raw.status === "qr" || raw.status === "starting"
          ? STALE_READY_MS
          : STALE_MS;
      return age < limit;
    }
  } catch (_) {}
  return false;
}

function normalizeDisplayStatus(raw) {
  let displayStatus = raw.status || "offline";
  const alive = isAlive(raw);
  if (!alive && displayStatus !== "offline") {
    displayStatus = "offline";
  }
  return { displayStatus, botProcessAlive: alive };
}

function writeStatusForAccount(accountId, patch) {
  const prev = readStatusForAccount(accountId);
  const next = {
    ...prev,
    ...patch,
    accountId,
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    debugPort: patch.debugPort ?? prev.debugPort ?? debugPortForAccount(accountId),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    statusPathForAccount(accountId),
    JSON.stringify(next, null, 2),
    "utf8"
  );
  return next;
}

/** @deprecated — يستخدم الحساب الحالي من السياق */
let contextAccountId = null;

function configureAccount(accountId) {
  contextAccountId = accountId;
}

function writeStatus(patch) {
  if (!contextAccountId) {
    throw new Error("bot-status: لم يُحدد حساب (configureAccount)");
  }
  return writeStatusForAccount(contextAccountId, patch);
}

function readStatus() {
  if (contextAccountId) return readStatusForAccount(contextAccountId);
  return emptyStatus();
}

function getStatusForAccount(accountId) {
  const acc = waAccounts.getAccountById(accountId);
  const raw = readStatusForAccount(accountId);
  const { displayStatus, botProcessAlive } = normalizeDisplayStatus(raw);
  return {
    ...raw,
    accountId: acc.id,
    label: acc.label,
    status: displayStatus,
    botProcessAlive,
  };
}

function getAllStatusesForDashboard() {
  const { accounts, activeId } = waAccounts.listAccounts();
  return accounts.map((a) => ({
    ...getStatusForAccount(a.id),
    isActive: a.id === activeId,
  }));
}

function getStatusForDashboard() {
  const statuses = getAllStatusesForDashboard();
  const active = waAccounts.getActiveAccount();
  const primary =
    statuses.find((s) => s.accountId === active.id) ||
    statuses[0] ||
    emptyStatus(active.id, active.label);
  const runningCount = statuses.filter((s) => s.botProcessAlive).length;

  return {
    ...primary,
    statuses,
    dualMode: true,
    runningCount,
    totalAccounts: statuses.length,
  };
}

function clearQr(accountId) {
  const id = accountId || contextAccountId;
  return writeStatusForAccount(id, { qr: null });
}

module.exports = {
  LEGACY_PATH,
  configureAccount,
  statusPathForAccount,
  readStatusForAccount,
  writeStatusForAccount,
  readStatus,
  writeStatus,
  getStatusForAccount,
  getAllStatusesForDashboard,
  getStatusForDashboard,
  clearQr,
};
