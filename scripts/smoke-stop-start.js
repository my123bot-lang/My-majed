/**
 * اختبار سريع: stop يوقف عميلاً واحداً عبر مفاتيح @lid ورقم الجوال.
 * تشغيل: node scripts/smoke-stop-start.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { setCurrentWaAccountId } = require("../lib/current-wa-account");
const autoReplyControl = require("../lib/auto-reply-control");
const sessionStore = require("../lib/session");
const {
  tryHandleOwnerCommandByPhone,
  setPausedByPhone,
} = require("../lib/owner-chat-control");
const {
  parseOwnerOutboundCommand,
  parseInboundMessage,
} = require("../lib/interakt-webhook");

const ACCOUNT = "smoke-stop-start";
const DATA_FILE = path.join(
  __dirname,
  "..",
  "data",
  `paused-chats-${ACCOUNT}.json`
);

function cleanup() {
  try {
    if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
  } catch (_) {
    /* ignore */
  }
  for (const id of Object.keys(sessionStore.sessions)) {
    sessionStore.clearSession(id);
  }
  autoReplyControl.enable({ clearPausedChats: true });
}

async function main() {
  setCurrentWaAccountId(ACCOUNT);
  cleanup();

  const lid = "123456789012345@lid";
  const phone = "966501234567";
  const chatId = `${phone}@c.us`;

  sessionStore.startSession(lid);
  const session = sessionStore.getSession(lid);
  session.whatsappNumber = phone;
  session.phoneDisplay = "0501234567";
  session.chatId = lid;

  assert.strictEqual(
    autoReplyControl.parseOwnerCommand("Stop"),
    "stop",
    "Stop يجب أن يُفهم كأمر"
  );
  assert.strictEqual(
    autoReplyControl.parseOwnerCommand("START"),
    "start",
    "START يجب أن يُفهم كأمر"
  );

  const handled = await tryHandleOwnerCommandByPhone(phone, "stop", {});
  assert.strictEqual(handled, true, "يجب معالجة stop");
  assert.strictEqual(
    sessionStore.getSession(lid),
    null,
    "يجب مسح جلسة @lid بعد stop"
  );
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(lid, { extraKeys: [phone] }),
    true,
    "المحادثة @lid يجب أن تكون موقوفة بعد stop بالرقم"
  );
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(chatId),
    true,
    "المحادثة @c.us يجب أن تكون موقوفة"
  );

  const resumed = await tryHandleOwnerCommandByPhone(phone, "start", {});
  assert.strictEqual(resumed, true);
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(lid, { extraKeys: [phone] }),
    false,
    "start يجب أن يستأنف @lid"
  );

  // لوحة التحكم
  sessionStore.startSession(lid);
  sessionStore.getSession(lid).whatsappNumber = phone;
  const apiPause = setPausedByPhone("0501234567", true, {
    waAccountId: ACCOUNT,
  });
  assert.strictEqual(apiPause.ok, true);
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(lid, { extraKeys: [phone] }),
    true
  );

  // Interakt: رسالة وكيل صادرة
  const ownerPayload = {
    type: "message_received",
    data: {
      customer: { channel_phone_number: phone },
      message: {
        id: "m1",
        chat_message_type: "AgentMessage",
        message_content_type: "Text",
        message: "stop",
      },
    },
  };
  const outbound = parseOwnerOutboundCommand(ownerPayload);
  assert.ok(outbound, "يجب استخراج أمر المالك من webhook");
  assert.strictEqual(outbound.body, "stop");
  assert.strictEqual(
    parseInboundMessage(ownerPayload),
    null,
    "رسالة الوكيل لا تدخل مسار الحسبة"
  );

  // Interakt: رسالة عميل عادية
  const customerPayload = {
    type: "message_received",
    data: {
      customer: { channel_phone_number: phone },
      message: {
        id: "m2",
        chat_message_type: "CustomerMessage",
        message_content_type: "Text",
        message: "4000",
      },
    },
  };
  assert.strictEqual(parseOwnerOutboundCommand(customerPayload), null);
  assert.strictEqual(parseInboundMessage(customerPayload)?.body, "4000");

  cleanup();
  console.log("smoke-stop-start: OK");
}

main().catch((err) => {
  cleanup();
  console.error("smoke-stop-start FAILED:", err);
  process.exit(1);
});
