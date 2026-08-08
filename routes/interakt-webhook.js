/**
 * Webhook Interakt — استقبال رسائل واتساب وتشغيل بوت المحادثة
 * POST /webhooks/interakt
 *
 * يجب الرد 200 خلال 3 ثوانٍ — لذلك نعالج المحادثة بشكل غير متزامن.
 */
const express = require("express");
const { verifySignature, parseInboundMessage } = require("../lib/interakt-webhook");
const { createInteraktMessage } = require("../lib/interakt-adapter");
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
    console.log("[interakt] الرد الآلي متوقف عاماً");
    return;
  }

  const chatId = `${inbound.phone}@c.us`;
  if (autoReplyControl.isChatPaused(chatId)) {
    console.log("[interakt] محادثة متوقفة:", inbound.phone);
    return;
  }

  if (!inbound.body) {
    const msg = createInteraktMessage({
      phone: inbound.phone,
      body: "",
      messageId: inbound.messageId,
    });
    await replyToMessage(msg, messages.nonTextMessage());
    return;
  }

  if (sessionStore.shouldThrottle(chatId, inbound.body)) {
    return;
  }

  const msg = createInteraktMessage({
    phone: inbound.phone,
    body: inbound.body,
    messageId: inbound.messageId,
  });

  try {
    await handleIncomingMessage(msg);
  } catch (err) {
    console.error("[interakt] خطأ معالجة:", err);
    await replyToMessage(msg, messages.temporaryErrorMessage()).catch(() => {});
  }
}

router.post("/", (req, res) => {
  const signature =
    req.headers["interakt-signature"] || req.headers["Interakt-Signature"];
  const raw =
    req.rawBody ||
    (Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body || {}));

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

  // أجب فوراً ثم عالج
  res.status(200).json({ ok: true });

  if (!payload || !payload.type) return;

  if (payload.type === "message_received") {
    const inbound = parseInboundMessage(payload);
    if (!inbound) {
      console.warn("[interakt] رسالة واردة بلا رقم");
      return;
    }
    const phoneTail = String(inbound.phone || "").slice(-4);
    console.log(
      "[interakt] وارد:",
      JSON.stringify({
        body: inbound.body,
        contentType: inbound.contentType,
        phoneTail,
        customerId: inbound.customerId,
        rawCustomer: inbound.rawCustomer,
      })
    );
    try {
      const fs = require("fs");
      fs.writeFileSync(
        "/tmp/interakt-last-inbound.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            body: inbound.body,
            contentType: inbound.contentType,
            phone: inbound.phone,
            rawCustomer: inbound.rawCustomer,
            message: payload?.data?.message || null,
          },
          null,
          2
        )
      );
    } catch (_) {
      /* ignore */
    }
    setImmediate(() => {
      processInbound(inbound).catch((err) =>
        console.error("[interakt] فشل غير متزامن:", err)
      );
    });
    return;
  }

  // حالات التسليم وغيرها — نسبرها فقط
  if (String(payload.type).startsWith("message_")) {
    console.log("[interakt] حالة:", payload.type, payload.data?.message?.id || "");
  }
});

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "interakt-webhook",
    hint: "اضبط هذا المسار في Interakt → Developer Settings → Webhook URL",
  });
});

module.exports = router;
