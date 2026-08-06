/**
 * Meta WhatsApp Cloud API — ردود حرة ضمن نافذة 24 ساعة
 * docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
 */
const GRAPH_BASE = "https://graph.facebook.com";

function getConfig() {
  return {
    token: String(
      process.env.META_WA_TOKEN ||
        process.env.WHATSAPP_TOKEN ||
        process.env.META_ACCESS_TOKEN ||
        ""
    ).trim(),
    phoneNumberId: String(
      process.env.META_WA_PHONE_NUMBER_ID ||
        process.env.WHATSAPP_PHONE_NUMBER_ID ||
        ""
    ).trim(),
    apiVersion: String(process.env.META_GRAPH_VERSION || "v21.0").trim(),
    appSecret: String(process.env.META_APP_SECRET || "").trim(),
    verifyToken: String(
      process.env.META_WA_VERIFY_TOKEN ||
        process.env.WHATSAPP_VERIFY_TOKEN ||
        "majed_verify"
    ).trim(),
  };
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.token && cfg.phoneNumberId);
}

function normalizeTo(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 10) d = "966" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) d = "966" + d;
  return d;
}

async function graphFetch(path, body) {
  const cfg = getConfig();
  if (!cfg.token || !cfg.phoneNumberId) {
    throw new Error(
      "META_WA_TOKEN و META_WA_PHONE_NUMBER_ID مطلوبان لإرسال ردود Cloud API"
    );
  }

  const url = `${GRAPH_BASE}/${cfg.apiVersion}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
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
    const errMsg =
      data?.error?.message || data?.message || text || `HTTP ${res.status}`;
    const err = new Error(`Meta Cloud API ${res.status}: ${errMsg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * إرسال نص حر (Service message) — يعمل فقط إذا راسل العميل خلال 24 ساعة
 */
async function sendText(phone, text, options = {}) {
  const cfg = getConfig();
  const to = normalizeTo(phone);
  const body = String(text || "").trim();
  if (!to) throw new Error("رقم المستلم غير صالح");
  if (!body) throw new Error("نص الرسالة فارغ");

  const data = await graphFetch(`/${cfg.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: options.previewUrl === true,
      body: body.slice(0, 4096),
    },
  });

  return { ok: true, data, to };
}

async function markAsRead(messageId) {
  const cfg = getConfig();
  if (!messageId) return null;
  try {
    return await graphFetch(`/${cfg.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  } catch (err) {
    console.warn("[meta] markAsRead:", err.message);
    return null;
  }
}

module.exports = {
  getConfig,
  isConfigured,
  normalizeTo,
  sendText,
  markAsRead,
  graphFetch,
};
