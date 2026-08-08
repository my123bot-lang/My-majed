/**
 * آخر عميل تواصل مع البوت — لأمر stop/start بدون رقم من جوال المالك.
 */
const { phoneToWhatsAppDigits } = require("./contact-phone");

/** @type {{ phone: string, chatId: string|null, at: number }|null} */
let last = null;

function rememberActiveCustomer(phoneOrChatId, chatId = null) {
  const phone = phoneToWhatsAppDigits(phoneOrChatId);
  if (!phone && !chatId) return;
  last = {
    phone: phone || phoneToWhatsAppDigits(chatId) || "",
    chatId: chatId || (phone ? `${phone}@c.us` : null),
    at: Date.now(),
  };
}

function getLastActiveCustomer(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!last) return null;
  if (Date.now() - last.at > maxAgeMs) return null;
  if (!last.phone && !last.chatId) return null;
  return { ...last };
}

module.exports = {
  rememberActiveCustomer,
  getLastActiveCustomer,
};
