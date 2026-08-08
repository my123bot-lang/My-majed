/**
 * أوامر المالك داخل محادثة العميل (رسائل صادرة fromMe):
 * stop  → إيقاف الرد الآلي لهذا العميل فقط
 * start → استئناف الرد الآلي لهذا العميل فقط
 * stop all / start all → الجميع
 */
const CONFIG = require("../config");
const autoReplyControl = require("./auto-reply-control");
const sessionStore = require("./session");
const { phoneToWhatsAppDigits, digitsOnly } = require("./contact-phone");

function extractMessageText(msg) {
  const candidates = [
    msg?.body,
    msg?.caption,
    msg?._data?.body,
    msg?._data?.caption,
    msg?._data?.message?.conversation,
    msg?._data?.message?.extendedTextMessage?.text,
  ];
  for (const c of candidates) {
    const t = String(c || "").trim();
    if (t) return t;
  }
  return "";
}

/**
 * يجمع معرّفات العميل من رسالة المالك الصادرة.
 */
async function resolveOwnerTarget(msg) {
  const keys = [];
  const push = (value) => {
    if (value != null && String(value).trim()) keys.push(String(value).trim());
  };

  push(msg?.to);
  push(msg?.from);

  let chat = null;
  try {
    chat = await msg.getChat();
    push(chat?.id?._serialized);
    push(chat?.id?.user);
  } catch (_) {
    /* ignore */
  }

  try {
    const contact = chat ? await chat.getContact() : null;
    push(contact?.number);
    push(contact?.id?._serialized);
    push(contact?.id?.user);
  } catch (_) {
    /* ignore */
  }

  // لا تستخدم رقم المالك نفسه كهدف
  try {
    const selfId = msg?.client?.info?.wid?._serialized;
    const selfUser = msg?.client?.info?.wid?.user;
    const filtered = keys.filter((k) => {
      if (selfId && k === selfId) return false;
      if (selfUser && (k === selfUser || k === `${selfUser}@c.us`)) return false;
      return true;
    });
    if (filtered.length) {
      keys.length = 0;
      keys.push(...filtered);
    }
  } catch (_) {
    /* ignore */
  }

  const unique = [...new Set(keys)];
  const chatId =
    unique.find((k) => /@(c\.us|lid)$/i.test(k)) ||
    (() => {
      const phone = unique
        .map((k) => phoneToWhatsAppDigits(digitsOnly(String(k).split("@")[0])))
        .find((d) => d && d.length >= 9);
      return phone ? `${phone}@c.us` : unique[0] || msg?.to || msg?.from;
    })();

  return { chatId, keys: unique };
}

/**
 * @param {object} msg رسالة whatsapp-web.js fromMe
 * @param {{ send: (chatId: string, text: string) => Promise<any> }} io
 * @returns {Promise<boolean>}
 */
async function tryHandleOwnerChatControl(msg, io) {
  if (!msg?.fromMe) return false;
  if (autoReplyControl.rememberOwnerCommandMessage(msg)) return true;

  const text = extractMessageText(msg);
  const ownerCmd = autoReplyControl.parseOwnerCommand(text);
  if (!ownerCmd) return false;

  const { chatId, keys } = await resolveOwnerTarget(msg);
  if (!chatId) {
    console.warn("[owner-cmd] تعذر تحديد محادثة العميل لأمر:", ownerCmd);
    return true;
  }

  const send = async (body) => {
    if (!io?.send) return;
    try {
      await io.send(chatId, body);
    } catch (err) {
      console.warn("[owner-cmd] فشل إرسال التأكيد:", err.message);
    }
  };

  if (ownerCmd === "stop") {
    autoReplyControl.pauseChat(chatId, { extraKeys: keys });
    try {
      sessionStore.clearSession(chatId);
      for (const k of keys) sessionStore.clearSession?.(k);
    } catch (_) {
      /* ignore */
    }
    console.log("[owner-cmd] stop — رد آلي موقوف للعميل:", chatId, keys);
    await send(CONFIG.botControl.chatPausedReply);
    return true;
  }

  if (ownerCmd === "start") {
    autoReplyControl.resumeChat(chatId, { extraKeys: keys });
    console.log("[owner-cmd] start — رد آلي مستأنف للعميل:", chatId, keys);
    await send(CONFIG.botControl.chatResumedReply);
    return true;
  }

  if (ownerCmd === "stop_all") {
    autoReplyControl.disable();
    console.log("[owner-cmd] stop all — رد آلي متوقف للجميع");
    await send(CONFIG.botControl.pausedReply);
    return true;
  }

  if (ownerCmd === "start_all") {
    autoReplyControl.enable({ clearPausedChats: true });
    console.log("[owner-cmd] start all — رد آلي يعمل للجميع");
    await send(CONFIG.botControl.resumedReply);
    return true;
  }

  return false;
}

/**
 * إيقاف/تشغيل من اللوحة برقم الجوال (للسحابة أو بدون fromMe).
 * @param {string} phone
 * @param {boolean} paused
 * @param {{ waAccountId?: string }} [options]
 */
function setPausedByPhone(phone, paused, options = {}) {
  const { setCurrentWaAccountId, getCurrentWaAccountId } = require("./current-wa-account");
  const prev = getCurrentWaAccountId();
  if (options.waAccountId) setCurrentWaAccountId(options.waAccountId);

  try {
    const wa = phoneToWhatsAppDigits(phone);
    if (!wa) return { ok: false, error: "رقم غير صالح" };
    const chatId = `${wa}@c.us`;
    if (paused) {
      autoReplyControl.pauseChat(chatId, { extraKeys: [phone, wa] });
      try {
        sessionStore.clearSession(chatId);
      } catch (_) {
        /* ignore */
      }
    } else {
      autoReplyControl.resumeChat(chatId, { extraKeys: [phone, wa] });
    }
    return {
      ok: true,
      phone: wa,
      chatId,
      waAccountId: getCurrentWaAccountId(),
      paused: Boolean(paused),
      isPaused: autoReplyControl.isChatPaused(chatId),
    };
  } finally {
    if (options.waAccountId) setCurrentWaAccountId(prev);
  }
}

function isPausedByPhone(phone, waAccountId) {
  const { setCurrentWaAccountId, getCurrentWaAccountId } = require("./current-wa-account");
  const prev = getCurrentWaAccountId();
  if (waAccountId) setCurrentWaAccountId(waAccountId);
  try {
    const wa = phoneToWhatsAppDigits(phone);
    if (!wa) return false;
    return autoReplyControl.isChatPaused(`${wa}@c.us`);
  } finally {
    if (waAccountId) setCurrentWaAccountId(prev);
  }
}

module.exports = {
  extractMessageText,
  resolveOwnerTarget,
  tryHandleOwnerChatControl,
  setPausedByPhone,
  isPausedByPhone,
};
