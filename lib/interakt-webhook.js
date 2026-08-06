/**
 * تحقق وتفكيك Webhooks من Interakt
 */
const crypto = require("crypto");

function getWebhookSecret() {
  return String(process.env.INTERAKT_WEBHOOK_SECRET || "").trim();
}

/**
 * Interakt-Signature: sha256=<hex>
 */
function verifySignature(rawBody, signatureHeader) {
  const secret = getWebhookSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") return false;
    console.warn("[interakt] لا يوجد INTERAKT_WEBHOOK_SECRET — تم تخطي التحقق");
    return true;
  }

  const header = String(signatureHeader || "").trim();
  const provided = header.startsWith("sha256=")
    ? header.slice("sha256=".length)
    : header;
  if (!provided) return false;

  const raw =
    typeof rawBody === "string" ? rawBody : Buffer.from(rawBody || "").toString("utf8");
  const expected = crypto
    .createHmac("sha256", secret)
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

function extractInteractiveChoice(rawMessage) {
  const raw = String(rawMessage || "").trim();
  if (!raw) return "";

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const list = parsed.list_reply || parsed.listReply || null;
      const button = parsed.button_reply || parsed.buttonReply || null;
      // فضّل العنوان على المعرف الرقمي حتى لا يُفهم "2" لاحقاً كراتب
      if (list) {
        return String(list.title || list.id || "").trim();
      }
      if (button) {
        return String(button.title || button.id || "").trim();
      }
      return String(
        parsed.title || parsed.id || parsed.text || parsed.payload || ""
      ).trim();
    } catch (_) {
      return raw;
    }
  }

  return raw;
}

/**
 * Interakt قد يرسل button_id رقمياً في meta مع العنوان في message JSON.
 * لا نفضّل المعرف الرقمي وحده — وإلا زر «مدني»(2) يُفهم كراتب=2.
 */
function resolveInboundBody(message, metaId) {
  const candidates = [
    message?.message,
    message?.text,
    message?.button_text,
    message?.button_title,
    metaId,
  ];

  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    const raw = String(candidate).trim();
    if (!raw) continue;
    if (raw.startsWith("{")) {
      const extracted = extractInteractiveChoice(raw);
      if (extracted) return extracted;
      continue;
    }
  }

  const titleHint = String(
    message?.button_text || message?.button_title || message?.text || ""
  ).trim();
  const id = metaId != null ? String(metaId).trim() : "";
  if (titleHint && id && /^\d{1,3}$/.test(id) && !titleHint.startsWith("{")) {
    return titleHint;
  }
  if (id) return id;
  if (titleHint && !titleHint.startsWith("{")) return titleHint;

  return extractInteractiveChoice(message?.message || "");
}

function parseInboundMessage(payload) {
  if (!payload || payload.type !== "message_received") return null;

  const customer = payload.data?.customer || {};
  const message = payload.data?.message || {};
  const channelPhone = String(
    customer.channel_phone_number ||
      customer.phone_number ||
      customer.traits?.phone ||
      customer.traits?.whatsapp_number ||
      ""
  ).replace(/\D/g, "");

  if (!channelPhone) return null;

  const contentType = String(message.message_content_type || "Text");
  const meta = message.meta_data || {};
  const metaId =
    meta.button_id ||
    meta.buttonId ||
    meta.payload ||
    meta.list_reply_id ||
    meta.id ||
    null;

  const interactiveTypes = new Set([
    "Text",
    "Button",
    "QuickReply",
    "List",
    "Interactive",
    "InteractiveButtonReply",
    "InteractiveListReply",
    "InteractiveButton",
    "InteractiveList",
  ]);

  let body = "";
  if (interactiveTypes.has(contentType) || contentType.includes("Interactive")) {
    body = resolveInboundBody(message, metaId);
  } else if (message.message) {
    // أي نوع آخر فيه نص — نحاول استخراج اختيار تفاعلي إن وُجد
    body = extractInteractiveChoice(message.message);
  }

  return {
    type: "message_received",
    customerId: customer.id || null,
    phone: channelPhone,
    messageId: message.id || null,
    body,
    contentType,
    mediaUrl: message.media_url || null,
    receivedAt: message.received_at_utc || payload.timestamp || null,
    rawCustomer: {
      id: customer.id || null,
      channel_phone_number: customer.channel_phone_number || null,
      phone_number: customer.phone_number || null,
    },
    raw: payload,
  };
}

module.exports = {
  verifySignature,
  parseInboundMessage,
  extractInteractiveChoice,
  resolveInboundBody,
  getWebhookSecret,
};
