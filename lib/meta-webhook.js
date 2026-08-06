/**
 * تحقق وتفكيك Webhooks من Meta WhatsApp Cloud API
 */
const crypto = require("crypto");
const { getConfig } = require("./meta-client");

function verifyChallenge(query = {}) {
  const cfg = getConfig();
  const mode = String(query["hub.mode"] || "");
  const token = String(query["hub.verify_token"] || "");
  const challenge = String(query["hub.challenge"] || "");

  if (mode === "subscribe" && token && token === cfg.verifyToken) {
    return challenge;
  }
  return null;
}

function verifySignature(rawBody, signatureHeader) {
  const { appSecret } = getConfig();
  if (!appSecret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[meta] META_APP_SECRET غير مضبوط — تم تخطي التحقق");
    }
    return true;
  }

  const header = String(signatureHeader || "").trim();
  const provided = header.startsWith("sha256=")
    ? header.slice("sha256=".length)
    : header;
  if (!provided) return false;

  const raw =
    typeof rawBody === "string"
      ? rawBody
      : Buffer.from(rawBody || "").toString("utf8");
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(raw, "utf8")
    .digest("hex");

  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return provided === expected;
  }
}

/**
 * يستخرج الرسائل النصية الواردة من payload Meta
 * @returns {Array<{phone, messageId, body, type, timestamp, contactName}>}
 */
function parseInboundMessages(payload) {
  if (!payload || payload.object !== "whatsapp_business_account") return [];

  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (change.field && change.field !== "messages") continue;

      const contacts = value.contacts || [];
      const nameByWa = {};
      for (const c of contacts) {
        if (c.wa_id) nameByWa[c.wa_id] = c.profile?.name || null;
      }

      for (const msg of value.messages || []) {
        const phone = String(msg.from || "").replace(/\D/g, "");
        if (!phone) continue;

        let body = "";
        let type = String(msg.type || "text");
        if (type === "text") {
          body = String(msg.text?.body || "").trim();
        } else if (type === "button") {
          body = String(msg.button?.text || msg.button?.payload || "").trim();
        } else if (type === "interactive") {
          body = String(
            msg.interactive?.button_reply?.title ||
              msg.interactive?.list_reply?.title ||
              ""
          ).trim();
        }

        out.push({
          phone,
          messageId: msg.id || null,
          body,
          type,
          timestamp: msg.timestamp || null,
          contactName: nameByWa[phone] || null,
        });
      }
    }
  }
  return out;
}

module.exports = {
  verifyChallenge,
  verifySignature,
  parseInboundMessages,
};
