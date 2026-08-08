/**
 * إرسال آمن للرد — نص أو أزرار/قائمة عبر Interakt عند التوفر.
 * linkPreview: false + فصل الرابط لمنع صورة المعاينة من الموقع.
 */
const { getWhatsAppClient } = require("./whatsapp-client");
const { markBotOutbound } = require("./bot-outbound-guard");

const SEND_OPTIONS = { linkPreview: false };

function suppressUrlPreview(text) {
  return String(text)
    .replace(/(https?:\/\/)/gi, "$1\u200B")
    .replace(/(www\.)/gi, "www.\u200B");
}

function menuToText(menu) {
  if (!menu) return "";
  const lines = [String(menu.body || "").trim()];
  if (menu.kind === "buttons") {
    for (const b of menu.buttons || []) {
      lines.push(`${b.id}- ${b.title}`);
    }
  } else if (menu.kind === "list") {
    for (const r of menu.rows || []) {
      lines.push(`${r.id}- ${r.title}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

function noteOutbound(result, body) {
  try {
    markBotOutbound(result, body);
  } catch (_) {
    /* ignore */
  }
}

async function sendPlain(msg, text) {
  const body = suppressUrlPreview(text);

  try {
    const sent = await msg.reply(body, undefined, SEND_OPTIONS);
    noteOutbound(sent, body);
    return;
  } catch (firstError) {
    console.warn("reply عادي فشل، محاولة بديلة:", firstError.message);
  }

  try {
    const chat = await msg.getChat();
    const sent = await chat.sendMessage(body, SEND_OPTIONS);
    noteOutbound(sent, body);
    return;
  } catch (secondError) {
    console.warn("sendMessage عبر getChat فشل:", secondError.message);
  }

  const chatId = msg.from;
  const waClient = msg.client || getWhatsAppClient();
  if (chatId && waClient) {
    const sent = await waClient.sendMessage(chatId, body, SEND_OPTIONS);
    noteOutbound(sent, body);
    return;
  }

  throw new Error("تعذر إرسال الرد إلى العميل");
}

async function replyToMessage(msg, text) {
  await sendPlain(msg, text);
}

/**
 * إرسال قائمة اختيارات كأزرار أو قائمة واتساب (Interakt)،
 * مع رجوع لنص مرقّم على واتساب ويب المحلي.
 */
async function replyMenu(msg, menu) {
  if (!menu) return;

  if (typeof msg.sendInteractive === "function") {
    try {
      const sent = await msg.sendInteractive(menu);
      noteOutbound(sent, menuToText(menu));
      return;
    } catch (err) {
      console.warn("[menu] فشل التفاعلي، نص بديل:", err.message);
    }
  }

  await sendPlain(msg, menuToText(menu));
}

module.exports = {
  replyToMessage,
  replyMenu,
  menuToText,
  suppressUrlPreview,
};
