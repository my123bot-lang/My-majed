/**
 * Webhook Meta WhatsApp Cloud API
 * GET  /webhooks/meta  — تحقق الاشتراك (hub.verify_token)
 * POST /webhooks/meta  — رسائل واردة → بوت المحادثة → رد حر
 */
const express = require("express");
const {
  verifyChallenge,
  verifySignature,
  parseInboundMessages,
} = require("../lib/meta-webhook");
const { createMetaMessage } = require("../lib/meta-adapter");
const { markAsRead, isConfigured } = require("../lib/meta-client");
const { handleIncomingMessage } = require("../lib/handlers");
const { replyToMessage } = require("../lib/reply");
const messages = require("../lib/messages");
const autoReplyControl = require("../lib/auto-reply-control");
const sessionStore = require("../lib/session");
const { setCurrentWaAccountId } = require("../lib/current-wa-account");
const waAccounts = require("../lib/whatsapp-accounts-store");

const router = express.Router();

async function processInbound(inbound) {
  setCurrentWaAccountId(waAccounts.getActiveAccount().id);

  if (!autoReplyControl.isEnabled()) {
    console.log("[meta] الرد الآلي متوقف عاماً");
    return;
  }

  const chatId = `${inbound.phone}@c.us`;
  if (autoReplyControl.isChatPaused(chatId)) {
    console.log("[meta] محادثة متوقفة:", inbound.phone);
    return;
  }

  if (inbound.messageId) {
    await markAsRead(inbound.messageId);
  }

  if (!inbound.body) {
    const msg = createMetaMessage(inbound);
    await replyToMessage(msg, messages.nonTextMessage());
    return;
  }

  if (sessionStore.shouldThrottle(chatId, inbound.body)) {
    return;
  }

  const msg = createMetaMessage(inbound);
  try {
    await handleIncomingMessage(msg);
  } catch (err) {
    console.error("[meta] خطأ معالجة:", err);
    await replyToMessage(msg, messages.temporaryErrorMessage()).catch(() => {});
  }
}

/** تحقق Webhook عند ربطه في Meta Developer */
router.get("/", (req, res) => {
  const challenge = verifyChallenge(req.query || {});
  if (challenge != null) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Verification failed");
});

router.post("/", (req, res) => {
  const signature =
    req.headers["x-hub-signature-256"] || req.headers["X-Hub-Signature-256"];
  const raw =
    req.rawBody ||
    (Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : JSON.stringify(req.body || {}));

  if (!verifySignature(raw, signature)) {
    return res.status(401).json({ ok: false, error: "توقيع غير صالح" });
  }

  let payload = req.body;
  if (Buffer.isBuffer(payload)) {
    try {
      payload = JSON.parse(payload.toString("utf8"));
    } catch (_) {
      return res.status(400).json({ ok: false, error: "JSON غير صالح" });
    }
  }

  // Meta يتطلب 200 سريع
  res.status(200).json({ ok: true });

  const inboundList = parseInboundMessages(payload);
  if (!inboundList.length) return;

  if (!isConfigured()) {
    console.error(
      "[meta] وصول رسالة لكن META_WA_TOKEN / META_WA_PHONE_NUMBER_ID غير مضبوطين"
    );
    return;
  }

  for (const inbound of inboundList) {
    setImmediate(() => {
      processInbound(inbound).catch((err) =>
        console.error("[meta] فشل غير متزامن:", err)
      );
    });
  }
});

module.exports = router;
