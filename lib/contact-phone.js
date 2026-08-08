/**
 * استخراج رقم جوال العميل من رسالة واتساب (يدعم @c.us و @lid)
 */
function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function isLikelySaudiMobile(digits) {
  if (!digits) return false;
  if (/^9665\d{8}$/.test(digits)) return true;
  if (/^05\d{8}$/.test(digits)) return true;
  if (/^5\d{8}$/.test(digits)) return true;
  return false;
}

/** رقم للرابط wa.me / web.whatsapp.com/send */
function phoneToWhatsAppDigits(phone) {
  let p = digitsOnly(phone);
  if (!p) return "";
  if (p.startsWith("966")) return p;
  if (p.startsWith("0")) return "966" + p.slice(1);
  if (p.startsWith("5") && p.length === 9) return "966" + p;
  return p;
}

function normalizeSaudiDisplay(digits) {
  const d = digitsOnly(digits);
  if (!d) return null;
  if (d.startsWith("9665") && d.length >= 12) return "0" + d.slice(3, 12);
  if (d.startsWith("05") && d.length === 10) return d;
  if (d.startsWith("5") && d.length === 9) return "0" + d;
  return null;
}

function phoneFromChatId(chatId) {
  const user = String(chatId || "").split("@")[0];
  const d = digitsOnly(user);
  if (isLikelySaudiMobile(d)) return normalizeSaudiDisplay(d);
  if (isLikelySaudiMobile("966" + d)) return normalizeSaudiDisplay("966" + d);
  return null;
}

async function resolvePhoneFromMessage(msg) {
  try {
    const contact = await msg.getContact();
    const candidates = [
      contact?.number,
      contact?.id?.user,
      contact?.id?._serialized,
    ];
    for (const c of candidates) {
      const d = digitsOnly(c);
      if (isLikelySaudiMobile(d)) return normalizeSaudiDisplay(d);
      if (d.startsWith("966")) {
        const n = normalizeSaudiDisplay(d);
        if (n) return n;
      }
    }
  } catch (_) {
    /* getContact قد يفشل مع @lid */
  }

  return phoneFromChatId(msg.from);
}

async function attachPhoneToSession(msg, session) {
  if (!session) return null;
  if (session.phoneDisplay && isLikelySaudiMobile(digitsOnly(session.whatsappNumber))) {
    return session.phoneDisplay;
  }

  const display = await resolvePhoneFromMessage(msg);
  if (display) {
    session.whatsappNumber = digitsOnly(display).replace(/^0/, "966");
    session.phoneDisplay = display;
  } else {
    session.chatId = msg.from;
    session.phoneDisplay = phoneFromChatId(msg.from) || null;
  }

  // إن كانت المحادثة موقوفة بأي مفتاح — ادمج @lid مع رقم الجوال في سجل الإيقاف
  try {
    const autoReplyControl = require("./auto-reply-control");
    const chatId = msg?.from || session.chatId;
    const phoneChat = session.whatsappNumber
      ? `${phoneToWhatsAppDigits(session.whatsappNumber)}@c.us`
      : null;
    if (
      autoReplyControl.isChatPaused(chatId) ||
      (phoneChat && autoReplyControl.isChatPaused(phoneChat))
    ) {
      autoReplyControl.pauseChat(chatId, {
        extraKeys: [session.whatsappNumber, session.phoneDisplay, phoneChat],
      });
    }
  } catch (_) {
    /* ignore */
  }

  return session.phoneDisplay;
}

module.exports = {
  digitsOnly,
  resolvePhoneFromMessage,
  attachPhoneToSession,
  phoneFromChatId,
  normalizeSaudiDisplay,
  phoneToWhatsAppDigits,
  isLikelySaudiMobile,
};
