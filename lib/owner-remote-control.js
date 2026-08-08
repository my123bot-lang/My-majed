/**
 * أوامر إيقاف/تشغيل من جوال شخصي منفصل → رقم البوت (Interakt inbound).
 *
 * مهم: رقم البوت / واتساب العمل (مثل 0507009290) وأرقام التواصل مع العملاء
 * ليست أرقام تحكم — لا تُضاف تلقائياً من إعدادات المندوبين.
 *
 * إذا رقم البوت = واتساب العمل: استخدم stop داخل شات العميل (محلي / صندوق Interakt)
 * أو زر سجل العملاء — لا تعتمد على هذا المسار.
 *
 * اختياري (جوال شخصي ≠ رقم البوت):
 *   stop | start | stop 05xxxxxxxx | stop all
 * OWNER_CONTROL_PHONES أو الإعدادات → ownerControlPhones أو data/owner-control-phones.json
 */
const fs = require("fs");
const path = require("path");
const autoReplyControl = require("./auto-reply-control");
const {
  tryHandleOwnerCommandByPhone,
} = require("./owner-chat-control");
const {
  phoneToWhatsAppDigits,
  normalizeSaudiDisplay,
} = require("./contact-phone");
const { normalizeText } = require("./validators");
const { getLastActiveCustomer } = require("./last-active-customer");

const PHONES_FILE = path.join(__dirname, "..", "data", "owner-control-phones.json");

function phonesFromFile() {
  try {
    if (!fs.existsSync(PHONES_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(PHONES_FILE, "utf8"));
    return Array.isArray(raw?.phones) ? raw.phones : [];
  } catch (_) {
    return [];
  }
}

function phonesFromSettings() {
  try {
    const { collectOwnerControlPhonesFromSettings } = require("./settings-store");
    return collectOwnerControlPhonesFromSettings();
  } catch (_) {
    return [];
  }
}

function getOwnerControlPhones() {
  const raw = String(process.env.OWNER_CONTROL_PHONES || "").trim();
  const fromEnv = raw
    ? raw.split(/[,;\s]+/).map((p) => phoneToWhatsAppDigits(p))
    : [];
  const fromFile = phonesFromFile().map((p) => phoneToWhatsAppDigits(p));
  const fromSettings = phonesFromSettings().map((p) => phoneToWhatsAppDigits(p));
  return [
    ...new Set(
      [...fromEnv, ...fromFile, ...fromSettings].filter((p) => p && p.length >= 9)
    ),
  ];
}

/** ملخص للتشغيل / health — بدون إظهار الرقم كاملًا */
function describeOwnerControl() {
  const phones = getOwnerControlPhones();
  return {
    enabled: phones.length > 0,
    count: phones.length,
    phoneTails: phones.map((p) => String(p).slice(-4)),
    usage: phones.length
      ? "من جوالك الشخصي إلى رقم البوت: stop | start | stop 05xxxxxxxx"
      : "لا أرقام تحكم منفصلة — استخدم زر سجل العملاء أو stop داخل شات العميل (محلي/Interakt)",
  };
}

function logOwnerControlBanner(prefix = "") {
  const info = describeOwnerControl();
  const tag = prefix ? `${prefix} ` : "";
  if (!info.enabled) {
    console.log(`${tag}أوامر stop/start عن بُعد: غير مفعّلة (لا أرقام تحكم)`);
    return info;
  }
  console.log(
    `${tag}أوامر stop/start عن بُعد: مفعّلة (${info.count}) …${info.phoneTails.join(", …")}`
  );
  console.log(`${tag}${info.usage}`);
  return info;
}

function isOwnerControlPhone(phone) {
  const wa = phoneToWhatsAppDigits(phone);
  if (!wa) return false;
  const allowed = getOwnerControlPhones();
  if (!allowed.length) return false;
  return allowed.some(
    (a) => a === wa || a.endsWith(wa.slice(-9)) || wa.endsWith(a.slice(-9))
  );
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

  // stop / start وحدها → آخر عميل نشط
  if (ownerCmd === "stop" || ownerCmd === "start") {
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
 * هل الرسالة من رقم تحكم المالك؟
 * @param {object} msg
 * @param {object} [session]
 */
function isOwnerControlMessage(msg, session = null) {
  const candidates = [
    msg?._interaktPhone,
    msg?._metaPhone,
    msg?._interaktDisplay,
    msg?.from,
    msg?.author,
    session?.whatsappNumber,
    session?.phoneDisplay,
    session?.chatId,
  ];
  return candidates.some((c) => c && isOwnerControlPhone(c));
}

/**
 * @param {string} fromPhone رقم المرسل (يجب أن يكون في أرقام التحكم)
 * @param {string} text
 * @param {{ send?: (chatId: string, text: string) => Promise<any> }} [io]
 * @returns {Promise<boolean>} true إذا كانت الرسالة أمر تحكم وعُولج
 */
async function tryHandleOwnerRemoteControl(fromPhone, text, io = {}) {
  if (!isOwnerControlPhone(fromPhone)) return false;

  const parsed = parseOwnerRemoteCommand(text);
  if (!parsed) {
    // ليست أمر stop/start — اتركها لمسار العميل (اختبار الحسبة من جوالك)
    return false;
  }

  if (parsed.cmd === "stop_all" || parsed.cmd === "start_all") {
    return tryHandleOwnerCommandByPhone(
      fromPhone,
      parsed.cmd === "stop_all" ? "stop all" : "start all",
      io
    );
  }

  let targetPhone = parsed.targetPhone;
  if (!targetPhone) {
    const selfWa = phoneToWhatsAppDigits(fromPhone);
    const last = getLastActiveCustomer();
    // فضّل آخر عميل حقيقي؛ رقم التحكم لا يُسجَّل كعميل نشط
    if (last?.phone && last.phone !== selfWa) {
      targetPhone = last.phone;
    } else if (selfWa) {
      targetPhone = selfWa;
    } else {
      if (io?.send) {
        await io.send(
          `${phoneToWhatsAppDigits(fromPhone)}@c.us`,
          "ما في عميل نشط حديثًا.\nأرسل:\nstop 05xxxxxxxx\nأو انتظر رسالة من العميل ثم اكتب stop"
        ).catch(() => {});
      }
      return true;
    }
  }

  const display = normalizeSaudiDisplay(targetPhone) || targetPhone;
  const handled = await tryHandleOwnerCommandByPhone(targetPhone, parsed.cmd, io);
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
  isOwnerControlMessage,
  parseOwnerRemoteCommand,
  tryHandleOwnerRemoteControl,
  describeOwnerControl,
  logOwnerControlBanner,
};
