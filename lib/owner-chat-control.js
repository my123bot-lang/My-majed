/**
 * أوامر المالك داخل محادثة العميل (رسائل صادرة fromMe):
 * stop  → إيقاف الرد الآلي لهذا العميل فقط
 * start → استئناف الرد الآلي لهذا العميل فقط
 * stop all / start all → الجميع
 *
 * السحابة (Interakt/Meta): استخدم tryHandleOwnerCommandByPhone عند رصد رسالة صادرة.
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

  // لرسائل fromMe: to = العميل عادةً
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
    // بعض إصدارات wwebjs تعرض LID منفصلاً
    push(contact?.id?.lid?._serialized);
    push(contact?._serialized);
  } catch (_) {
    /* ignore */
  }

  try {
    const raw = msg?._data || {};
    push(raw.to);
    push(raw.from);
    if (raw.to && typeof raw.to === "object") {
      push(raw.to._serialized);
      push(raw.to.user);
    }
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

  // ادمج مفاتيح الجلسة النشطة قبل الإيقاف حتى لا يفلت @lid
  const related = sessionStore.findRelatedIdentityKeys(chatId, ...unique);

  return { chatId, keys: [...new Set([...unique, ...related])] };
}

async function applyOwnerCommand(ownerCmd, chatId, keys, send) {
  if (ownerCmd === "stop") {
    autoReplyControl.pauseChat(chatId, { extraKeys: keys });
    try {
      sessionStore.clearSessionsMatching(chatId, ...keys);
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
 * @param {object} msg رسالة whatsapp-web.js fromMe
 * @param {{ send: (chatId: string, text: string) => Promise<any> }} io
 * @returns {Promise<boolean>}
 */
async function tryHandleOwnerChatControl(msg, io) {
  if (!msg?.fromMe) return false;
  if (autoReplyControl.isOwnerCommandMessageSeen(msg)) return true;

  const text = extractMessageText(msg);
  const ownerCmd = autoReplyControl.parseOwnerCommand(text);
  if (!ownerCmd) return false;

  // لا نعلّم الرسالة كـ «أُمرت» إلا بعد التأكد أنها أمر stop/start
  autoReplyControl.markOwnerCommandMessageSeen(msg);

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
      // محاولة بديلة عبر msg.to إن وُجد
      try {
        if (msg?.to && msg.to !== chatId) await io.send(msg.to, body);
      } catch (_) {
        /* ignore */
      }
    }
  };

  return applyOwnerCommand(ownerCmd, chatId, keys, send);
}

/**
 * أوامر stop/start برقم الجوال — للسحابة عندما تُرصد رسالة صادرة من المالك/الوكيل.
 * @param {string} phone
 * @param {string} text
 * @param {{ send?: (chatId: string, text: string) => Promise<any>, waAccountId?: string }} [io]
 * @returns {Promise<boolean>}
 */
async function tryHandleOwnerCommandByPhone(phone, text, io = {}) {
  const ownerCmd = autoReplyControl.parseOwnerCommand(text);
  if (!ownerCmd) return false;

  const { setCurrentWaAccountId, getCurrentWaAccountId } = require("./current-wa-account");
  const prev = getCurrentWaAccountId();
  if (io.waAccountId) setCurrentWaAccountId(io.waAccountId);

  try {
    const wa = phoneToWhatsAppDigits(phone);
    if (!wa && ownerCmd !== "stop_all" && ownerCmd !== "start_all") {
      console.warn("[owner-cmd] رقم غير صالح لأمر:", ownerCmd, phone);
      return true;
    }

    const chatId = wa ? `${wa}@c.us` : "broadcast";
    const related = sessionStore.findRelatedIdentityKeys(
      chatId,
      phone,
      wa,
      wa ? `0${wa.replace(/^966/, "")}` : null
    );
    const keys = [...new Set([phone, wa, chatId, ...related].filter(Boolean))];

    const send = async (body) => {
      if (!io?.send || !wa) return;
      try {
        await io.send(chatId, body);
      } catch (err) {
        console.warn("[owner-cmd] فشل إرسال التأكيد (هاتف):", err.message);
      }
    };

    return applyOwnerCommand(ownerCmd, chatId, keys, send);
  } finally {
    if (io.waAccountId) setCurrentWaAccountId(prev);
  }
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
    const related = sessionStore.findRelatedIdentityKeys(chatId, phone, wa);
    if (paused) {
      autoReplyControl.pauseChat(chatId, {
        extraKeys: [phone, wa, ...related],
      });
      try {
        sessionStore.clearSessionsMatching(chatId, phone, wa, ...related);
      } catch (_) {
        /* ignore */
      }
    } else {
      autoReplyControl.resumeChat(chatId, {
        extraKeys: [phone, wa, ...related],
      });
    }
    return {
      ok: true,
      phone: wa,
      chatId,
      waAccountId: getCurrentWaAccountId(),
      paused: Boolean(paused),
      isPaused: autoReplyControl.isChatPaused(chatId, {
        extraKeys: [phone, wa, ...related],
      }),
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
    return autoReplyControl.isChatPausedForIdentity(`${wa}@c.us`, {
      extraKeys: [phone, wa],
    });
  } finally {
    if (waAccountId) setCurrentWaAccountId(prev);
  }
}

module.exports = {
  extractMessageText,
  resolveOwnerTarget,
  tryHandleOwnerChatControl,
  tryHandleOwnerCommandByPhone,
  setPausedByPhone,
  isPausedByPhone,
};
