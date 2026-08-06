/**
 * عميل Interakt WhatsApp API
 * docs: https://api.interakt.ai/v1/public/message/
 */
const DEFAULT_BASE = "https://api.interakt.ai/v1/public";

function getConfig() {
  return {
    apiKey: String(process.env.INTERAKT_API_KEY || "").trim(),
    baseUrl: String(process.env.INTERAKT_API_BASE || DEFAULT_BASE).replace(
      /\/$/,
      ""
    ),
    countryCode: String(process.env.INTERAKT_COUNTRY_CODE || "+966").trim(),
    replyTemplate: String(
      process.env.INTERAKT_REPLY_TEMPLATE || "bot_reply"
    ).trim(),
    replyLanguage: String(process.env.INTERAKT_REPLY_LANGUAGE || "ar").trim(),
    /** template = قالب معتمد | off = لا ترسل (للتجربة) */
    sendMode: String(process.env.INTERAKT_SEND_MODE || "template").trim(),
  };
}

function splitPhone(fullOrLocal, countryCode = "+966") {
  let digits = String(fullOrLocal || "").replace(/\D/g, "");
  const cc = String(countryCode || "+966").replace(/\D/g, "") || "966";

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith(cc)) {
    return { countryCode: `+${cc}`, phoneNumber: digits.slice(cc.length) };
  }
  if (digits.startsWith("0")) digits = digits.slice(1);
  return { countryCode: `+${cc}`, phoneNumber: digits };
}

async function interaktFetch(path, body) {
  const { apiKey, baseUrl } = getConfig();
  if (!apiKey) {
    throw new Error("INTERAKT_API_KEY غير مضبوط");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      `Interakt ${res.status}: ${data?.message || data?.error || text || "فشل الطلب"}`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** تسجيل/تحديث عميل في Interakt */
async function trackUser(phone, traits = {}) {
  const cfg = getConfig();
  const { countryCode, phoneNumber } = splitPhone(phone, cfg.countryCode);
  return interaktFetch("/track/users/", {
    countryCode,
    phoneNumber,
    traits: {
      whatsapp_opted_in: true,
      ...traits,
    },
  });
}

/**
 * إرسال رد عبر قالب واتساب معتمد.
 * أنشئ قالباً اسمه bot_reply (أو INTERAKT_REPLY_TEMPLATE) بنص:
 *   {{1}}
 * فئة Utility، لغة ar — ثم اعتمده من Meta عبر Interakt.
 *
 * ملاحظة: واجهة Interakt العامة تدعم type=Template فقط.
 */
async function sendTemplateReply(phone, text, callbackData = "bot_reply") {
  const cfg = getConfig();
  if (cfg.sendMode === "off") {
    console.log("[interakt] SEND_MODE=off — لن يُرسل:", String(text).slice(0, 80));
    return { ok: true, skipped: true };
  }

  const { countryCode, phoneNumber } = splitPhone(phone, cfg.countryCode);
  const body = String(text || "").slice(0, 1024);

  await trackUser(`${countryCode}${phoneNumber}`).catch((err) => {
    console.warn("[interakt] trackUser:", err.message);
  });

  const data = await interaktFetch("/message/", {
    countryCode,
    phoneNumber,
    type: "Template",
    callbackData: String(callbackData).slice(0, 512),
    template: {
      name: cfg.replyTemplate,
      languageCode: cfg.replyLanguage,
      bodyValues: [body],
    },
  });

  return { ok: true, data };
}

async function sendWhatsAppTextViaInterakt(phone, text) {
  return sendTemplateReply(phone, text);
}

module.exports = {
  getConfig,
  splitPhone,
  trackUser,
  sendTemplateReply,
  sendWhatsAppTextViaInterakt,
  interaktFetch,
};
