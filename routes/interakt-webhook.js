/**
 * Webhook Interakt — استقبال رسائل واتساب وتشغيل بوت المحادثة
 * POST /webhooks/interakt
 *
 * يجب الرد 200 خلال 3 ثوانٍ — لذلك نعالج المحادثة بشكل غير متزامن.
 */
const express = require("express");
const {
  verifySignature,
  parseInboundMessage,
  parseOwnerOutboundCommand,
} = require("../lib/interakt-webhook");
const { createInteraktMessage } = require("../lib/interakt-adapter");
const { handleIncomingMessage } = require("../lib/handlers");
const { replyToMessage } = require("../lib/reply");
const messages = require("../lib/messages");
const autoReplyControl = require("../lib/auto-reply-control");
const sessionStore = require("../lib/session");
const { setCurrentWaAccountId } = require("../lib/current-wa-account");
const waAccounts = require("../lib/whatsapp-accounts-store");
const {
  tryHandleCustomerChatControl,
} = require("../lib/customer-chat-control");
const {
  tryHandleOwnerCommandByPhone,
} = require("../lib/owner-chat-control");
const { sendWhatsAppTextViaInterakt } = require("../lib/interakt-client");

const router = express.Router();

async function processOwnerOutbound(outbound) {
  setCurrentWaAccountId(waAccounts.getActiveAccount().id);

  const handled = await tryHandleOwnerCommandByPhone(outbound.phone, outbound.body, {
    send: async (_chatId, text) => {
      await sendWhatsAppTextViaInterakt(outbound.phone, text);
    },
  });

  if (handled) {
    console.log(
      "[interakt] أمر مالك:",
      outbound.body,
      "→",
      String(outbound.phone).slice(-4),
      outbound.chatMessageType
    );
  }
  return handled;
}

async function processInbound(inbound) {
  setCurrentWaAccountId(waAccounts.getActiveAccount().id);

  const chatId = `${inbound.phone}@c.us`;

  if (!inbound.body) {
    if (
      !autoReplyControl.isEnabled() ||
      autoReplyControl.isChatPausedForIdentity(chatId, {
        extraKeys: [inbound.phone],
      })
    ) {
      return;
    }
    const msg = createInteraktMessage({
      phone: inbound.phone,
      body: "",
      messageId: inbound.messageId,
    });
    await replyToMessage(msg, messages.nonTextMessage());
    return;
  }

  const msg = createInteraktMessage({
    phone: inbound.phone,
    body: inbound.body,
    messageId: inbound.messageId,
  });

  // stop/start من العميل قبل فحص الإيقاف العام/الخاص
  try {
    if (await tryHandleCustomerChatControl(msg)) return;
  } catch (err) {
    console.error("[interakt] خطأ أمر stop/start:", err);
  }

  if (!autoReplyControl.isEnabled()) {
    console.log("[interakt] الرد الآلي متوقف عاماً");
    return;
  }

  if (
    autoReplyControl.isChatPausedForIdentity(chatId, {
      extraKeys: [inbound.phone, msg._interaktPhone, msg._interaktDisplay],
    })
  ) {
    console.log("[interakt] محادثة متوقفة:", inbound.phone);
    return;
  }

  if (sessionStore.shouldThrottle(chatId, inbound.body)) {
    return;
  }

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

  // أوامر stop/start من رسالة صادرة (وكيل / واتساب الأعمال / API)
  const ownerOutbound = parseOwnerOutboundCommand(payload);
  if (ownerOutbound) {
    const cmd = autoReplyControl.parseOwnerCommand(ownerOutbound.body);
    if (cmd) {
      setImmediate(() => {
        processOwnerOutbound(ownerOutbound).catch((err) =>
          console.error("[interakt] فشل أمر المالك:", err)
        );
      });
      return;
    }
  }

  if (payload.type === "message_received") {
    const inbound = parseInboundMessage(payload);
    if (!inbound) {
      // ربما رسالة وكيل بلا نص أمر — نتجاهل بهدوء
      if (payload.data?.message?.chat_message_type !== "CustomerMessage") {
        return;
      }
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
