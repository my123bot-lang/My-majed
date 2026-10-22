/**
 * إرسال آمن للرد — نص أو أزرار/قائمة عبر Interakt عند التوفر.
 * linkPreview: false + فصل الرابط لمنع صورة المعاينة من الموقع.
 */
const { getWhatsAppClient } = require("./whatsapp-client");
const { markBotOutbound } = require("./bot-outbound-guard");
const { customerOptionLine } = require("./interactive-menu");
const { buildMenuPollSpec, rememberMenuPoll } = require("./menu-poll");

/** اختبارات فقط — في التشغيل يُستخدم Poll من whatsapp-web.js */
let pollFactory = null;

function setPollFactory(factory) {
  pollFactory = typeof factory === "function" ? factory : null;
}

function createPollMessage(question, options) {
  if (pollFactory) return pollFactory(question, options);
  const { Poll } = require("whatsapp-web.js");
  return new Poll(question, options, { allowMultipleAnswers: false });
}

const SEND_OPTIONS = { linkPreview: false };

function suppressUrlPreview(text) {
  return String(text)
    .replace(/(https?:\/\/)/gi, "$1\u200B")
    .replace(/(www\.)/gi, "www.\u200B");
}

function menuToText(menu) {
  if (!menu) return "";
  const lines = [];
  const body = String(menu.body || "").trim();
  if (body) lines.push(body);
  const items =
    menu.kind === "buttons"
      ? menu.buttons || []
      : menu.kind === "list"
        ? menu.rows || []
        : [];
  const optionLines = [];
  items.forEach((item, i) => {
    const line = customerOptionLine(item, i);
    if (line) optionLines.push(line);
  });
  if (optionLines.length) {
    if (lines.length) lines.push("");
    lines.push(...optionLines);
  }
  return lines.join("\n").trim();
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

function canSendLocalPoll(msg) {
  if (!msg || typeof msg.sendInteractive === "function") return false;
  if (typeof msg.reply !== "function") return false;
  return Boolean(msg.client || getWhatsAppClient());
}

/**
 * واتساب ويب لا يرسل أزرار الرد الرسمية. الاستطلاع يظهر كخيارات تُضغط.
 */
async function trySendLocalPoll(msg, menu) {
  if (!canSendLocalPoll(msg)) return false;
  const spec = buildMenuPollSpec(menu);
  if (!spec) return false;

  let poll;
  try {
    poll = createPollMessage(spec.question, spec.options);
  } catch (err) {
    console.warn("[menu] تعذر بناء الاختيار القابل للضغط:", err.message);
    return false;
  }

  try {
    const sent = await msg.reply(poll);
    rememberMenuPoll(sent, spec, msg.from);
    noteOutbound(sent, menuToText(menu));
    console.log(
      "[menu] خيارات قابلة للضغط:",
      spec.options.length,
      "|",
      msg.from || "-"
    );
    return true;
  } catch (err) {
    console.warn("[menu] فشل الاختيار القابل للضغط، نص بديل:", err.message);
    return false;
  }
}

/**
 * إرسال قائمة اختيارات كأزرار أو قائمة واتساب (Interakt / Meta).
 * على واتساب ويب المحلي تُرسل كخيارات تُضغط، ثم نص مرقّم إذا فشل ذلك.
 */
async function replyMenu(msg, menu) {
  if (!menu) return;

  if (typeof msg.sendInteractive === "function") {
    try {
      const sent = await msg.sendInteractive(menu);
      noteOutbound(sent, menuToText(menu));
      return;
    } catch (err) {
      console.warn(
        "[menu] فشل التفاعلي، نص بديل:",
        err.message,
        err.data ? JSON.stringify(err.data) : ""
      );
    }
  }

  if (await trySendLocalPoll(msg, menu)) return;

  await sendPlain(msg, menuToText(menu));
}

module.exports = {
  replyToMessage,
  replyMenu,
  menuToText,
  suppressUrlPreview,
  setPollFactory,
};
