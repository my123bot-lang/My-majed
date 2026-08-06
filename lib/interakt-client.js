/**
 * عميل Interakt WhatsApp API
 * الإرسال عبر قالب تقني واحد bot_reply — المنطق/النصوص من handlers كما هي.
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
    /** template = إرسال | off = تعطيل */
    sendMode: String(process.env.INTERAKT_SEND_MODE || "template").trim(),
    chunkDelayMs: Number(process.env.INTERAKT_CHUNK_DELAY_MS || 600),
  };
}

function isConfigured() {
  return Boolean(getConfig().apiKey);
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
 * قوالب واتساب ترفض الأسطر الجديدة داخل المتغيرات.
 * نحوّل الفقرات إلى أجزاء رسائل منفصلة بدل دمج كل شيء في سطر واحد.
 */
function sanitizeChunk(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n/g, " ")
    .replace(/ {3,}/g, "  ")
    .trim();
}

/** يقسّم رد البوت الأصلي إلى أجزاء ≤ 900 حرف مع الحفاظ على الفقرات */
function splitReplyChunks(text, maxLen = 900) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  const paragraphs = raw
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/ {3,}/g, "  ").trim())
    .filter(Boolean);

  const source = paragraphs.length ? paragraphs : [sanitizeChunk(raw)];
  const chunks = [];

  for (const part of source) {
    if (part.length <= maxLen) {
      chunks.push(part);
      continue;
    }
    let rest = part;
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(" ", maxLen);
      if (cut < maxLen * 0.5) cut = maxLen;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
  }

  return chunks.map(sanitizeChunk).filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOneTemplate(phone, bodyText, callbackData = "bot_reply") {
  const cfg = getConfig();
  const { countryCode, phoneNumber } = splitPhone(phone, cfg.countryCode);
  const body = sanitizeChunk(bodyText).slice(0, 1024);
  if (!body) return { ok: false, skipped: true };

  return interaktFetch("/message/", {
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
}

/**
 * يرسل نفس نص رد البوت الأصلي عبر Interakt.
 * تقنياً عبر قالب bot_reply {{1}} — المحتوى من handlers/config كما هو.
 */
async function sendTemplateReply(phone, text, callbackData = "bot_reply") {
  const cfg = getConfig();
  if (cfg.sendMode === "off") {
    console.log("[interakt] SEND_MODE=off —", String(text).slice(0, 80));
    return { ok: true, skipped: true };
  }

  const chunks = splitReplyChunks(text);
  if (!chunks.length) {
    return { ok: false, error: "نص فارغ" };
  }

  await trackUser(phone).catch((err) => {
    console.warn("[interakt] trackUser:", err.message);
  });

  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const data = await sendOneTemplate(
      phone,
      chunks[i],
      `${callbackData}:${i + 1}`
    );
    results.push(data);
    if (i < chunks.length - 1 && cfg.chunkDelayMs > 0) {
      await sleep(cfg.chunkDelayMs);
    }
  }

  return { ok: true, parts: results.length, data: results };
}

async function sendWhatsAppTextViaInterakt(phone, text) {
  return sendTemplateReply(phone, text);
}

module.exports = {
  getConfig,
  isConfigured,
  splitPhone,
  sanitizeChunk,
  sanitizeTemplateVariable: sanitizeChunk,
  splitReplyChunks,
  trackUser,
  sendTemplateReply,
  sendWhatsAppTextViaInterakt,
  interaktFetch,
};
