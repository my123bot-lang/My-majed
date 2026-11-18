/**
 * العسكري يكمل لسؤال الراتب، والقطاع الخاص يبحث عن الشركة المعتمدة.
 * الحكومي والمتقاعد يكملان لسؤال الراتب.
 */
const assert = require("assert");
const sessionStore = require("../lib/session");
const { handleIncomingMessage } = require("../lib/handlers");

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
  const opening = mockMsg(from, inquiryText);
  const handled = await handleIncomingMessage(opening.msg);
  ok(handled === true, `${inquiryText} ينتقل لسؤال القطاع`);
  ok(
    sessionStore.getSession(from)?.step === "job_type",
    `بعد ${inquiryText} الخطوة هي نوع القطاع`
  );
}

function asksSalary(sent) {
  return sent.texts.some((t) => String(t).includes("أرسل راتبك الشهري"));
}

function asksCompany(sent) {
  return sent.texts.some((t) => String(t).includes("اسم الشركة"));
}

(async () => {
  const militaryFrom = "966501110201@c.us";
  await openJobType(militaryFrom, "تمويل شخصي");
  const military = mockMsg(militaryFrom, "عسكري");
  ok(
    (await handleIncomingMessage(military.msg)) === true,
    "اختيار عسكري يُعالَج"
  );
  ok(asksSalary(military.sent), "العسكري يكمل لسؤال الراتب");
  ok(
    !military.sent.texts.some((t) => String(t).includes("غير متاح")),
    "لا يُرسل اعتذار إيقاف للعسكري"
  );
  ok(
    sessionStore.getSession(militaryFrom)?.step === "salary",
    "جلسة العسكري تبقى على الراتب"
  );
  ok(
    sessionStore.getSession(militaryFrom)?.jobCategory === "military",
    "جلسة العسكري تحفظ القطاع"
  );

  const militaryIdFrom = "966501110202@c.us";
  await openJobType(militaryIdFrom, "شراء مديونية");
  const militaryId = mockMsg(militaryIdFrom, "", {
    selectedButtonId: "job_military",
  });
  ok(
    (await handleIncomingMessage(militaryId.msg)) === true,
    "زر عسكري في شراء المديونية يُعالَج"
  );
  ok(asksSalary(militaryId.sent), "العسكري في شراء المديونية يكمل للراتب");
  ok(
    sessionStore.getSession(militaryIdFrom)?.step === "salary",
    "جلسة المديونية العسكرية تبقى على الراتب"
  );

  const digitFrom = "966501110203@c.us";
  await openJobType(digitFrom, "تمويل شخصي");
  const digit = mockMsg(digitFrom, "2");
  await handleIncomingMessage(digit.msg);
  ok(asksSalary(digit.sent), "رقم 2 في سؤال القطاع = عسكري ويكمل للراتب");
  ok(
    sessionStore.getSession(digitFrom)?.jobCategory === "military",
    "رقم 2 يحفظ القطاع العسكري"
  );

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
  ok(asksCompany(privateChoice.sent), "القطاع الخاص يُطلب منه اسم الشركة");
  ok(
    !privateChoice.sent.texts.some((t) => String(t).includes("غير متاح")),
    "لا يُرسل اعتذار إيقاف للقطاع الخاص"
  );
  ok(
    sessionStore.getSession(privateFrom)?.step === "company_search",
    "جلسة القطاع الخاص تبقى على البحث عن الشركة"
  );
  ok(
    sessionStore.getSession(privateFrom)?.civilianSector === "private",
    "جلسة القطاع الخاص تحفظ الجهة"
  );

  const privateIdFrom = "966501110205@c.us";
  await openJobType(privateIdFrom, "شراء مديونية");
  await handleIncomingMessage(mockMsg(privateIdFrom, "1").msg);
  const privateId = mockMsg(privateIdFrom, "", {
    selectedButtonId: "civ_private",
  });
  await handleIncomingMessage(privateId.msg);
  ok(
    asksCompany(privateId.sent),
    "زر قطاع خاص في شراء المديونية يطلب اسم الشركة"
  );
  ok(
    sessionStore.getSession(privateIdFrom)?.step === "company_search",
    "جلسة الخاص في المديونية تبقى على البحث عن الشركة"
  );

  const govFrom = "966501110206@c.us";
  await openJobType(govFrom, "تمويل شخصي");
  await handleIncomingMessage(mockMsg(govFrom, "مدني").msg);
  const gov = mockMsg(govFrom, "حكومي");
  ok((await handleIncomingMessage(gov.msg)) === true, "اختيار حكومي يُعالَج");
  ok(asksSalary(gov.sent), "القطاع الحكومي يكمل لسؤال الراتب");
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
  ok(asksSalary(retired.sent), "المتقاعد يكمل لسؤال الراتب");
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
