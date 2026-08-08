/**
 * أوامر إيقاف/تشغيل من رقم المالك الشخصي → رقم البوت (Interakt inbound).
 *
 * لماذا؟ Interakt لا يرسل webhook عند كتابة المالك داخل محادثة العميل
 * من تطبيق واتساب الأعمال — فقط message_received (عميل) و message_api_* (قوالب).
 *
 * الاستخدام (من جوالك الشخصي إلى رقم البوت):
 *   stop              → يوقف آخر عميل راسل البوت
 *   start             → يشغّل آخر عميل
 *   stop 0501234567
 *   start 0501234567
 *   stop all / start all
 *
 * OWNER_CONTROL_PHONES=9665... (أو يُستنتج من إعدادات المندوبين)
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
    const waAccounts = require("./whatsapp-accounts-store");
    const { loadSettingsForAccount } = require("./settings-store");
    const accountId = waAccounts.getActiveAccount()?.id || "majed";
    const s = loadSettingsForAccount(accountId);
    return [
      s.personalAgentPhone,
      s.employeePhone,
      s.branchEmployeePhone,
      s.propertyComboAgentPhone,
      s.propertyComboAgentPhone2,
      s.serviceStopAgentPhone,
    ].filter(Boolean);
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
    usage: "من جوال التحكم أرسل لرقم البوت: stop | start | stop 05xxxxxxxx",
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

function ownerHasOwnCustomerSession(fromPhone) {
  try {
    const sessionStore = require("./session");
    const wa = phoneToWhatsAppDigits(fromPhone);
    if (!wa) return false;
    const keys = sessionStore.findRelatedIdentityKeys(
      `${wa}@c.us`,
      wa,
      fromPhone,
      normalizeSaudiDisplay(wa)
    );
    return keys.some((k) => Boolean(sessionStore.getSession(k)));
  } catch (_) {
    return false;
  }
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
    // إذا كنت داخل محادثة/جلسة مع البوت، Stop يوقف محادثتك أنت أولاً
    if (selfWa && ownerHasOwnCustomerSession(fromPhone)) {
      targetPhone = selfWa;
    } else if (last?.phone) {
      targetPhone = last.phone;
    } else if (selfWa) {
      // لا عميل آخر — أوقف/شغّل محادثة رقم التحكم نفسه
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
  parseOwnerRemoteCommand,
  tryHandleOwnerRemoteControl,
  describeOwnerControl,
  logOwnerControlBanner,
};
