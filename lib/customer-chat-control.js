/**
 * أوامر العميل: stop / start لإيقاف أو استئناف الرد الآلي على محادثته.
 * تُعالَج قبل فحص المحادثة المتوقفة حتى يعمل start بعد stop.
 */
const CONFIG = require("../config");
const autoReplyControl = require("./auto-reply-control");
const sessionStore = require("./session");
const { replyToMessage } = require("./reply");
const messages = require("./messages");

/**
 * @returns {'stop'|'start'|null}
 */
function parseCustomerChatControl(text) {
  const cmd = autoReplyControl.parseOwnerCommand(text);
  if (cmd === "stop" || cmd === "start") return cmd;
  return null;
}

/**
 * @param {object} msg
 * @returns {Promise<boolean>} true إذا عُولج الأمر (لا تتابع مسار الحسبة)
 */
async function tryHandleCustomerChatControl(msg) {
  const cmd = parseCustomerChatControl(msg?.body);
  if (!cmd) return false;

  const from = msg.from;
  if (!from) return false;

  const session = sessionStore.getSession(from);
  const extraKeys = [
    session?.whatsappNumber,
    session?.phoneDisplay,
    session?.chatId,
    msg?._interaktPhone,
    msg?._interaktDisplay,
  ].filter(Boolean);

  if (cmd === "stop") {
    autoReplyControl.pauseChat(from, { extraKeys });
    sessionStore.clearSession(from);
    console.log("الرد الآلي موقوف بأمر العميل:", from);
    await replyToMessage(
      msg,
      messages.pauseChatAutoReplyMessage?.() ||
        CONFIG.messages.pauseChatAutoReply
    );
    return true;
  }

  // start — حتى لو المحادثة موقوفة
  autoReplyControl.resumeChat(from, { extraKeys });
  console.log("الرد الآلي مستأنف بأمر العميل:", from);
  await replyToMessage(
    msg,
    CONFIG.botControl.customerResumedReply ||
      CONFIG.botControl.chatResumedReply
  );
  return true;
}

module.exports = {
  parseCustomerChatControl,
  tryHandleCustomerChatControl,
};
