/**
 * طابور فتح محادثة — ملف منفصل لكل جوال واتساب
 * data/open-chat-queue-{accountId}.json
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGACY_PATH = path.join(DATA_DIR, "open-chat-queue.json");
const MAX_ITEMS = 200;
const STALE_PROCESSING_MS = 30 * 1000;

function safeFilePart(accountId) {
  return String(accountId || "default").replace(/[^a-z0-9_-]/gi, "_");
}

function queuePathForAccount(waAccountId) {
  return path.join(DATA_DIR, `open-chat-queue-${safeFilePart(waAccountId)}.json`);
}

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function loadQueue(waAccountId) {
  const accountId = String(waAccountId || "").trim();
  const path = queuePathForAccount(accountId);
  try {
    if (fs.existsSync(path)) {
      const raw = JSON.parse(fs.readFileSync(path, "utf8"));
      if (Array.isArray(raw.items)) {
        return { updatedAt: raw.updatedAt || null, items: raw.items };
      }
    }
  } catch (err) {
    console.warn("تعذر قراءة", path, err.message);
  }
  return { updatedAt: null, items: [] };
}

function saveQueue(waAccountId, store) {
  const accountId = String(waAccountId || "").trim();
  store.updatedAt = new Date().toISOString();
  if (store.items.length > MAX_ITEMS) {
    store.items = store.items.slice(-MAX_ITEMS);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = queuePathForAccount(accountId);
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function migrateLegacyPending(accountId) {
  try {
    if (!fs.existsSync(LEGACY_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(LEGACY_PATH, "utf8"));
    if (!Array.isArray(raw.items)) return;

    const pending = raw.items.filter(
      (i) =>
        i.waAccountId === accountId &&
        (i.status === "pending" || i.status === "processing")
    );
    if (!pending.length) return;

    const store = loadQueue(accountId);
    for (const item of pending) {
      if (!store.items.some((x) => x.id === item.id)) {
        store.items.push(item);
      }
    }
    saveQueue(accountId, store);

    raw.items = raw.items.filter(
      (i) => !(i.waAccountId === accountId && pending.some((p) => p.id === i.id))
    );
    fs.writeFileSync(LEGACY_PATH, JSON.stringify(raw, null, 2), "utf8");
  } catch (_) {}
}

function getItem(id, waAccountId) {
  if (waAccountId) {
    const store = loadQueue(waAccountId);
    return store.items.find((r) => r.id === id) || null;
  }
  try {
    const files = fs.readdirSync(DATA_DIR);
    for (const name of files) {
      if (!name.startsWith("open-chat-queue-") || !name.endsWith(".json")) continue;
      const store = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, name), "utf8")
      );
      const hit = (store.items || []).find((r) => r.id === id);
      if (hit) return hit;
    }
  } catch (_) {}
  if (fs.existsSync(LEGACY_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(LEGACY_PATH, "utf8"));
      return (raw.items || []).find((r) => r.id === id) || null;
    } catch (_) {}
  }
  return null;
}

function enqueue({ waAccountId, phone, digits }) {
  const accountId = String(waAccountId || "").trim();
  const phoneText = String(phone || "").trim();
  const digitText = String(digits || "").trim();
  if (!accountId) throw new Error("يجب تحديد جوال البوت");
  if (!phoneText && !digitText) throw new Error("رقم العميل مطلوب");

  migrateLegacyPending(accountId);
  const store = loadQueue(accountId);
  const item = {
    id: newId(),
    waAccountId: accountId,
    phone: phoneText,
    digits: digitText,
    status: "pending",
    createdAt: new Date().toISOString(),
    processingAt: null,
    doneAt: null,
    result: null,
    error: null,
    attempts: 0,
  };
  store.items.push(item);
  saveQueue(accountId, store);
  return item;
}

function claimPending(waAccountId, limit = 2) {
  const accountId = String(waAccountId || "").trim();
  if (!accountId) return [];

  migrateLegacyPending(accountId);
  const store = loadQueue(accountId);
  const now = Date.now();
  const claimed = [];

  for (const item of store.items) {
    if (claimed.length >= limit) break;
    if (item.waAccountId !== accountId) continue;

    if (item.status === "pending") {
      item.status = "processing";
      item.processingAt = now;
      item.attempts = (item.attempts || 0) + 1;
      claimed.push({ ...item });
      continue;
    }

    const procAt = Number(item.processingAt) || 0;
    if (
      item.status === "processing" &&
      procAt &&
      now - procAt > STALE_PROCESSING_MS &&
      (item.attempts || 0) < 3
    ) {
      item.processingAt = now;
      item.attempts = (item.attempts || 0) + 1;
      claimed.push({ ...item });
    }
  }

  if (claimed.length) saveQueue(accountId, store);
  return claimed;
}

function markDone(id, result, waAccountId) {
  const accountId = String(waAccountId || "").trim();
  const store = loadQueue(accountId);
  const item = store.items.find((r) => r.id === id);
  if (!item) return null;
  item.status = "done";
  item.doneAt = new Date().toISOString();
  item.result = result || { ok: true };
  item.error = null;
  saveQueue(accountId, store);
  return item;
}

function markFailed(id, errorMessage, waAccountId) {
  const accountId = String(waAccountId || "").trim();
  const store = loadQueue(accountId);
  const item = store.items.find((r) => r.id === id);
  if (!item) return null;
  const attempts = item.attempts || 1;
  if (attempts >= 3) {
    item.status = "failed";
  } else {
    item.status = "pending";
    item.processingAt = null;
  }
  item.error = String(errorMessage || "فشل فتح المحادثة").slice(0, 300);
  saveQueue(accountId, store);
  return item;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function botStartHint(accountId) {
  if (accountId === "majed") return "start-majed.bat أو start-bot.bat";
  if (accountId === "majed") return "start-majed.bat";
  return `start-bot-account.bat ${accountId}`;
}

async function waitForResult(id, timeoutMs = 40000, waAccountId) {
  const accountId = String(waAccountId || "").trim();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const item = getItem(id, accountId);
    if (!item) throw new Error("طلب فتح المحادثة غير موجود");
    if (item.status === "done") {
      return { ok: true, ...(item.result || {}) };
    }
    if (item.status === "failed") {
      throw new Error(item.error || "تعذّر فتح المحادثة");
    }
    await sleep(200);
  }
  const hint = botStartHint(accountId);
  throw new Error(
    `انتهى الوقت — تأكد أن نافذة بوت ماجد (${accountId}) مفتوحة و«جاهز» ثم شغّل: ${hint}`
  );
}

module.exports = {
  enqueue,
  claimPending,
  markDone,
  markFailed,
  waitForResult,
  getItem,
  loadQueue,
  migrateLegacyPending,
  queuePathForAccount,
  LEGACY_PATH,
};
