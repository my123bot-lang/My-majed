/**
 * سابقاً: كان العميل يستطيع إرسال stop/start لإيقاف/استئناف الرد الآلي على محادثته.
 * الآن: الإيقاف/التشغيل للمالك فقط (لوحة التحكم، قائمة المالك، رقم التحكم، أو رد يدوي).
 * تُبقى الدوال للتوافق مع الاستيرادات القديمة — لا تعالج أي أمر.
 */
const autoReplyControl = require("./auto-reply-control");

/**
 * @returns {'stop'|'start'|null}
 */
function parseCustomerChatControl(text) {
  const cmd = autoReplyControl.parseOwnerCommand(text);
  if (cmd === "stop" || cmd === "start") return cmd;
  return null;
}

/**
 * العملاء لا يتحكمون بالرد الآلي.
 * @returns {Promise<boolean>} دائماً false
 */
async function tryHandleCustomerChatControl(_msg) {
  return false;
}

module.exports = {
  parseCustomerChatControl,
  tryHandleCustomerChatControl,
};
