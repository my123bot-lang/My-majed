/**
 * إرسال آمن للرد — يعمل مع @c.us و @lid عند فشل msg.reply.
 * linkPreview: false + فصل الرابط لمنع صورة المعاينة من الموقع.
 */
const { getWhatsAppClient } = require("./whatsapp-client");

const SEND_OPTIONS = { linkPreview: false };

/** يمنع واتساب من توليد معاينة الرابط (صورة الموقع) */
function suppressUrlPreview(text) {
  return String(text)
    .replace(/(https?:\/\/)/gi, "$1\u200B")
    .replace(/(www\.)/gi, "www.\u200B");
}

async function replyToMessage(msg, text) {
  const body = suppressUrlPreview(text);

  try {
    await msg.reply(body, undefined, SEND_OPTIONS);
    return;
  } catch (firstError) {
    console.warn("reply عادي فشل، محاولة بديلة:", firstError.message);
  }

  try {
    const chat = await msg.getChat();
    await chat.sendMessage(body, SEND_OPTIONS);
    return;
  } catch (secondError) {
    console.warn("sendMessage عبر getChat فشل:", secondError.message);
  }

  const chatId = msg.from;
  const waClient = msg.client || getWhatsAppClient();
  if (chatId && waClient) {
    await waClient.sendMessage(chatId, body, SEND_OPTIONS);
    return;
  }

  throw new Error("تعذر إرسال الرد إلى العميل");
}

module.exports = { replyToMessage, suppressUrlPreview };
