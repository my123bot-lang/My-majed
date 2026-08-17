/**
 * طابور رسائل صادرة من اللوحة — البوت يرسلها عبر whatsapp-web.js
 * data/outbound-wa-queue.json
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const QUEUE_PATH = path.join(DATA_DIR, "outbound-wa-queue.json");
const MAX_ITEMS = 500;
const STALE_PROCESSING_MS = 90 * 1000;

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
      if (Array.isArray(raw.items)) {
        return { updatedAt: raw.updatedAt || null, items: raw.items };
      }
    }
  } catch (err) {
    console.warn("تعذر قراءة outbound-wa-queue.json:", err.message);
  }
  return { updatedAt: null, items: [] };
}

function saveQueue(store) {
  store.updatedAt = new Date().toISOString();
  if (store.items.length > MAX_ITEMS) {
    store.items = store.items.slice(-MAX_ITEMS);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = QUEUE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, QUEUE_PATH);
}

function enqueue({ waAccountId, phone, message, leadId, delayMs }) {
  const accountId = String(waAccountId || "").trim();
  const phoneText = String(phone || "").trim();
  const body = String(message || "").trim();
  if (!accountId) throw new Error("يجب تحديد جوال البوت");
  if (!phoneText) throw new Error("رقم العميل مطلوب");
  if (!body) throw new Error("نص الرسالة مطلوب");

  const store = loadQueue();
  const item = {
    id: newId(),
    waAccountId: accountId,
    phone: phoneText,
    message: body,
    leadId: leadId || null,
    delayMs: Number(delayMs) > 0 ? Number(delayMs) : null,
    status: "pending",
    createdAt: new Date().toISOString(),
    processingAt: null,
    sentAt: null,
    error: null,
    attempts: 0,
  };
  store.items.push(item);
  saveQueue(store);
  return item;
}

function claimPending(waAccountId, limit = 1) {
  const accountId = String(waAccountId || "").trim();
  if (!accountId) return [];

  const store = loadQueue();
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

    if (
      item.status === "processing" &&
      item.processingAt &&
      now - item.processingAt > STALE_PROCESSING_MS &&
      (item.attempts || 0) < 3
    ) {
      item.processingAt = now;
      item.attempts = (item.attempts || 0) + 1;
      claimed.push({ ...item });
    }
  }

  if (claimed.length) saveQueue(store);
  return claimed;
}

function markSent(id) {
  const store = loadQueue();
  const item = store.items.find((r) => r.id === id);
  if (!item) return null;
  item.status = "sent";
  item.sentAt = new Date().toISOString();
  item.error = null;
  saveQueue(store);
  return item;
}

function markFailed(id, errorMessage) {
  const store = loadQueue();
  const item = store.items.find((r) => r.id === id);
  if (!item) return null;
  const attempts = item.attempts || 1;
  if (attempts >= 3) {
    item.status = "failed";
  } else {
    item.status = "pending";
  }
  item.processingAt = null;
  item.error = String(errorMessage || "فشل الإرسال").slice(0, 300);
  saveQueue(store);
  return item;
}

function countPending(waAccountId) {
  const accountId = String(waAccountId || "").trim();
  const store = loadQueue();
  return store.items.filter(
    (i) =>
      i.waAccountId === accountId &&
      (i.status === "pending" || i.status === "processing")
  ).length;
}

/** آخر عنصر في الطابور لكل leadId */
function getLatestByLeadIds(leadIds) {
  const wanted = new Set((leadIds || []).filter(Boolean));
  if (!wanted.size) return {};

  const store = loadQueue();
  const map = {};

  for (const item of store.items) {
    if (!item.leadId || !wanted.has(item.leadId)) continue;
    const prev = map[item.leadId];
    if (
      !prev ||
      new Date(item.createdAt).getTime() >= new Date(prev.createdAt).getTime()
    ) {
      map[item.leadId] = {
        status: item.status,
        error: item.error || null,
        createdAt: item.createdAt,
        sentAt: item.sentAt || null,
      };
    }
  }

  return map;
}

function getQueueSummary(waAccountId) {
  const accountId = String(waAccountId || "").trim();
  const store = loadQueue();
  const summary = { pending: 0, processing: 0, sent: 0, failed: 0, total: 0 };

  for (const item of store.items) {
    if (accountId && item.waAccountId !== accountId) continue;
    summary.total += 1;
    if (item.status === "pending") summary.pending += 1;
    else if (item.status === "processing") summary.processing += 1;
    else if (item.status === "sent") summary.sent += 1;
    else if (item.status === "failed") summary.failed += 1;
  }

  summary.waiting = summary.pending + summary.processing;
  return summary;
}

module.exports = {
  enqueue,
  claimPending,
  markSent,
  markFailed,
  countPending,
  getLatestByLeadIds,
  getQueueSummary,
  loadQueue,
  QUEUE_PATH,
};
