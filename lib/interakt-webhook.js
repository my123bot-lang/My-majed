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
    // في التطوير فقط — على الإنتاج يجب ضبط السر
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

function parseInboundMessage(payload) {
  if (!payload || payload.type !== "message_received") return null;

  const customer = payload.data?.customer || {};
  const message = payload.data?.message || {};
  // Interakt: channel_phone_number = رقم العميل كامل مع مفتاح الدولة (مثل 9665xxxxxxx)
  const channelPhone = String(
    customer.channel_phone_number ||
      customer.phone_number ||
      customer.traits?.phone ||
      customer.traits?.whatsapp_number ||
      ""
  ).replace(/\D/g, "");

  if (!channelPhone) return null;

  const contentType = String(message.message_content_type || "Text");
  let body = "";
  if (contentType === "Text" || contentType === "Button" || contentType === "QuickReply") {
    body = String(message.message || message.text || "").trim();
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
  getWebhookSecret,
};
