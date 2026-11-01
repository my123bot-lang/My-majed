/**
 * اختيار القطاع العسكري أو الخاص يُغلق المحادثة فوراً بنص الاعتذار،
 * بينما المدني الحكومي والمتقاعد يكملان لسؤال الراتب.
 */
const assert = require("assert");
const sessionStore = require("../lib/session");
const { handleIncomingMessage } = require("../lib/handlers");

const MILITARY =
  "نعتذر منكم التمويل غير متاح في الوقت الحالي للقطاع العسكري";
const PRIVATE =
  "نعتذر منكم التمويل غير متاح في الوقت الحالي للقطاع الخاص";

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

function mockMsg(from, body, extra = {}) {
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
    ...extra,
  };
  return { msg, sent };
}

async function openJobType(from, inquiryText) {
  sessionStore.clearSession(from);
  sessionStore.startSession(from);
  const opening = mockMsg(from, inquiryText);
  const handled = await handleIncomingMessage(opening.msg);
  ok(handled === true, `${inquiryText} ينتقل لسؤال القطاع`);
  ok(
    sessionStore.getSession(from)?.step === "job_type",
    `بعد ${inquiryText} الخطوة هي نوع القطاع`
  );
}

(async () => {
  const militaryFrom = "966501110201@c.us";
  await openJobType(militaryFrom, "تمويل شخصي");
  const military = mockMsg(militaryFrom, "عسكري");
  ok(
    (await handleIncomingMessage(military.msg)) === true,
    "اختيار عسكري يُعالَج"
  );
  ok(
    military.sent.texts.length === 1 && military.sent.texts[0] === MILITARY,
    "اعتذار العسكري بالنص المطلوب فقط"
  );
  ok(military.sent.menus.length === 0, "لا تُرسل قائمة بعد اعتذار العسكري");
  ok(!sessionStore.getSession(militaryFrom), "جلسة العسكري تُغلق فوراً");
  ok(sessionStore.isClosed(militaryFrom), "العميل العسكري يُسجَّل مغلقاً");

  const militaryIdFrom = "966501110202@c.us";
  await openJobType(militaryIdFrom, "شراء مديونية");
  const militaryId = mockMsg(militaryIdFrom, "", {
    selectedButtonId: "job_military",
  });
  ok(
    (await handleIncomingMessage(militaryId.msg)) === true,
    "زر عسكري في شراء المديونية يُعالَج"
  );
  ok(
    militaryId.sent.texts[0] === MILITARY,
    "نفس اعتذار العسكري في مسار شراء المديونية"
  );
  ok(!sessionStore.getSession(militaryIdFrom), "جلسة المديونية العسكرية تُغلق");

  const digitFrom = "966501110203@c.us";
  await openJobType(digitFrom, "تمويل شخصي");
  const digit = mockMsg(digitFrom, "2");
  await handleIncomingMessage(digit.msg);
  ok(digit.sent.texts[0] === MILITARY, "رقم 2 في سؤال القطاع = اعتذار عسكري");

  const privateFrom = "966501110204@c.us";
  await openJobType(privateFrom, "تمويل شخصي");
  const civilian = mockMsg(privateFrom, "مدني");
  ok(
    (await handleIncomingMessage(civilian.msg)) === true,
    "اختيار مدني يُعالَج"
  );
  ok(
    sessionStore.getSession(privateFrom)?.step === "civilian_sector",
    "المدني ينتقل لسؤال حكومي أو خاص"
  );
  ok(
    civilian.sent.menus.some((m) =>
      String(m.body || "").includes("اختر نوع الجهة")
    ),
    "تظهر قائمة نوع الجهة"
  );
  const privateChoice = mockMsg(privateFrom, "قطاع خاص");
  ok(
    (await handleIncomingMessage(privateChoice.msg)) === true,
    "اختيار قطاع خاص يُعالَج"
  );
  ok(
    privateChoice.sent.texts.length === 1 &&
      privateChoice.sent.texts[0] === PRIVATE,
    "اعتذار القطاع الخاص بالنص المطلوب فقط"
  );
  ok(
    !privateChoice.sent.texts.some((t) => String(t).includes("اسم الشركة")),
    "لا يُطلب اسم الشركة بعد القطاع الخاص"
  );
  ok(!sessionStore.getSession(privateFrom), "جلسة القطاع الخاص تُغلق فوراً");

  const privateIdFrom = "966501110205@c.us";
  await openJobType(privateIdFrom, "شراء مديونية");
  await handleIncomingMessage(mockMsg(privateIdFrom, "1").msg);
  const privateId = mockMsg(privateIdFrom, "", {
    selectedButtonId: "civ_private",
  });
  await handleIncomingMessage(privateId.msg);
  ok(
    privateId.sent.texts[0] === PRIVATE,
    "زر قطاع خاص في شراء المديونية يعتذر فوراً"
  );
  ok(!sessionStore.getSession(privateIdFrom), "جلسة الخاص في المديونية تُغلق");

  const govFrom = "966501110206@c.us";
  await openJobType(govFrom, "تمويل شخصي");
  await handleIncomingMessage(mockMsg(govFrom, "مدني").msg);
  const gov = mockMsg(govFrom, "حكومي");
  ok((await handleIncomingMessage(gov.msg)) === true, "اختيار حكومي يُعالَج");
  ok(
    gov.sent.texts.some((t) => String(t).includes("أرسل راتبك الشهري")),
    "القطاع الحكومي يكمل لسؤال الراتب"
  );
  ok(
    sessionStore.getSession(govFrom)?.step === "salary",
    "جلسة الحكومي تبقى على الراتب"
  );

  const retiredFrom = "966501110207@c.us";
  await openJobType(retiredFrom, "تمويل شخصي");
  const retired = mockMsg(retiredFrom, "متقاعد");
  await handleIncomingMessage(retired.msg);
  ok(
    retired.sent.texts.some((t) => String(t).includes("تم اختيار: متقاعد")),
    "المتقاعد يرى تنبيه العمر"
  );
  ok(
    retired.sent.texts.some((t) => String(t).includes("أرسل راتبك الشهري")),
    "المتقاعد يكمل لسؤال الراتب"
  );
  ok(
    sessionStore.getSession(retiredFrom)?.step === "salary",
    "جلسة المتقاعد تبقى مفتوحة"
  );

  for (const id of [
    militaryFrom,
    militaryIdFrom,
    digitFrom,
    privateFrom,
    privateIdFrom,
    govFrom,
    retiredFrom,
  ]) {
    sessionStore.clearSession(id);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
