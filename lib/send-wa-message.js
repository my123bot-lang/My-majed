/**
 * إرسال رسالة نصية لعميل عبر عميل whatsapp-web.js (من البوت)
 */
const { phoneToWhatsAppDigits } = require("./contact-phone");
const { suppressUrlPreview } = require("./reply");

async function sendWhatsAppText(client, phone, text) {
  if (!client) {
    throw new Error("عميل واتساب غير جاهز");
  }

  const digits = phoneToWhatsAppDigits(phone);
  if (!digits) {
    throw new Error("رقم العميل غير صالح");
  }

  const body = suppressUrlPreview(String(text || "").trim());
  if (!body) {
    throw new Error("نص الرسالة فارغ");
  }

  let chatId = null;
  try {
    const numberId = await client.getNumberId(digits);
    if (numberId?._serialized) chatId = numberId._serialized;
  } catch (_) {
    /* getNumberId قد يفشل — نجرّب @c.us */
  }

  if (!chatId) chatId = `${digits}@c.us`;

  await client.sendMessage(chatId, body, { linkPreview: false });
  return { ok: true, chatId };
}

module.exports = { sendWhatsAppText };
