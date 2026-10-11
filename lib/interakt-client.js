/**
 * عميل Interakt WhatsApp API
 * خلال نافذة 24 ساعة (بعد رسالة العميل): إرسال نص حر Text — نفس ردود handlers.
 * خارج النافذة أو إذا فشل Text: قالب bot_reply {{1}} كاحتياطي.
 * docs: https://api.interakt.ai/v1/public/message/
 */
const DEFAULT_BASE = "https://api.interakt.ai/v1/public";
const {
  buildListMessageData,
  buildButtonMessageData,
  listToButtonMenuChunks,
} = require("./interactive-menu");

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
    timeoutMs: Number(process.env.INTERAKT_TIMEOUT_MS || 10000),
    /** سقف انتظار القوائم والأزرار ثم نرجع للنص حتى لا يعلق الرد */
    interactiveBudgetMs: Number(process.env.INTERAKT_INTERACTIVE_BUDGET_MS || 2500),
  };
}

/** نوع الإرسال التفاعلي الذي نجح مؤخراً — يُجرَّب أولاً في الرد التالي */
const preferredInteractiveType = { list: "", buttons: "" };
/**
 * الإيقاف لكل نوع على حدة.
 * فشل القائمة (مهلة أو رفض) لا يوقف الأزرار — وإلا تصير كل القوائم نصاً مرقّماً.
 */
const interactiveDownUntil = { list: 0, buttons: 0 };
const LIST_PAUSE_MS = 3 * 60 * 1000;
const BUTTON_PAUSE_MS = 60 * 1000;

/** لا نعيد trackUser لنفس الرقم خلال هذه المدة — يقلل ثانية تقريباً من كل رد */
const TRACK_USER_TTL_MS = Number(process.env.INTERAKT_TRACK_TTL_MS || 10 * 60 * 1000);
/** @type {Map<string, number>} */
const recentTrackedPhones = new Map();

function trackCacheKey(phone) {
  const { countryCode, phoneNumber } = splitPhone(phone);
  return `${countryCode}|${phoneNumber}`;
}

function wasTrackedRecently(phone) {
  const key = trackCacheKey(phone);
  const at = recentTrackedPhones.get(key);
  if (!at) return false;
  if (Date.now() - at > TRACK_USER_TTL_MS) {
    recentTrackedPhones.delete(key);
    return false;
  }
  return true;
}

function interactiveBudgetMs() {
  const n = getConfig().interactiveBudgetMs;
  return Number.isFinite(n) && n >= 800 ? n : 2500;
}

function interactiveIsPaused(kind) {
  if (kind === "list" || kind === "buttons") {
    return Date.now() < interactiveDownUntil[kind];
  }
  return (
    Date.now() < interactiveDownUntil.list &&
    Date.now() < interactiveDownUntil.buttons
  );
}

function markInteractiveDown(kind) {
  const ms = kind === "list" ? LIST_PAUSE_MS : BUTTON_PAUSE_MS;
  const until = Date.now() + ms;
  if (kind === "list" || kind === "buttons") {
    interactiveDownUntil[kind] = until;
    return;
  }
  interactiveDownUntil.list = until;
  interactiveDownUntil.buttons = until;
}

function markInteractiveUp(kind) {
  if (kind === "list" || kind === "buttons") {
    interactiveDownUntil[kind] = 0;
    return;
  }
  interactiveDownUntil.list = 0;
  interactiveDownUntil.buttons = 0;
}

/**
 * الخطوة التالية: list | buttons | text
 * مهلة القائمة أو رفضها ترجع أزراراً. نافذة الـ 24 ساعة فقط ترجع نصاً.
 */
function nextInteractiveAttempt(kind, state = {}) {
  if (state.sessionWindow) return "text";
  if (kind === "buttons") return state.buttonsPaused ? "text" : "buttons";
  if (kind === "list") {
    if (!state.listFailed && !state.listPaused) return "list";
    return state.buttonsPaused ? "text" : "buttons";
  }
  return "text";
}

function orderInteractiveVariants(kind, variants) {
  const list = Array.isArray(variants) ? variants.slice() : [];
  const want = preferredInteractiveType[kind];
  if (!want) return list;
  const idx = list.findIndex((v) => v && v.type === want);
  if (idx <= 0) return list;
  const [hit] = list.splice(idx, 1);
  list.unshift(hit);
  return list;
}

function rememberInteractiveType(kind, type) {
  if (!kind || !Object.prototype.hasOwnProperty.call(preferredInteractiveType, kind)) return;
  preferredInteractiveType[kind] = type ? String(type) : "";
}

function trackUserSoon(phone) {
  trackUser(phone).catch((err) => {
    console.warn("[interakt] trackUser:", err.message);
  });
}

function isTimeoutError(err) {
  return (
    Number(err?.status) === 408 ||
    /timeout/i.test(String(err?.message || ""))
  );
}

function rememberTracked(phone) {
  recentTrackedPhones.set(trackCacheKey(phone), Date.now());
  if (recentTrackedPhones.size > 400) {
    const oldest = [...recentTrackedPhones.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < oldest.length - 240; i++) {
      recentTrackedPhones.delete(oldest[i][0]);
    }
  }
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

/** صيغ رقم بديلة — نفس محاولات النص الحر حتى لا يفشل التفاعلي ويُرسل النص */
function collectPhoneAttempts(phone) {
  const cfg = getConfig();
  const primary = splitPhone(phone, cfg.countryCode);
  const attempts = [primary];
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
  return attempts.filter((a) => {
    if (!a.phoneNumber) return false;
    const key = `${a.countryCode}|${a.phoneNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function interaktFetch(path, body, options = {}) {
  const { apiKey, baseUrl, timeoutMs } = getConfig();
  if (!apiKey) {
    throw new Error("INTERAKT_API_KEY غير مضبوط");
  }

  const controller = new AbortController();
  const requested = Number(options.timeoutMs);
  const ms =
    Number.isFinite(requested) && requested > 0
      ? requested
      : Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : 10000;
  const timer = setTimeout(() => controller.abort(), ms);
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
      const timeoutErr = new Error(`Interakt timeout after ${ms}ms`);
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

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

async function trackUser(phone, traits = {}, { force = false } = {}) {
  const extraTraits = traits && typeof traits === "object" ? traits : {};
  const hasExtraTraits = Object.keys(extraTraits).length > 0;
  if (!force && !hasExtraTraits && wasTrackedRecently(phone)) {
    return { ok: true, cached: true };
  }

  const cfg = getConfig();
  const { countryCode, phoneNumber } = splitPhone(phone, cfg.countryCode);
  const data = await interaktFetch("/track/users/", {
    countryCode,
    phoneNumber,
    traits: {
      whatsapp_opted_in: true,
      ...extraTraits,
    },
  });
  rememberTracked(phone);
  return data;
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

async function sendInteractivePayload(phoneParts, type, data, callbackData, timeoutMs) {
  return interaktFetch(
    "/message/",
    {
      countryCode: phoneParts.countryCode,
      phoneNumber: phoneParts.phoneNumber,
      type,
      callbackData: String(callbackData).slice(0, 512),
      data,
    },
    { timeoutMs }
  );
}

async function postInteractiveVariants(phone, variants, callbackData, kind) {
  const ordered = orderInteractiveVariants(kind, variants);
  const phoneAttempt = collectPhoneAttempts(phone)[0];
  if (!phoneAttempt) throw new Error("رقم غير صالح");

  const budgetMs = interactiveBudgetMs();
  const started = Date.now();
  let lastErr = null;

  for (const variant of ordered) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 400) break;
    try {
      const result = await sendInteractivePayload(
        phoneAttempt,
        variant.type,
        variant.data,
        callbackData,
        remaining
      );
      rememberInteractiveType(kind, variant.type);
      markInteractiveUp(kind);
      return result;
    } catch (err) {
      lastErr = err;
      console.warn(
        "[interakt] Interactive فشل",
        variant.type,
        err.message,
        err.data ? JSON.stringify(err.data) : ""
      );
      // مهلة أو نافذة 24 ساعة: لا نكمل أنواعاً أخرى. النص يُرسل من مسار الرد.
      if (isSessionWindowError(err) || isTimeoutError(err)) {
        throw err;
      }
    }
  }

  throw lastErr || new Error("فشل الإرسال التفاعلي");
}

async function sendOneInteractiveButton(phone, bodyText, buttons, callbackData = "bot_buttons") {
  const data = buildButtonMessageData(bodyText, buttons);
  const withHeader = buildButtonMessageData(bodyText, buttons, {
    header: "ماجد",
  });
  return postInteractiveVariants(
    phone,
    [
      { type: "InteractiveButton", data },
      { type: "Button", data: withHeader },
    ],
    callbackData,
    "buttons"
  );
}

async function sendOneInteractiveList(
  phone,
  bodyText,
  buttonText,
  rows,
  callbackData = "bot_list"
) {
  const data = buildListMessageData(bodyText, buttonText, rows);
  const withHeader = buildListMessageData(bodyText, buttonText, rows, {
    header: "الخيارات",
  });
  return postInteractiveVariants(
    phone,
    [
      { type: "InteractiveList", data },
      { type: "List", data: withHeader },
    ],
    callbackData,
    "list"
  );
}

async function sendListAsButtonGroups(phone, menu) {
  const chunks = listToButtonMenuChunks(menu);
  if (!chunks.length) throw new Error("قائمة غير صالحة");

  const cfg = getConfig();
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const data = await sendOneInteractiveButton(
        phone,
        chunks[i].body,
        chunks[i].buttons,
        `bot_buttons:${i + 1}`
      );
      results.push({ mode: "buttons", data });
    } catch (err) {
      if (!results.length) throw err;
      const rest = chunks.slice(i).flatMap((c) => c.buttons);
      const lines = rest.map((b) => `${b.id}- ${b.title}`).join("\n");
      console.warn(
        "[interakt] بقية الأزرار فشلت، نص للخيارات المتبقية:",
        err.message
      );
      await sendOneText(phone, `الخيارات المتبقية:\n${lines}`, "bot_reply:menu_rest");
      break;
    }
    if (i < chunks.length - 1 && cfg.chunkDelayMs > 0) {
      await sleep(cfg.chunkDelayMs);
    }
  }
  return { ok: true, mode: "buttons-split", parts: results.length, data: results };
}

async function sendButtonsWithMetaFallback(phone, menu) {
  if (
    nextInteractiveAttempt("buttons", {
      buttonsPaused: interactiveIsPaused("buttons"),
    }) === "text"
  ) {
    throw new Error("الأزرار التفاعلية متوقفة مؤقتاً — إرسال نص");
  }
  try {
    return await sendOneInteractiveButton(phone, menu.body, menu.buttons);
  } catch (err) {
    if (isSessionWindowError(err)) throw err;
    const meta = require("./meta-client");
    if (meta.isConfigured && meta.isConfigured()) {
      console.warn("[interakt] الأزرار فشلت، تجربة Meta Cloud API:", err.message);
      return meta.sendInteractive(phone, menu);
    }
    markInteractiveDown("buttons");
    throw err;
  }
}

async function sendInteractiveViaInterakt(phone, menu) {
  if (!menu || !menu.kind) {
    throw new Error("قائمة تفاعلية غير صالحة");
  }
  trackUserSoon(phone);

  if (menu.kind === "buttons") {
    return sendButtonsWithMetaFallback(phone, menu);
  }
  if (menu.kind === "list") {
    const listPaused = interactiveIsPaused("list");
    if (!listPaused) {
      try {
        return await sendOneInteractiveList(
          phone,
          menu.body,
          menu.buttonText || "الخيارات",
          menu.rows
        );
      } catch (listErr) {
        if (isSessionWindowError(listErr)) throw listErr;
        console.warn(
          "[interakt] القائمة التفاعلية فشلت، تجربة أزرار:",
          listErr.message
        );
        markInteractiveDown("list");
      }
    } else {
      console.warn("[interakt] القائمة متوقفة مؤقتاً — إرسال أزرار بدون انتظار");
    }

    if (
      nextInteractiveAttempt("list", {
        listFailed: true,
        buttonsPaused: interactiveIsPaused("buttons"),
      }) === "text"
    ) {
      throw new Error("القوالب التفاعلية متوقفة مؤقتاً — إرسال نص");
    }

    try {
      return await sendListAsButtonGroups(phone, menu);
    } catch (btnErr) {
      if (isSessionWindowError(btnErr)) throw btnErr;
      const meta = require("./meta-client");
      if (meta.isConfigured && meta.isConfigured()) {
        console.warn(
          "[interakt] الأزرار فشلت أيضاً، تجربة Meta Cloud API:",
          btnErr.message
        );
        return meta.sendInteractive(phone, menu);
      }
      markInteractiveDown("buttons");
      throw btnErr;
    }
  }
  throw new Error(`نوع قائمة غير مدعوم: ${menu.kind}`);
}

function isTemplateMissingError(err) {
  const msg = String(err?.message || err?.data?.message || "");
  return /no approved template/i.test(msg);
}

function isSessionWindowError(err) {
  const msg = String(err?.message || err?.data?.message || "");
  return /not messaged within last 24 hours|outside (the )?session|24-hour window|session window/i.test(
    msg
  );
}

async function sendOneText(phone, bodyText, callbackData = "bot_reply") {
  const message = String(bodyText || "").trim();
  if (!message) return { ok: false, skipped: true };

  const attempts = collectPhoneAttempts(phone);
  let lastErr = null;
  for (const a of attempts) {
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
        `${a.countryCode}${String(a.phoneNumber).slice(0, 2)}***${String(a.phoneNumber).slice(-2)}`,
        err.message
      );
      if (isSessionWindowError(err)) {
        throw err;
      }
    }
  }
  throw lastErr || new Error("فشل إرسال النص الحر");
}

async function sendNamedTemplate(phone, templateName, bodyValues, languageCode) {
  const cfg = getConfig();
  const name = String(templateName || "").trim();
  if (!name) throw new Error("كود قالب إنترأكت مطلوب");
  const { countryCode, phoneNumber } = splitPhone(phone, cfg.countryCode);
  const values = Array.isArray(bodyValues)
    ? bodyValues.map((v) => sanitizeChunk(v)).filter(Boolean)
    : String(bodyValues || "")
        .split(",")
        .map((v) => sanitizeChunk(v))
        .filter(Boolean);

  await trackUser(phone).catch((err) => {
    console.warn("[interakt] trackUser:", err.message);
  });

  const template = {
    name,
    languageCode: String(languageCode || cfg.replyLanguage || "ar").trim(),
  };
  if (values.length) template.bodyValues = values;

  return interaktFetch("/message/", {
    countryCode,
    phoneNumber,
    type: "Template",
    callbackData: "admin_followup",
    template,
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

  trackUserSoon(phone);

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

function extractUsersList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data?.customers)) return data.data.customers;
  if (Array.isArray(data?.result?.users)) return data.result.users;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function listUsersPage({ offset = 0, limit = 100, sinceIso } = {}) {
  const body = {
    filters: [
      {
        trait: "created_at_utc",
        op: "gt",
        val: sinceIso || "1970-01-01T00:00:00.000Z",
      },
    ],
  };
  const data = await interaktFetch(
    `/apis/users/?offset=${Number(offset) || 0}&limit=${Math.min(Number(limit) || 100, 100)}`,
    body
  );
  const users = extractUsersList(data);
  const hasNext =
    data?.data?.has_next_page === true ||
    data?.has_next_page === true ||
    data?.result?.has_next_page === true ||
    users.length >= Math.min(Number(limit) || 100, 100);
  return {
    users,
    hasNext,
    total: data?.data?.total_customers ?? data?.total_customers ?? null,
    raw: data,
  };
}

module.exports = {
  getConfig,
  isConfigured,
  splitPhone,
  collectPhoneAttempts,
  sanitizeChunk,
  sanitizeTemplateVariable: sanitizeChunk,
  splitReplyChunks,
  splitFreeTextChunks,
  trackUser,
  trackUserSoon,
  orderInteractiveVariants,
  rememberInteractiveType,
  interactiveIsPaused,
  nextInteractiveAttempt,
  sendOneText,
  sendOneTemplate,
  sendNamedTemplate,
  sendOneInteractiveButton,
  sendOneInteractiveList,
  sendInteractiveViaInterakt,
  sendTemplateReply,
  sendWhatsAppTextViaInterakt,
  listUsersPage,
  extractUsersList,
  interaktFetch,
  isSessionWindowError,
  isTemplateMissingError,
  isTimeoutError,
};
