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
  tryHumanTakeoverByPhone,
  setPausedByPhone,
} = require("../lib/owner-chat-control");
const {
  parseOwnerOutboundCommand,
  parseOwnerOutboundActivity,
  parseInboundMessage,
} = require("../lib/interakt-webhook");
const {
  parseOwnerRemoteCommand,
  isOwnerControlPhone,
  tryHandleOwnerRemoteControl,
} = require("../lib/owner-remote-control");
const {
  tryHandleCustomerChatControl,
} = require("../lib/customer-chat-control");
const { rememberActiveCustomer } = require("../lib/last-active-customer");

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
  assert.strictEqual(
    autoReplyControl.parseOwnerCommand("\u200fStop\u200f"),
    "stop",
    "Stop مع علامات اتجاه يجب أن يُفهم"
  );
  assert.strictEqual(
    autoReplyControl.parseOwnerCommand("/stop"),
    "stop",
    "/stop يجب أن يُفهم"
  );
  assert.strictEqual(
    autoReplyControl.parseOwnerCommand("stop."),
    "stop",
    "stop. يجب أن يُفهم"
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

  // Interakt: رد يدوي طويل من الوكيل = إيقاف تلقائي لهذا العميل فقط
  autoReplyControl.resumeChat(chatId, { extraKeys: [phone] });
  const agentReplyPayload = {
    type: "message_received",
    data: {
      customer: { channel_phone_number: phone },
      message: {
        id: "m1b",
        chat_message_type: "AgentMessage",
        message_content_type: "Text",
        message:
          "أهلاً بك، سأتابع طلبك شخصياً الآن وسأرجع لك خلال دقائق بالتفاصيل الكاملة بعد مراجعة الملف والراتب والالتزامات الحالية.",
      },
    },
  };
  const agentActivity = parseOwnerOutboundActivity(agentReplyPayload);
  assert.ok(agentActivity, "يجب رصد نشاط الوكيل للرد اليدوي");
  assert.strictEqual(
    parseOwnerOutboundCommand(agentReplyPayload),
    null,
    "الرد الطويل ليس أمر stop/start"
  );
  const takeover = tryHumanTakeoverByPhone(phone, {
    waAccountId: ACCOUNT,
    reason: agentActivity.body,
  });
  assert.strictEqual(takeover.ok, true);
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(chatId, { extraKeys: [phone] }),
    true,
    "الرد اليدوي من الوكيل يجب أن يوقف هذا العميل فقط"
  );
  const resumedAfterTakeover = await tryHandleOwnerCommandByPhone(
    phone,
    "start",
    {}
  );
  assert.strictEqual(resumedAfterTakeover, true);
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(chatId, { extraKeys: [phone] }),
    false,
    "start يجب أن يستأنف بعد الإيقاف التلقائي"
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

  // message_api_sent للقوالب يجب ألا يُفسَّر كأمر Stop
  const templateSent = {
    type: "message_api_sent",
    data: {
      customer: { channel_phone_number: phone },
      message: {
        chat_message_type: "PublicApiMessage",
        is_template_message: true,
        message_content_type: "Template",
        message: "stop",
      },
    },
  };
  assert.strictEqual(
    parseOwnerOutboundCommand(templateSent),
    null,
    "قوالب message_api_sent ليست أوامر مالك"
  );

  // أوامر المالك عن بُعد (المسار الموثوق على Interakt)
  process.env.OWNER_CONTROL_PHONES = "966509998887";
  assert.strictEqual(isOwnerControlPhone("0509998887"), true);
  assert.strictEqual(isOwnerControlPhone("0501111111"), false);
  const remote = parseOwnerRemoteCommand("stop 0501234567");
  assert.ok(remote);
  assert.strictEqual(remote.cmd, "stop");
  assert.strictEqual(remote.targetPhone, phone);

  rememberActiveCustomer(phone);
  const plainStop = parseOwnerRemoteCommand("stop");
  assert.ok(plainStop);
  assert.strictEqual(plainStop.cmd, "stop");
  assert.strictEqual(plainStop.targetPhone, null);

  autoReplyControl.resumeChat(chatId, { extraKeys: [phone] });
  const remotePlain = await tryHandleOwnerRemoteControl("966509998887", "stop", {});
  assert.strictEqual(remotePlain, true);
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(chatId, { extraKeys: [phone] }),
    true,
    "stop بدون رقم يجب أن يوقف آخر عميل نشط"
  );

  // رقم التحكم + عميل نشط: Stop يوقف العميل النشط (مو جلسة المالك)
  autoReplyControl.resumeChat(chatId, { extraKeys: [phone] });
  const ownerSelf = "966509998887";
  sessionStore.startSession(`${ownerSelf}@c.us`);
  rememberActiveCustomer(phone);
  const selfStop = await tryHandleOwnerRemoteControl(ownerSelf, "Stop", {});
  assert.strictEqual(selfStop, true);
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(chatId, { extraKeys: [phone] }),
    true,
    "Stop من رقم التحكم يجب أن يوقف آخر عميل نشط"
  );
  assert.strictEqual(
    await tryHandleOwnerRemoteControl(ownerSelf, "مرحبا"),
    false,
    "رسائل غير أوامر من رقم التحكم تكمل كعميل"
  );

  // العميل لا يستطيع إيقاف/تشغيل الرد الآلي بنص stop/start
  autoReplyControl.resumeChat(chatId, { extraKeys: [phone] });
  const customerStopIgnored = await tryHandleCustomerChatControl({
    from: chatId,
    body: "stop",
    _interaktPhone: phone,
  });
  assert.strictEqual(customerStopIgnored, false, "أمر العميل stop لا يُعالَج");
  assert.strictEqual(
    autoReplyControl.isChatPausedForIdentity(chatId, { extraKeys: [phone] }),
    false,
    "رسالة stop من العميل يجب ألا توقف الرد الآلي"
  );
  const customerStartIgnored = await tryHandleCustomerChatControl({
    from: chatId,
    body: "start",
    _interaktPhone: phone,
  });
  assert.strictEqual(customerStartIgnored, false, "أمر العميل start لا يُعالَج");

  // قائمة المالك فقط تتضمن زر إيقاف/تشغيل الرد
  const menus = require("../lib/menus");
  const { parseInquiryType } = require("../lib/validators");
  assert.strictEqual(
    menus.inquiryMain().rows.some((r) => r.id === "owner_pause_reply"),
    false,
    "قائمة العميل بلا زر إيقاف"
  );
  const ownerMenu = menus.inquiryMain({ ownerControls: true });
  assert.strictEqual(
    ownerMenu.rows[0].id,
    "owner_pause_reply",
    "إيقاف الرد الآلي يجب أن يكون أول خيار للمالك"
  );
  assert.ok(
    ownerMenu.rows.some((r) => r.id === "owner_resume_reply"),
    "قائمة المالك فيها تشغيل الرد الآلي"
  );
  const ownerBtns = menus.ownerAutoReplyControls();
  assert.strictEqual(ownerBtns.kind, "buttons");
  assert.strictEqual(ownerBtns.buttons.length, 2);
  assert.strictEqual(parseInquiryType("owner_pause_reply"), "pause_auto_reply");
  assert.strictEqual(parseInquiryType("owner_resume_reply"), "resume_auto_reply");
  delete process.env.OWNER_CONTROL_PHONES;

  cleanup();
  console.log("smoke-stop-start: OK");
}

main().catch((err) => {
  cleanup();
  console.error("smoke-stop-start FAILED:", err);
  process.exit(1);
});
