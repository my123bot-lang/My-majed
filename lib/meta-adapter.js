/**
 * محوّل رسالة Meta Cloud API → شكل متوافق مع handlers.js / reply.js
 */
const { sendText, sendInteractive: sendInteractiveMeta, normalizeTo } = require("./meta-client");
const { phoneToWhatsAppDigits } = require("./contact-phone");

function phoneToChatId(phone) {
  const digits = phoneToWhatsAppDigits(phone);
  return digits ? `${digits}@c.us` : null;
}

function createMetaMessage({ phone, body, messageId, contactName }) {
  const fullPhone = normalizeTo(phone);
  const from = phoneToChatId(fullPhone);
  const national = fullPhone.startsWith("966")
    ? fullPhone.slice(3)
    : fullPhone;
  const display = national.startsWith("5") ? `0${national}` : national;

  async function send(text) {
    return sendText(fullPhone, text, { previewUrl: false });
  }

  async function sendInteractive(menu) {
    return sendInteractiveMeta(fullPhone, menu);
  }

  return {
    from,
    body: String(body || ""),
    type: "chat",
    fromMe: false,
    id: { _serialized: messageId || `meta_${Date.now()}`, id: messageId },
    _metaPhone: fullPhone,
    _metaDisplay: display,
    reply: async (text) => {
      await send(text);
    },
    sendInteractive,
    getChat: async () => ({
      id: { _serialized: from },
      sendMessage: async (text) => send(text),
    }),
    getContact: async () => ({
      pushname: contactName || null,
      number: national,
      id: { user: fullPhone, _serialized: from },
    }),
    client: {
      sendMessage: async (_chatId, text) => send(text),
    },
  };
}

module.exports = {
  createMetaMessage,
  phoneToChatId,
};
