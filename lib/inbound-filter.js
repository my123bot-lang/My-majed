/**
 * تجاهل رسائل لا تخص مسار العميل (روابط لوحة التحكم، روابط عامة، تكرار)
 */
const { normalizeText } = require("./validators");

const MAX_DEDUP_IDS = 400;
const DEDUP_BODY_MS = 12 * 1000;

/** @type {Map<string, number>} */
const seenMessageIds = new Map();
/** @type {Map<string, number>} */
const seenBodyKeys = new Map();

function pruneMap(map, maxSize) {
  if (map.size <= maxSize) return;
  const entries = [...map.entries()].sort((a, b) => a[1] - b[1]);
  const drop = entries.length - Math.floor(maxSize * 0.6);
  for (let i = 0; i < drop; i++) {
    map.delete(entries[i][0]);
  }
}

function messageIdKey(msg) {
  const id = msg?.id;
  if (!id) return null;
  if (typeof id === "string") return id;
  if (id._serialized) return String(id._serialized);
  if (id.id) return String(id.id);
  return null;
}

function isDuplicateMessage(msg) {
  const key = messageIdKey(msg);
  if (!key) return false;
  if (seenMessageIds.has(key)) return true;
  seenMessageIds.set(key, Date.now());
  pruneMap(seenMessageIds, MAX_DEDUP_IDS);
  return false;
}

function isDuplicateBody(from, body) {
  const fromKey = String(from || "");
  const text = normalizeText(String(body || "")).trim();
  if (!fromKey || !text) return false;

  const { isMenuStyleReply } = require("./validators");
  if (isMenuStyleReply(text)) return false;

  const key = fromKey + "|" + text.slice(0, 240);
  const now = Date.now();
  const prev = seenBodyKeys.get(key);
  if (prev && now - prev < DEDUP_BODY_MS) return true;
  seenBodyKeys.set(key, now);
  pruneMap(seenBodyKeys, MAX_DEDUP_IDS);
  return false;
}

/** رابط لوحة التحكم أو رابط ويب — لا يرد عليه البوت */
function isPortalOrWebLink(text) {
  const t = normalizeText(String(text || "")).trim();
  if (!t) return false;

  if (/^https?:\/\//i.test(t)) return true;
  if (/\bwww\./i.test(t)) return true;

  if (
    /127\.0\.0\.1/i.test(t) ||
    /\blocalhost\b/i.test(t) ||
    /:3000\b/.test(t) ||
    /\/p\/[a-z0-9_-]+/i.test(t) ||
    /[?&](k|key|token)=/i.test(t)
  ) {
    return true;
  }

  if (t.length > 80 && /^[a-z0-9./:?&=_-]+$/i.test(t.replace(/\s/g, ""))) {
    return true;
  }

  return false;
}

/**
 * @returns {{ skip: boolean, reason?: string }}
 */
function shouldSkipInboundMessage(msg) {
  const body = String(msg?.body || "").trim();

  if (isDuplicateMessage(msg)) {
    return { skip: true, reason: "duplicate_id" };
  }
  if (isDuplicateBody(msg?.from, body)) {
    return { skip: true, reason: "duplicate_body" };
  }
  if (isPortalOrWebLink(body)) {
    return { skip: true, reason: "portal_or_link" };
  }

  return { skip: false };
}

module.exports = {
  shouldSkipInboundMessage,
  isPortalOrWebLink,
  isDuplicateMessage,
  isDuplicateBody,
};
