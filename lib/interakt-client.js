/**
 * عميل Interakt WhatsApp API
 * خلال نافذة 24 ساعة (بعد رسالة العميل): إرسال نص حر Text — نفس ردود handlers.
 * خارج النافذة أو إذا فشل Text: قالب bot_reply {{1}} كاحتياطي.
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
    /**
     * auto = Text داخل نافذة 24س ثم قالب احتياطي
     * text = نص حر فقط
     * template = قالب فقط
     * off = تعطيل
     */
    sendMode: String(process.env.INTERAKT_SEND_MODE || "auto").trim(),
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

/** أجزاء نص حر — تحافظ على الأسطر الجديدة داخل كل جزء */
function splitFreeTextChunks(text, maxLen = 3500) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  if (raw.length <= maxLen) return [raw];

  const paragraphs = raw.split(/\n{2,}/).filter((p) => p.trim());
  const chunks = [];
  let buf = "";

  for (const p of paragraphs) {
    const piece = p.trim();
    if (!buf) {
      buf = piece;
      continue;
    }
    if ((buf + "\n\n" + piece).length <= maxLen) {
      buf = `${buf}\n\n${piece}`;
    } else {
      chunks.push(buf);
      buf = piece;
    }
  }
  if (buf) chunks.push(buf);

  const out = [];
  for (const c of chunks) {
    if (c.length <= maxLen) {
      out.push(c);
      continue;
    }
    let rest = c;
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf("\n", maxLen);
      if (cut < maxLen * 0.5) cut = rest.lastIndexOf(" ", maxLen);
      if (cut < maxLen * 0.5) cut = maxLen;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out.filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** رد نص حر داخل نافذة خدمة العملاء (24 ساعة بعد رسالة العميل) */
async function sendOneText(phone, bodyText, callbackData = "bot_reply") {
  const cfg = getConfig();
  const { countryCode, phoneNumber } = splitPhone(phone, cfg.countryCode);
  const message = String(bodyText || "").trim();
  if (!message) return { ok: false, skipped: true };

  return interaktFetch("/message/", {
    countryCode,
    phoneNumber,
    type: "Text",
    callbackData: String(callbackData).slice(0, 512),
    data: { message: message.slice(0, 4096) },
  });
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

function isTemplateMissingError(err) {
  const msg = String(err?.message || err?.data?.message || "");
  return /no approved template/i.test(msg);
}

function isSessionWindowError(err) {
  const msg = String(err?.message || err?.data?.message || "");
  return /not messaged within last 24 hours|session/i.test(msg);
}

/**
 * يرسل نفس نص رد البوت الأصلي عبر Interakt.
 * العميل يكتب أولاً (مثل 1) → نافذة 24س مفتوحة → Text حر بنفس الأسئلة/الحسبة.
 */
async function sendWhatsAppTextViaInterakt(phone, text, callbackData = "bot_reply") {
  const cfg = getConfig();
  if (cfg.sendMode === "off") {
    console.log("[interakt] SEND_MODE=off —", String(text).slice(0, 80));
    return { ok: true, skipped: true };
  }

  const preferText = cfg.sendMode === "auto" || cfg.sendMode === "text";
  const preferTemplate =
    cfg.sendMode === "auto" || cfg.sendMode === "template";

  await trackUser(phone).catch((err) => {
    console.warn("[interakt] trackUser:", err.message);
  });

  const results = [];

  if (preferText) {
    const textChunks = splitFreeTextChunks(text);
    if (!textChunks.length) return { ok: false, error: "نص فارغ" };

    try {
      for (let i = 0; i < textChunks.length; i++) {
        const data = await sendOneText(
          phone,
          textChunks[i],
          `${callbackData}:t${i + 1}`
        );
        results.push({ mode: "text", data });
        if (i < textChunks.length - 1 && cfg.chunkDelayMs > 0) {
          await sleep(cfg.chunkDelayMs);
        }
      }
      return { ok: true, mode: "text", parts: results.length, data: results };
    } catch (err) {
      if (cfg.sendMode === "text" || !preferTemplate) throw err;
      console.warn(
        "[interakt] Text فشل، محاولة القالب:",
        err.message
      );
      if (!isSessionWindowError(err) && !/400|403|404/.test(String(err.status))) {
        // ما زال نحاول القالب كاحتياطي
      }
    }
  }

  if (preferTemplate) {
    const chunks = splitReplyChunks(text);
    if (!chunks.length) return { ok: false, error: "نص فارغ" };

    for (let i = 0; i < chunks.length; i++) {
      try {
        const data = await sendOneTemplate(
          phone,
          chunks[i],
          `${callbackData}:${i + 1}`
        );
        results.push({ mode: "template", data });
      } catch (err) {
        if (isTemplateMissingError(err)) {
          throw new Error(
            "تعذر الإرسال: لا يوجد قالب bot_reply معتمد، وفشل الرد النصي الحر. " +
              "تأكد أن العميل راسل الرقم خلال 24 ساعة أو اعتمد القالب في Interakt."
          );
        }
        throw err;
      }
      if (i < chunks.length - 1 && cfg.chunkDelayMs > 0) {
        await sleep(cfg.chunkDelayMs);
      }
    }
    return { ok: true, mode: "template", parts: results.length, data: results };
  }

  return { ok: false, error: "لا يوجد وضع إرسال صالح" };
}

/** توافق خلفي */
async function sendTemplateReply(phone, text, callbackData = "bot_reply") {
  return sendWhatsAppTextViaInterakt(phone, text, callbackData);
}

module.exports = {
  getConfig,
  isConfigured,
  splitPhone,
  sanitizeChunk,
  sanitizeTemplateVariable: sanitizeChunk,
  splitReplyChunks,
  splitFreeTextChunks,
  trackUser,
  sendOneText,
  sendOneTemplate,
  sendTemplateReply,
  sendWhatsAppTextViaInterakt,
  interaktFetch,
};
