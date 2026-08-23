/**
 * اختبار: كلمات بدء القائمة (مرحبا/هلا/السلام عليكم/1) تُطابق كبداية للرسالة
 * لا نصاً مطابقاً بالكامل — عميل جديد يرسل "السلام عليكم ورحمة الله وبركاته"
 * كان يُتجاهل تماماً بدون رد وبدون تسجيله في السجل. أيضاً نتحقق أن "1" يبقى
 * تطابقاً حرفياً كاملاً حتى لا يُفهم رقم طلب مثل 101234567 كأمر قائمة.
 */
const assert = require("assert");
const { matchesStartKeyword } = require("../lib/validators");

const KEYWORDS = ["مرحبا", "هلا", "السلام عليكم", "1"];

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

ok(
  matchesStartKeyword("السلام عليكم ورحمة الله وبركاته", KEYWORDS),
  "extended greeting with extra words matches"
);
ok(matchesStartKeyword("مرحبا كيفكم", KEYWORDS), "مرحبا + extra words matches");
ok(matchesStartKeyword("هلا وغلا", KEYWORDS), "هلا + extra words matches");
ok(matchesStartKeyword("السلام عليكم", KEYWORDS), "exact greeting still matches");
ok(matchesStartKeyword("1", KEYWORDS), "exact 1 still matches");
ok(!matchesStartKeyword("101234567", KEYWORDS), "order number starting with 1 does NOT match");
ok(!matchesStartKeyword("10", KEYWORDS), "short numeric starting with 1 does NOT match");
ok(!matchesStartKeyword("كيف الحال", KEYWORDS), "unrelated text does not match");
ok(!matchesStartKeyword("", KEYWORDS), "empty text does not match");

console.log("smoke-greeting-trigger: OK");
