/**
 * اختبار: كلمات بدء القائمة (مرحبا/هلا/1) تُطابق كبداية للرسالة
 * لا نصاً مطابقاً بالكامل — عميل جديد يرسل "مرحبا كيفكم"
 * كان يُتجاهل تماماً بدون رد وبدون تسجيله في السجل. أيضاً نتحقق أن "1" يبقى
 * تطابقاً حرفياً كاملاً حتى لا يُفهم رقم طلب مثل 101234567 كأمر قائمة.
 * «السلام عليكم» لم يعد كلمة بدء — لا يفتح القائمة.
 */
const assert = require("assert");
const { matchesStartKeyword } = require("../lib/validators");
const CONFIG = require("../config");
const sessionStore = require("../lib/session");
const { handleIncomingMessage } = require("../lib/handlers");

const KEYWORDS = CONFIG.session.menuStartKeywords;

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

ok(
  Array.isArray(KEYWORDS) && !KEYWORDS.includes("السلام عليكم"),
  "السلام عليكم is not a menu start keyword"
);
ok(matchesStartKeyword("مرحبا كيفكم", KEYWORDS), "مرحبا + extra words matches");
ok(matchesStartKeyword("هلا وغلا", KEYWORDS), "هلا + extra words matches");
ok(matchesStartKeyword("مرحبا", KEYWORDS), "exact مرحبا still matches");
ok(matchesStartKeyword("هلا", KEYWORDS), "exact هلا still matches");
ok(matchesStartKeyword("1", KEYWORDS), "exact 1 still matches");
ok(
  !matchesStartKeyword("السلام عليكم", KEYWORDS),
  "السلام عليكم does not open the menu"
);
ok(
  !matchesStartKeyword("السلام عليكم ورحمة الله وبركاته", KEYWORDS),
  "extended السلام عليكم does not open the menu"
);
ok(!matchesStartKeyword("101234567", KEYWORDS), "order number starting with 1 does NOT match");
ok(!matchesStartKeyword("10", KEYWORDS), "short numeric starting with 1 does NOT match");
ok(!matchesStartKeyword("كيف الحال", KEYWORDS), "unrelated text does not match");
ok(!matchesStartKeyword("", KEYWORDS), "empty text does not match");

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
  ok(salamHandled === false, "السلام عليكم لا يفتح القائمة");
  ok(salam.sent.menus.length === 0, "لا تُرسل قائمة بعد السلام عليكم");
  ok(!sessionStore.getSession(from), "لا تُفتح جلسة بعد السلام عليكم");

  const welcome = mockMsg(from, "مرحبا");
  const welcomeHandled = await handleIncomingMessage(welcome.msg);
  ok(welcomeHandled === true, "مرحبا يفتح القائمة");
  ok(welcome.sent.menus.length >= 1, "تُرسل القائمة بعد مرحبا");

  sessionStore.clearSession(from);
  sessionStore.startSession(from);
  const salamMid = mockMsg(from, "السلام عليكم");
  const salamMidHandled = await handleIncomingMessage(salamMid.msg);
  ok(
    salamMidHandled === false,
    "السلام عليكم أثناء الجلسة لا يعيد القائمة"
  );
  ok(salamMid.sent.menus.length === 0, "لا تُعاد القائمة بعد السلام عليكم وسط الجلسة");
  sessionStore.clearSession(from);

  console.log("smoke-greeting-trigger: OK");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
