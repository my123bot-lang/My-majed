/**
 * أوامر إيقاف/تشغيل من رقم المالك الشخصي → رقم البوت (Interakt inbound).
 *
 * لماذا؟ Interakt لا يرسل webhook عند كتابة المالك داخل محادثة العميل
 * من تطبيق واتساب الأعمال — فقط message_received (عميل) و message_api_* (قوالب).
 * لذلك أمر «Stop» المكتوب في محادثة العميل لا يصل للخادم على السحابة.
 *
 * الاستخدام (من جوال المالك إلى رقم البوت):
 *   stop 0501234567
 *   start 0501234567
 *   stop all / start all
 *
 * OWNER_CONTROL_PHONES=9665...,05...  (فارغة = معطّل)
 */
const autoReplyControl = require("./auto-reply-control");
const {
  tryHandleOwnerCommandByPhone,
} = require("./owner-chat-control");
const {
  phoneToWhatsAppDigits,
  normalizeSaudiDisplay,
} = require("./contact-phone");
const { normalizeText } = require("./validators");

function getOwnerControlPhones() {
  const raw = String(process.env.OWNER_CONTROL_PHONES || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((p) => phoneToWhatsAppDigits(p))
    .filter((p) => p && p.length >= 9);
}

function isOwnerControlPhone(phone) {
  const wa = phoneToWhatsAppDigits(phone);
  if (!wa) return false;
  const allowed = getOwnerControlPhones();
  if (!allowed.length) return false;
  return allowed.some((a) => a === wa || a.endsWith(wa.slice(-9)) || wa.endsWith(a.slice(-9)));
}

/**
 * @returns {{ cmd: 'stop'|'start'|'stop_all'|'start_all', targetPhone: string|null }|null}
 */
function parseOwnerRemoteCommand(text) {
  const raw = normalizeText(text).toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const ownerCmd = autoReplyControl.parseOwnerCommand(raw);
  if (ownerCmd === "stop_all" || ownerCmd === "start_all") {
    return { cmd: ownerCmd, targetPhone: null };
  }

  // stop 0501234567 / start 966501234567
  const m = raw.match(
    /^(stop|start|ايقاف|إيقاف|توقف|استئناف|تشغيل)\s+([+\d][\d\s-]{7,20})$/i
  );
  if (m) {
    const verb = normalizeText(m[1]).toLowerCase();
    const targetPhone = phoneToWhatsAppDigits(m[2]);
    if (!targetPhone) return null;
    const cmd =
      autoReplyControl.parseOwnerCommand(verb) === "start" ? "start" : "stop";
    return { cmd, targetPhone };
  }

  return null;
}

/**
 * @param {string} fromPhone رقم المرسل (يجب أن يكون في OWNER_CONTROL_PHONES)
 * @param {string} text
 * @param {{ send?: (chatId: string, text: string) => Promise<any> }} [io]
 * @returns {Promise<boolean>}
 */
async function tryHandleOwnerRemoteControl(fromPhone, text, io = {}) {
  if (!isOwnerControlPhone(fromPhone)) return false;

  const parsed = parseOwnerRemoteCommand(text);
  if (!parsed) {
    // رسالة من المالك ليست أمر تحكم — لا نمرّرها لحسبة التمويل
    return false;
  }

  if (parsed.cmd === "stop_all" || parsed.cmd === "start_all") {
    return tryHandleOwnerCommandByPhone(fromPhone, parsed.cmd === "stop_all" ? "stop all" : "start all", io);
  }

  const display = normalizeSaudiDisplay(parsed.targetPhone) || parsed.targetPhone;
  const handled = await tryHandleOwnerCommandByPhone(
    parsed.targetPhone,
    parsed.cmd,
    io
  );
  if (handled) {
    console.log(
      "[owner-remote]",
      parsed.cmd,
      "للعميل",
      display,
      "من المالك",
      String(fromPhone).slice(-4)
    );
  }
  return handled;
}

module.exports = {
  getOwnerControlPhones,
  isOwnerControlPhone,
  parseOwnerRemoteCommand,
  tryHandleOwnerRemoteControl,
};
