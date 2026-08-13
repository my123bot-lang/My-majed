/**
 * Webhook Meta WhatsApp Cloud API
 * GET  /webhooks/meta  — تحقق الاشتراك (hub.verify_token)
 * POST /webhooks/meta  — رسائل واردة + smb_message_echoes (تطبيق الأعمال)
 */
const express = require("express");
const {
  verifyChallenge,
  verifySignature,
  parseInboundMessages,
  parseOwnerEchoMessages,
} = require("../lib/meta-webhook");
const { createMetaMessage } = require("../lib/meta-adapter");
const { markAsRead, isConfigured, sendText } = require("../lib/meta-client");
const { handleIncomingMessage } = require("../lib/handlers");
const { replyToMessage } = require("../lib/reply");
const messages = require("../lib/messages");
const autoReplyControl = require("../lib/auto-reply-control");
const sessionStore = require("../lib/session");
const { setCurrentWaAccountId } = require("../lib/current-wa-account");
const waAccounts = require("../lib/whatsapp-accounts-store");
const {
  tryHandleOwnerCommandByPhone,
  tryHumanTakeoverByPhone,
} = require("../lib/owner-chat-control");
const {
  tryHandleOwnerRemoteControl,
  isOwnerControlPhone,
} = require("../lib/owner-remote-control");
const { recordInboundContact } = require("../lib/call-stats");

const router = express.Router();

async function ackToCustomer(phone, text) {
  // فضّل Meta إن وُجد؛ وإلا Interakt (نفس رقم العمل على السحابة)
  if (isConfigured() && typeof sendText === "function") {
    try {
      await sendText(phone, text);
      return;
    } catch (err) {
      console.warn("[meta] فشل تأكيد عبر Meta، تجربة Interakt:", err.message);
    }
  }
  try {
    const { sendWhatsAppTextViaInterakt, isConfigured: interaktOk } = require("../lib/interakt-client");
    if (interaktOk()) {
      await sendWhatsAppTextViaInterakt(phone, text, "owner_ack");
    }
  } catch (err) {
    console.warn("[meta] فشل تأكيد الإيقاف للعميل:", err.message);
  }
}

async function processOwnerEcho(echo) {
  setCurrentWaAccountId(waAccounts.getActiveAccount().id);

  console.log(
    "[meta] echo من تطبيق الأعمال →",
    String(echo.phone).slice(-4),
    String(echo.body || "").slice(0, 40)
  );

  const cmd = autoReplyControl.parseOwnerCommand(echo.body);
  if (cmd) {
    await tryHandleOwnerCommandByPhone(echo.phone, echo.body, {
      send: async (_chatId, text) => {
        await ackToCustomer(echo.phone, text);
      },
    });
    return;
  }

  // أي رد يدوي من تطبيق الأعمال = إيقاف هذا العميل
  tryHumanTakeoverByPhone(echo.phone, { reason: echo.body });
}

async function processInbound(inbound) {
  setCurrentWaAccountId(waAccounts.getActiveAccount().id);

  const chatId = `${inbound.phone}@c.us`;

  if (inbound.messageId && isConfigured()) {
    await markAsRead(inbound.messageId).catch(() => {});
  }

  if (inbound.body && isOwnerControlPhone(inbound.phone)) {
    try {
      const handled = await tryHandleOwnerRemoteControl(inbound.phone, inbound.body, {
        send: async (_chatId, text) => {
          await ackToCustomer(inbound.phone, text);
        },
      });
      if (handled) return;
    } catch (err) {
      console.error("[meta] خطأ أمر مالك عن بُعد:", err);
      return;
    }
  }

  if (!inbound.body) {
    if (
      !autoReplyControl.isEnabled() ||
      autoReplyControl.isChatPausedForIdentity(chatId, {
        extraKeys: [inbound.phone],
      })
    ) {
      return;
    }
    const emptyMsg = createMetaMessage(inbound);
    await replyToMessage(emptyMsg, messages.nonTextMessage());
    return;
  }

  const msg = createMetaMessage(inbound);

  if (!autoReplyControl.isEnabled()) {
    console.log("[meta] الرد الآلي متوقف عاماً");
    return;
  }

  if (
    autoReplyControl.isChatPausedForIdentity(chatId, {
      extraKeys: [inbound.phone],
    })
  ) {
    console.log("[meta] محادثة متوقفة:", inbound.phone);
    return;
  }

  if (sessionStore.shouldThrottle(chatId, inbound.body)) {
    return;
  }

  try {
    recordInboundContact(inbound.phone);
  } catch (_) {
    /* ignore */
  }

  try {
    await handleIncomingMessage(msg);
  } catch (err) {
    console.error("[meta] خطأ معالجة:", err);
    await replyToMessage(msg, messages.temporaryErrorMessage()).catch(() => {});
  }
}

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

  // أولاً: أصداء تطبيق واتساب الأعمال — لا تحتاج إعداد إرسال Meta
  const ownerEchoes = parseOwnerEchoMessages(payload);
  for (const echo of ownerEchoes) {
    setImmediate(() => {
      processOwnerEcho(echo).catch((err) =>
        console.error("[meta] فشل أمر/إيقاف من تطبيق الأعمال:", err)
      );
    });
  }

  const inboundList = parseInboundMessages(payload);
  if (inboundList.length && !isConfigured()) {
    console.error(
      "[meta] رسالة واردة لكن META_WA_TOKEN / META_WA_PHONE_NUMBER_ID غير مضبوطين — تُتجاهل الواردات (أصداء stop تُعالج)"
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
