/**
 * محوّل رسالة Interakt → شكل متوافق مع handlers.js / reply.js
 */
const {
  sendWhatsAppTextViaInterakt,
  splitPhone,
  getConfig,
} = require("./interakt-client");
const { phoneToWhatsAppDigits } = require("./contact-phone");

function phoneToChatId(phone) {
  const digits = phoneToWhatsAppDigits(phone);
  return digits ? `${digits}@c.us` : null;
}

function createInteraktMessage({ phone, body, messageId }) {
  const cfg = getConfig();
  const { countryCode, phoneNumber } = splitPhone(phone, cfg.countryCode);
  const fullPhone = `${countryCode.replace(/\D/g, "")}${phoneNumber}`;
  const from = phoneToChatId(fullPhone);
  const display = phoneNumber.startsWith("5")
    ? `0${phoneNumber}`
    : phoneNumber;

  async function send(text) {
    return sendWhatsAppTextViaInterakt(fullPhone, text);
  }

  const msg = {
    from,
    body: String(body || ""),
    type: "chat",
    fromMe: false,
    id: { _serialized: messageId || `interakt_${Date.now()}`, id: messageId },
    _interaktPhone: fullPhone,
    _interaktDisplay: display,
    reply: async (text) => {
      await send(text);
    },
    getChat: async () => ({
      id: { _serialized: from },
      sendMessage: async (text) => send(text),
    }),
    getContact: async () => ({
      number: phoneNumber,
      id: { user: fullPhone, _serialized: from },
    }),
    client: {
      sendMessage: async (_chatId, text) => send(text),
    },
  };

  return msg;
}

module.exports = {
  createInteraktMessage,
  phoneToChatId,
};
