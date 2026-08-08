/**
 * تمييز رسائل البوت الصادرة عن رسائل المالك اليدوية (fromMe).
 * حتى لا يوقف البوت نفسه عند كل رد تلقائي.
 */
const recentBotMessageIds = new Map();
const recentBotBodies = new Map();
const TTL_MS = 120000;

function prune(map, now) {
  for (const [key, ts] of map.entries()) {
    if (now - ts > TTL_MS) map.delete(key);
  }
}

function markBotOutbound(msgOrId, body) {
  const now = Date.now();
  prune(recentBotMessageIds, now);
  prune(recentBotBodies, now);

  const id =
    typeof msgOrId === "string"
      ? msgOrId
      : msgOrId?.id?._serialized || msgOrId?.id?.id || msgOrId?.id || null;
  if (id) recentBotMessageIds.set(String(id), now);

  const text = String(body || msgOrId?.body || "")
    .trim()
    .slice(0, 120);
  if (text) recentBotBodies.set(text, now);
}

function isBotOutbound(msg) {
  const now = Date.now();
  prune(recentBotMessageIds, now);
  prune(recentBotBodies, now);

  const id = msg?.id?._serialized || msg?.id?.id || msg?.id;
  if (id && recentBotMessageIds.has(String(id))) return true;

  const text = String(msg?.body || "").trim().slice(0, 120);
  if (text && recentBotBodies.has(text)) return true;

  return false;
}

function beginBotSend() {
  // علامة زمنية قصيرة: أي fromMe خلال الإرسال يُعتبر من البوت إن تطابق النص
  return {
    mark(result, body) {
      markBotOutbound(result, body);
    },
  };
}

module.exports = {
  markBotOutbound,
  isBotOutbound,
  beginBotSend,
};
