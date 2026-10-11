/**
 * اختبار: خيار «سياسة الرواتب المطلوبة» يرسل ملاحظة نصية بلا أزرار.
 */
const assert = require("assert");
const CONFIG = require("../config");
const menus = require("../lib/menus");
const messages = require("../lib/messages");
const sessionStore = require("../lib/session");
const { handleIncomingMessage } = require("../lib/handlers");
const { parseInquiryType } = require("../lib/validators");

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

const mins = menus.salaryPolicyMinAmounts();
ok(mins.civilian === 4000, "حد المدني 4000");
ok(mins.retired === 4000, "حد المتقاعد 4000");
ok(mins.military === 10000, "حد العسكري 10000");
ok(
  CONFIG.limits.minSalaryByCategory.civilian === 4000 &&
    CONFIG.limits.minSalaryByCategory.retired === 4000 &&
    CONFIG.limits.minSalaryByCategory.military === 10000,
  "حدود config مطابقة للملاحظة"
);

ok(parseInquiryType("7") === "salary_policy", "رقم 7 = سياسة الرواتب");
ok(
  parseInquiryType("سياسة الرواتب المطلوبة") === "salary_policy",
  "عنوان الخيار = سياسة الرواتب"
);
ok(
  parseInquiryType("أقل راتب للصراف حسب القطاع") === "salary_policy",
  "وصف الصف وحده = سياسة الرواتب"
);
ok(
  parseInquiryType(
    "وعليكم السلام ورحمه الله وبركاته\nمرحبا معك ماجد.\nسياسة الرواتب المطلوبة\nأقل راتب للصراف حسب القطاع"
  ) === "salary_policy",
  "الاقتباس مع العنوان والوصف يبقى سياسة الرواتب"
);

const main = menus.inquiryMain();
const row = main.rows.find((r) => r.id === "7");
ok(row && row.title === "سياسة الرواتب المطلوبة", "صف القائمة بالاسم المطلوب");
ok(typeof menus.salaryPolicy !== "function", "لا توجد قائمة أزرار للسياسة");

const note = messages.salaryPolicyNoteMessage();
ok(note.includes("أقل راتب ينزل في الصراف إيداع راتب"), "نص أقل راتب للصراف");
ok(note.includes("* 4,000 ريال للمدني"), "سطر المدني");
ok(note.includes("* 4,000 ريال للمتقاعد"), "سطر المتقاعد");
ok(note.includes("* 10,000 ريال للعسكري"), "سطر العسكري");
ok(note.includes("أقل مما ذُكر يتم رفضه"), "ملاحظة الرفض");
ok(!note.includes("sal_civilian"), "الملاحظة بلا معرفات أزرار");

function mockMsg(from, body) {
  const sent = { menus: [], texts: [] };
  const msg = {
    from,
    body,
    type: "chat",
    sendInteractive: async (menu) => {
      sent.menus.push(menu);
      return { ok: true };
    },
    reply: async (text) => {
      sent.texts.push(text);
    },
  };
  return { msg, sent };
}

(async () => {
  const from = "966501119990@c.us";
  sessionStore.resetUser(from);
  sessionStore.startSession(from);

  const first = mockMsg(from, "سياسة الرواتب المطلوبة");
  const handled = await handleIncomingMessage(first.msg);
  ok(handled === true, "اختيار سياسة الرواتب يُعالج");
  ok(first.sent.menus.length === 0, "لا تُرسل أزرار بعد الاختيار");
  ok(first.sent.texts.length === 1, "تُرسل ملاحظة نصية واحدة");
  ok(
    first.sent.texts[0].includes("* 4,000 ريال للمدني") &&
      first.sent.texts[0].includes("* 4,000 ريال للمتقاعد") &&
      first.sent.texts[0].includes("* 10,000 ريال للعسكري") &&
      first.sent.texts[0].includes("أقل مما ذُكر يتم رفضه"),
    "الملاحظة تعرض الحدود الثلاثة ورسالة الرفض"
  );
  ok(
    sessionStore.getSession(from)?.step === "inquiry_type",
    "بعد الملاحظة تبدأ جلسة من القائمة"
  );

  sessionStore.clearSession(from);
  const descriptionOnly = mockMsg(from, "أقل راتب للصراف حسب القطاع");
  const described = await handleIncomingMessage(descriptionOnly.msg);
  ok(described === true, "وصف الصف بلا جلسة يُعالج ولا يُسكت البوت");
  ok(descriptionOnly.sent.menus.length === 0, "وصف الصف لا يعيد قائمة الأزرار");
  ok(
    descriptionOnly.sent.texts.length === 1 &&
      descriptionOnly.sent.texts[0].includes("أقل راتب ينزل في الصراف إيداع راتب"),
    "وصف الصف يرسل ملاحظة الحدود"
  );

  sessionStore.clearSession(from);
  const quoted = mockMsg(
    from,
    "وعليكم السلام ورحمه الله وبركاته\nمرحبا معك ماجد.\nسياسة الرواتب المطلوبة\nأقل راتب للصراف حسب القطاع"
  );
  const quotedHandled = await handleIncomingMessage(quoted.msg);
  ok(quotedHandled === true, "اختيار مع اقتباس التحية يُعالج");
  ok(
    quoted.sent.texts.some((t) => t.includes("* 10,000 ريال للعسكري")),
    "اقتباس التحية لا يبتلع سياسة الرواتب ويعيد القائمة فقط"
  );
  ok(
    !quoted.sent.menus.some((m) => String(m.body || "").includes("مانوع استفسارك")),
    "لا تُعاد قائمة الاستفسار بدل الملاحظة"
  );

  sessionStore.clearSession(from);
  const listReply = mockMsg(from, "أقل راتب للصراف حسب القطاع");
  listReply.msg.type = "list_response";
  listReply.msg.selectedRowId = "7";
  listReply.msg.title = "سياسة الرواتب المطلوبة";
  listReply.msg.description = "أقل راتب للصراف حسب القطاع";
  const listHandled = await handleIncomingMessage(listReply.msg);
  ok(listHandled === true, "list_response بالوصف والمعرف 7 يُعالج");
  ok(
    listReply.sent.texts.some((t) => t.includes("أقل مما ذُكر يتم رفضه")),
    "list_response يرسل ملاحظة الرفض"
  );

  console.log("smoke-salary-policy: OK");
})().catch((err) => {
  console.error("smoke-salary-policy FAILED:", err);
  process.exit(1);
});
