/**
 * اختبار: كلمات بدء القائمة (مرحبا/هلا/السلام عليكم/1) تُطابق كبداية للرسالة
 * لا نصاً مطابقاً بالكامل — عميل جديد يرسل "مرحبا كيفكم" أو "السلام عليكم"
 * كان يُتجاهل تماماً بدون رد. «1» يبقى تطابقاً حرفياً كاملاً حتى لا يُفهم
 * رقم طلب مثل 101234567 كأمر قائمة.
 * «السلام عليكم» يفتح القائمة لعميل جديد فقط — لا يعيد ضبط الحسبة وسط الجلسة.
 */
const assert = require("assert");
const { matchesStartKeyword, isPoliteGreeting } = require("../lib/validators");
const CONFIG = require("../config");
const sessionStore = require("../lib/session");
const { handleIncomingMessage } = require("../lib/handlers");

const KEYWORDS = CONFIG.session.menuStartKeywords;
const RESTART = CONFIG.session.restartKeywords;

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

ok(
  Array.isArray(KEYWORDS) && KEYWORDS.includes("السلام عليكم"),
  "السلام عليكم is a menu start keyword for new customers"
);
ok(
  Array.isArray(RESTART) && !RESTART.includes("السلام عليكم"),
  "السلام عليكم is not a mid-session restart keyword"
);
ok(matchesStartKeyword("مرحبا كيفكم", KEYWORDS), "مرحبا + extra words matches");
ok(matchesStartKeyword("هلا وغلا", KEYWORDS), "هلا + extra words matches");
ok(matchesStartKeyword("مرحبا", KEYWORDS), "exact مرحبا still matches");
ok(matchesStartKeyword("هلا", KEYWORDS), "exact هلا still matches");
ok(matchesStartKeyword("1", KEYWORDS), "exact 1 still matches");
ok(
  matchesStartKeyword("السلام عليكم", KEYWORDS),
  "السلام عليكم opens the menu for a new customer"
);
ok(
  matchesStartKeyword("السلام عليكم ورحمة الله وبركاته", KEYWORDS),
  "extended السلام عليكم opens the menu for a new customer"
);
ok(isPoliteGreeting("السلام عليكم"), "isPoliteGreeting: السلام عليكم");
ok(isPoliteGreeting("أهلا"), "isPoliteGreeting: أهلا");
ok(!isPoliteGreeting("1"), "isPoliteGreeting does not treat 1 as a greeting");
ok(!matchesStartKeyword("101234567", KEYWORDS), "order number starting with 1 does NOT match");
ok(!matchesStartKeyword("10", KEYWORDS), "short numeric starting with 1 does NOT match");
ok(!matchesStartKeyword("كيف الحال", KEYWORDS), "unrelated text does not match");
ok(!matchesStartKeyword("", KEYWORDS), "empty text does not match");
ok(
  isPoliteGreeting("\u200Fسلام عليكم"),
  "leading RTL mark still matches سلام عليكم"
);
ok(
  matchesStartKeyword("\u200Fهلا", KEYWORDS),
  "leading RTL mark still matches هلا"
);
ok(matchesStartKeyword("\u200E1", KEYWORDS), "leading LTR mark still matches 1");
ok(matchesStartKeyword("هَلا", KEYWORDS), "diacritics still match هلا");
ok(matchesStartKeyword("مرحباً", KEYWORDS), "tanween still matches مرحبا");
ok(
  isPoliteGreeting("سلام  عليكم"),
  "extra spaces still match سلام عليكم"
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
  const from = "966501110001@c.us";
  sessionStore.clearSession(from);

  const salam = mockMsg(from, "السلام عليكم");
  const salamHandled = await handleIncomingMessage(salam.msg);
  ok(salamHandled === true, "السلام عليكم يفتح القائمة لعميل جديد");
  ok(salam.sent.menus.length >= 1, "تُرسل القائمة بعد السلام عليكم");
  ok(sessionStore.getSession(from), "تُفتح جلسة بعد السلام عليكم");

  sessionStore.clearSession(from);
  const welcome = mockMsg(from, "مرحبا");
  const welcomeHandled = await handleIncomingMessage(welcome.msg);
  ok(welcomeHandled === true, "مرحبا يفتح القائمة");
  ok(welcome.sent.menus.length >= 1, "تُرسل القائمة بعد مرحبا");

  sessionStore.clearSession(from);
  sessionStore.startSession(from);
  const session = sessionStore.getSession(from);
  session.step = "salary";
  session.jobCategory = "civilian";
  const salamMid = mockMsg(from, "السلام عليكم");
  const salamMidHandled = await handleIncomingMessage(salamMid.msg);
  ok(salamMidHandled === true, "السلام عليكم أثناء سؤال الراتب لا يُتجاهل");
  ok(
    sessionStore.getSession(from)?.step === "salary",
    "السلام عليكم وسط الحسبة لا يعيد القائمة الرئيسية"
  );
  ok(
    !salamMid.sent.menus.some((m) => String(m.body || "").includes("مانوع استفسارك")),
    "لا تُعاد القائمة الرئيسية بعد السلام عليكم وسط الحسبة"
  );
  sessionStore.clearSession(from);

  sessionStore.startSession(from);
  const atMenu = mockMsg(from, "السلام عليكم ورحمة الله");
  const atMenuHandled = await handleIncomingMessage(atMenu.msg);
  ok(atMenuHandled === true, "السلام عليكم على القائمة الرئيسية يعيد عرضها");
  ok(atMenu.sent.menus.length >= 1, "تُعاد القائمة إذا كان العميل على السؤال الأول");
  sessionStore.clearSession(from);

  const markedFrom = "966501110002@c.us";
  sessionStore.clearSession(markedFrom);
  const marked = mockMsg(markedFrom, "\u200Fسلام عليكم");
  const markedHandled = await handleIncomingMessage(marked.msg);
  ok(markedHandled === true, "سلام عليكم بعلامة اتجاه خفية يفتح القائمة");
  ok(marked.sent.menus.length >= 1, "تُرسل القائمة رغم علامة الاتجاه");
  sessionStore.clearSession(markedFrom);

  const burstFrom = "966501110003@c.us";
  sessionStore.clearSession(burstFrom);
  ok(
    sessionStore.shouldThrottle(burstFrom, "من طرف ابو تركي") === false,
    "الرسالة المعاد توجيهها تُعالج أولاً"
  );
  ok(
    sessionStore.shouldThrottle(burstFrom, "\u200Fهلا") === false,
    "هلا بعد رسالة معاد توجيهها لا تُحظر خلال ثانية"
  );
  ok(
    sessionStore.shouldThrottle(burstFrom, "مرحبا") === true,
    "كلمة بدء ثانية في نفس اللحظة تُحظر حتى لا تتكرر القائمة"
  );
  sessionStore.clearSession(burstFrom);

  console.log("smoke-greeting-trigger: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
