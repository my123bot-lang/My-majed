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

function extractCustomerPhone(payload) {
  const customer = payload?.data?.customer || {};
  return String(
    customer.channel_phone_number ||
      customer.phone_number ||
      customer.traits?.phone ||
      customer.traits?.whatsapp_number ||
      ""
  ).replace(/\D/g, "");
}

function extractPlainOutboundText(message) {
  if (!message) return "";
  const contentType = String(message.message_content_type || "").toLowerCase();
  // القوالب ليست أوامر stop/start من المالك
  if (message.is_template_message || contentType === "template") return "";

  const candidates = [
    message.message,
    message.text,
    message.button_text,
    message.button_title,
  ];
  for (const c of candidates) {
    if (c == null || c === "") continue;
    const raw = String(c).trim();
    if (!raw || raw.startsWith("{") || raw.startsWith("[")) continue;
    if (raw.length > 80) continue;
    return raw;
  }
  return "";
}

/**
 * رسائل صادرة من الوكيل/المالك (غير CustomerMessage) لأوامر stop/start في السحابة.
 *
 * حدود Interakt (من وثائقهم الرسمية):
 * - message_received = رسائل واردة من العميل فقط (chat_message_type: CustomerMessage)
 * - message_api_sent/delivered/read/failed = حالة قوالب HSM المُرسلة عبر API/حملات
 * - لا يوجد webhook موثّق لكتابة المالك من تطبيق واتساب الأعمال داخل محادثة العميل
 *
 * لذلك هذا المسار يعمل فقط إن أرسل Interakt حدثاً غير موثّق (مثلاً AgentMessage من
 * صندوق Interakt). لـ Stop من التطبيق استخدم OWNER_CONTROL_PHONES أو لوحة العملاء.
 *
 * @returns {{ phone: string, body: string, messageId: string|null, chatMessageType: string, type: string }|null}
 */
function parseOwnerOutboundCommand(payload) {
  if (!payload || !payload.type) return null;

  const type = String(payload.type);
  const message = payload.data?.message || {};
  const chatMessageType = String(message.chat_message_type || "");

  // رسالة العميل العادية تُعالج في مسار الوارد
  if (type === "message_received" && chatMessageType === "CustomerMessage") {
    return null;
  }

  // message_api_* في الوثائق = قوالب فقط — نتخطّاها أدناه عبر is_template_message
  const looksOutbound =
    type === "message_received" ||
    type === "message_sent" ||
    type === "message_api_sent" ||
    /^message_/i.test(type);

  if (!looksOutbound) return null;

  // لا نعالج قوالب الحملات / HSM كأوامر مالك (وهذا يغطي تقريباً كل message_api_*)
  if (
    type.startsWith("message_campaign_") ||
    message.is_template_message ||
    String(message.message_content_type || "").toLowerCase() === "template"
  ) {
    return null;
  }

  // لـ message_received: فقط غير CustomerMessage (إن وُجد نوع وكيل غير موثّق)
  if (type === "message_received") {
    if (!chatMessageType || chatMessageType === "CustomerMessage") return null;
  }

  // PublicApiMessage من ردود البوت نفسه — تجاهل (ليست أوامر مالك)
  if (chatMessageType === "PublicApiMessage") {
    return null;
  }

  const phone = extractCustomerPhone(payload);
  if (!phone) return null;

  const body = extractPlainOutboundText(message);
  if (!body) return null;

  return {
    type,
    phone,
    body,
    messageId: message.id || null,
    chatMessageType: chatMessageType || type,
  };
}

function parseInboundMessage(payload) {
  if (!payload || payload.type !== "message_received") return null;

  const customer = payload.data?.customer || {};
  const message = payload.data?.message || {};
  const channelPhone = extractCustomerPhone(payload);

  if (!channelPhone) return null;

  const chatMessageType = String(message.chat_message_type || "CustomerMessage");
  // رسائل الوكيل على نفس الحدث تُحوَّل لمسار أوامر المالك لا الحسبة
  if (chatMessageType && chatMessageType !== "CustomerMessage") {
    return null;
  }

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
    chatMessageType,
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
  parseOwnerOutboundCommand,
  extractInteractiveChoice,
  resolveInboundBody,
  getWebhookSecret,
};
