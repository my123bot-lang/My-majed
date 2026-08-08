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

/**
 * @param {object} message
 * @param {{ maxLen?: number }} [options]
 */
function extractPlainOutboundText(message, options = {}) {
  if (!message) return "";
  const maxLen = Number.isFinite(options.maxLen) ? options.maxLen : 80;
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
    if (raw.length > maxLen) continue;
    return raw;
  }
  return "";
}

function getCallbackData(message) {
  const meta = message?.meta_data || message?.metaData || {};
  return String(
    meta.callback_data ||
      meta.callbackData ||
      meta.CallbackData ||
      message?.callback_data ||
      message?.callbackData ||
      ""
  ).trim();
}

/** ردود البوت عبر API تضع callbackData يبدأ بـ bot_ / owner_ack */
function isOurBotCallback(callbackData) {
  const s = String(callbackData || "").toLowerCase();
  if (!s) return false;
  return (
    s.startsWith("bot_") ||
    s.startsWith("owner_ack") ||
    s.includes("bot_reply") ||
    s.includes("bot_buttons") ||
    s.includes("bot_list")
  );
}

function isTemplateLikeMessage(message, type) {
  return (
    String(type || "").startsWith("message_campaign_") ||
    Boolean(message?.is_template_message) ||
    String(message?.message_content_type || "").toLowerCase() === "template"
  );
}

/**
 * هل الحدث يبدو رسالة صادرة من وكيل/مالك (وليس عميلاً أو بوتاً عبر API)؟
 * @returns {{ type: string, message: object, chatMessageType: string }|null}
 */
function matchOwnerOutboundEnvelope(payload) {
  if (!payload || !payload.type) return null;

  const type = String(payload.type);
  const message = payload.data?.message || {};
  const chatMessageType = String(message.chat_message_type || "");

  // رسالة العميل العادية تُعالج في مسار الوارد — حتى لو كتب stop
  if (chatMessageType === "CustomerMessage") {
    return null;
  }

  if (isTemplateLikeMessage(message, type)) {
    return null;
  }

  const bodyHint = extractPlainOutboundText(message, { maxLen: 80 });
  let ownerCmd = null;
  try {
    ownerCmd = bodyHint
      ? require("./auto-reply-control").parseOwnerCommand(bodyHint)
      : null;
  } catch (_) {
    ownerCmd = null;
  }
  const fromOurBot = isOurBotCallback(getCallbackData(message));

  // أمر stop/start صريح صادر للعميل — حتى لو PublicApiMessage / message_api_sent
  // (إرسال من صندوق Interakt أو تكامل). نتجاهل ردود البوت عبر callbackData.
  if (ownerCmd && !fromOurBot) {
    const commandEvents = new Set([
      "message_received",
      "message_sent",
      "message_api_sent",
    ]);
    if (commandEvents.has(type)) {
      return { type, message, chatMessageType: chatMessageType || type };
    }
  }

  // إيقاف تلقائي عند رد يدوي: AgentMessage وأشباهه فقط (مو PublicApiMessage = ردود البوت)
  const looksAgentOutbound =
    type === "message_received" || type === "message_sent";
  if (!looksAgentOutbound) return null;

  if (type === "message_received") {
    if (!chatMessageType || chatMessageType === "CustomerMessage") return null;
  }

  if (chatMessageType === "PublicApiMessage" || fromOurBot) {
    return null;
  }

  return { type, message, chatMessageType: chatMessageType || type };
}

/**
 * نشاط صادر من الوكيل/المالك — لأوامر stop/start أو الإيقاف التلقائي عند الرد اليدوي.
 *
 * - stop/start للعميل: يُلتقط من AgentMessage أو message_api_sent (نص حر) إن وصل الـ webhook
 * - ردود البوت (callbackData=bot_*) تُتجاهل حتى لا يوقف البوت نفسه
 * - تطبيق واتساب الأعمال قد لا يرسل webhook؛ صندوق Interakt أو واتساب ويب المحلي أوثق
 *
 * @returns {{ phone: string, body: string, messageId: string|null, chatMessageType: string, type: string, hasMedia: boolean }|null}
 */
function parseOwnerOutboundActivity(payload) {
  const envelope = matchOwnerOutboundEnvelope(payload);
  if (!envelope) return null;

  const phone = extractCustomerPhone(payload);
  if (!phone) return null;

  const body = extractPlainOutboundText(envelope.message, { maxLen: 4000 });
  const hasMedia = Boolean(envelope.message.media_url);
  if (!body && !hasMedia) return null;

  return {
    type: envelope.type,
    phone,
    body,
    messageId: envelope.message.id || null,
    chatMessageType: envelope.chatMessageType,
    hasMedia,
    callbackData: getCallbackData(envelope.message) || null,
  };
}

/**
 * رسائل صادرة قصيرة من الوكيل/المالك — مرشّحة لأوامر stop/start.
 * @returns {{ phone: string, body: string, messageId: string|null, chatMessageType: string, type: string }|null}
 */
function parseOwnerOutboundCommand(payload) {
  const activity = parseOwnerOutboundActivity(payload);
  if (!activity) return null;
  if (!activity.body || activity.body.length > 80) return null;

  return {
    type: activity.type,
    phone: activity.phone,
    body: activity.body,
    messageId: activity.messageId,
    chatMessageType: activity.chatMessageType,
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
  parseOwnerOutboundActivity,
  extractInteractiveChoice,
  resolveInboundBody,
  getWebhookSecret,
  getCallbackData,
  isOurBotCallback,
};
