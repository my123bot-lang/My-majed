/**
 * رسائل الترحيب والقائمة حسب جوال واتساب
 * أرقام وأسماء التواصل تُدار من lib/settings-store.js
 */
const { getCurrentWaAccountId } = require("./current-wa-account");

const START_MESSAGE_BY_WA_ACCOUNT = {
  majed: `مرحبا معاك ماجد .

مانوع استفسارك؟

1- تمويل شخصي
2- شراء مديونية
3- عليك إيقاف خدمات وتبي الحل
4- ساعات ووقت الدوام الرسمي
5- موقعنا
6- خدمات بعد البيع`,
};

const INVALID_INQUIRY_BY_WA_ACCOUNT = {
  majed: `الرجاء الرد على السؤال بالشكل الصحيح.

اكتب رقم الخيار أو نص الإجابة:

1- تمويل شخصي
2- شراء مديونية
3- عليك إيقاف خدمات وتبي الحل
4- ساعات ووقت الدوام الرسمي
5- موقعنا
6- خدمات بعد البيع`,
};

function getStartMessageForAccount(defaultStart) {
  const waId = getCurrentWaAccountId();
  if (waId && START_MESSAGE_BY_WA_ACCOUNT[waId]) {
    return START_MESSAGE_BY_WA_ACCOUNT[waId];
  }
  return defaultStart;
}

function getInvalidInquiryMessageForAccount(defaultInvalid) {
  const waId = getCurrentWaAccountId();
  if (waId && INVALID_INQUIRY_BY_WA_ACCOUNT[waId]) {
    return INVALID_INQUIRY_BY_WA_ACCOUNT[waId];
  }
  return defaultInvalid;
}

/** خيار 7 — رقم المساعد (معطّل على ماجد) */
const NO_ASSISTANT_CONTACT_ACCOUNTS = new Set(["majed"]);

function allowsAssistantContact() {
  return !NO_ASSISTANT_CONTACT_ACCOUNTS.has(getCurrentWaAccountId());
}

module.exports = {
  START_MESSAGE_BY_WA_ACCOUNT,
  INVALID_INQUIRY_BY_WA_ACCOUNT,
  getStartMessageForAccount,
  getInvalidInquiryMessageForAccount,
  allowsAssistantContact,
};
