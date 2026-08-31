/**
 * اختبار: خيار «سياسة الرواتب المطلوبة» في القائمة الرئيسية
 * وبعد الاختيار تظهر حدود الراتب حسب القطاع، وأقل من ذلك يُرفض.
 */
const assert = require("assert");
const CONFIG = require("../config");
const menus = require("../lib/menus");
const messages = require("../lib/messages");
const sessionStore = require("../lib/session");
const { handleIncomingMessage } = require("../lib/handlers");
const {
  parseInquiryType,
  parseSalaryPolicyChoice,
} = require("../lib/validators");
const { buildButtonMessageData } = require("../lib/interactive-menu");

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
  "حدود config مطابقة للقائمة"
);

ok(parseInquiryType("7") === "salary_policy", "رقم 7 = سياسة الرواتب");
ok(
  parseInquiryType("سياسة الرواتب المطلوبة") === "salary_policy",
  "عنوان الخيار = سياسة الرواتب"
);
ok(parseInquiryType("سياسة الرواتب") === "salary_policy", "عنوان الزر المختصر");
ok(parseInquiryType("8") === "assistant_contact", "رقم المساعد انتقل إلى 8");

const main = menus.inquiryMain();
const row = main.rows.find((r) => r.id === "7");
ok(row && row.title === "سياسة الرواتب المطلوبة", "صف القائمة بالاسم المطلوب");
ok(String(row.title).length <= 24, "عنوان صف القائمة ضمن حد واتساب");

const policy = menus.salaryPolicy();
ok(policy.kind === "buttons", "بعد الاختيار تُرسل أزرار القطاعات");
ok(policy.buttons.length === 3, "ثلاثة قطاعات");
ok(
  policy.body.includes("أقل راتب ينزل في الصراف إيداع راتب"),
  "نص أقل راتب للصراف"
);
ok(policy.body.includes("* 4,000 ريال للمدني"), "سطر المدني");
ok(policy.body.includes("* 4,000 ريال للمتقاعد"), "سطر المتقاعد");
ok(policy.body.includes("* 10,000 ريال للعسكري"), "سطر العسكري");
ok(policy.body.includes("أقل مما ذُكر يتم رفضه"), "ملاحظة الرفض");

for (const btn of policy.buttons) {
  ok(String(btn.title).length <= 20, `عنوان الزر ≤20: ${btn.title}`);
}

const policyData = buildButtonMessageData(policy.body, policy.buttons);
ok(policyData.message.type === "button", "حمولة سياسة الرواتب type=button");
ok(policyData.message.action.buttons.length === 3, "ثلاثة أزرار في الحمولة");

ok(parseSalaryPolicyChoice("sal_civilian") === "civilian", "زر المدني");
ok(parseSalaryPolicyChoice("sal_retired") === "retired", "زر المتقاعد");
ok(parseSalaryPolicyChoice("sal_military") === "military", "زر العسكري");
ok(parseSalaryPolicyChoice("مدني 4,000 ريال") === "civilian", "عنوان زر المدني");
ok(
  parseSalaryPolicyChoice("عسكري 10,000 ريال") === "military",
  "عنوان زر العسكري"
);

const civilianMsg = messages.salaryPolicyDetailMessage("civilian");
ok(civilianMsg.includes("4,000") && civilianMsg.includes("المدني"), "تأكيد المدني");
ok(civilianMsg.includes("يتم رفضه"), "تأكيد الرفض في التفصيل");
const militaryMsg = messages.salaryPolicyDetailMessage("military");
ok(
  militaryMsg.includes("10,000") && militaryMsg.includes("العسكري"),
  "تأكيد العسكري"
);

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
  ok(first.sent.menus.length === 1, "أُرسلت قائمة/أزرار السياسة");
  ok(
    first.sent.menus[0].body.includes("* 4,000 ريال للمدني") &&
      first.sent.menus[0].body.includes("* 10,000 ريال للعسكري"),
    "قائمة الحدود تظهر بعد الاختيار"
  );
  ok(
    sessionStore.getSession(from)?.step === "salary_policy",
    "الجلسة تنتظر اختيار القطاع"
  );

  const second = mockMsg(from, "sal_military");
  const handledPick = await handleIncomingMessage(second.msg);
  ok(handledPick === true, "اختيار العسكري يُعالج");
  ok(
    second.sent.texts.some(
      (t) => t.includes("10,000") && t.includes("العسكري") && t.includes("رفضه")
    ),
    "تأكيد حد العسكري بعد الاختيار"
  );
  ok(
    sessionStore.getSession(from)?.step === "inquiry_type",
    "بعد العرض تُصفَّر الحسبة وتبدأ جلسة من القائمة"
  );

  console.log("smoke-salary-policy: OK");
})().catch((err) => {
  console.error("smoke-salary-policy FAILED:", err);
  process.exit(1);
});
