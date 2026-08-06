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
  const message = String(bodyText || "").trim();
  if (!message) return { ok: false, skipped: true };

  const primary = splitPhone(phone, cfg.countryCode);
  const attempts = [primary];

  // محاولات بديلة إذا جاء الرقم بصيغة مختلفة من الـ webhook
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("966") && digits.length >= 12) {
    attempts.push({ countryCode: "+966", phoneNumber: digits.slice(3) });
  }
  if (digits.startsWith("0") && digits.length === 10) {
    attempts.push({ countryCode: "+966", phoneNumber: digits.slice(1) });
  }
  if (digits.length === 9 && digits.startsWith("5")) {
    attempts.push({ countryCode: "+966", phoneNumber: digits });
  }

  const seen = new Set();
  let lastErr = null;
  for (const a of attempts) {
    const key = `${a.countryCode}|${a.phoneNumber}`;
    if (seen.has(key) || !a.phoneNumber) continue;
    seen.add(key);
    try {
      return await interaktFetch("/message/", {
        countryCode: a.countryCode,
        phoneNumber: a.phoneNumber,
        type: "Text",
        callbackData: String(callbackData).slice(0, 512),
        data: { message: message.slice(0, 4096) },
      });
    } catch (err) {
      lastErr = err;
      console.warn(
        "[interakt] Text attempt failed",
        key.replace(/(\+\d+)(\d{2})\d+(\d{2})/, "$1$2***$3"),
        err.message
      );
    }
  }
  throw lastErr || new Error("فشل إرسال النص الحر");
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

  const split = splitPhone(phone, cfg.countryCode);
  console.log(
    "[interakt] إرسال إلى",
    `${split.countryCode}${String(split.phoneNumber).slice(0, 2)}***${String(split.phoneNumber).slice(-2)}`,
    "mode=",
    cfg.sendMode
  );

  let textError = null;

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
      console.log("[interakt] تم الإرسال نص حر، أجزاء:", results.length);
      return { ok: true, mode: "text", parts: results.length, data: results };
    } catch (err) {
      textError = err;
      console.warn(
        "[interakt] Text فشل:",
        err.message,
        err.data ? JSON.stringify(err.data) : ""
      );
      if (cfg.sendMode === "text" || !preferTemplate) throw err;
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
          const textHint = textError
            ? `سبب فشل النص الحر: ${textError.message}`
            : "النص الحر لم يُجرَّب";
          throw new Error(
            `تعذر الإرسال عبر Interakt. القالب bot_reply غير معتمد. ${textHint}`
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
