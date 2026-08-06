/**
 * تحقق من المدخلات وتحليل الإجابات — بدون تغيير شروط القبول هنا.
 */

/** تحويل ٠١٢٣ / ۰۱۲۳ إلى 0123 */
function normalizeDigits(text) {
  return String(text || "")
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

function normalizeText(text) {
  return normalizeDigits(String(text || "").trim());
}

/** استخراج رقم من نص العميل (يدعم فاصلة آلاف والأرقام العربية) */
function cleanNumber(text) {
  const cleaned = normalizeDigits(String(text || ""))
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");
  return Number(cleaned);
}

function isYes(text) {
  return (
    text === "1" ||
    text.includes("نعم") ||
    text.includes("ايه") ||
    text.includes("أيه")
  );
}

function isNo(text) {
  return text === "2" || text.includes("لا");
}

/**
 * تحليل خيار التمويل العقاري.
 * حماية: "غير مدعوم" لا تُحتسب "مدعوم" — يُفحص عدم وجود "غير" قبل اعتبار "مدعوم".
 */
function parseRealEstateChoice(text) {
  if (
    text === "4" ||
    text.includes("قديم") ||
    text.includes("1667")
  ) {
    return "old";
  }

  if (text === "1" || (text.includes("مدعوم") && !text.includes("غير"))) {
    return "supported";
  }

  if (text === "2" || text.includes("غير مدعوم")) {
    return "unsupported";
  }

  if (
    text === "3" ||
    text.includes("لا يوجد") ||
    text.includes("لايوجد") ||
    text.includes("ما عندي") ||
    text.includes("ماعندي")
  ) {
    return "none";
  }

  return null;
}

/**
 * القائمة الرئيسية — 7 خيارات (الخطوة inquiry_type فقط).
 */
function parseInquiryType(text) {
  if (text === "1" || text.includes("تمويل شخصي") || text === "شخصي") {
    return "personal";
  }
  if (text === "2" || text.includes("مديونية") || text.includes("شراء مديونية")) {
    return "debt_purchase";
  }
  if (
    text === "6" ||
    text.includes("إيقاف الرد") ||
    text.includes("ايقاف الرد") ||
    text.includes("ايقاف الرد الالي") ||
    text.includes("إيقاف الرد الآلي")
  ) {
    return "pause_auto_reply";
  }
  if (
    text === "7" ||
    text.includes("رقم المساعد") ||
    text.includes("المساعد") ||
    text.includes("مساعد")
  ) {
    return "assistant_contact";
  }
  if (
    text === "3" ||
    text.includes("إيقاف خدمات") ||
    text.includes("ايقاف خدمات") ||
    text.includes("تعثر")
  ) {
    return "service_stop";
  }
  if (
    text === "4" ||
    text.includes("ساعات") ||
    text.includes("دوام") ||
    text.includes("وقت الدوام")
  ) {
    return "hours";
  }
  if (text === "5" || text.includes("موقعنا") || text.includes("موقع")) {
    return "location";
  }
  return null;
}

/** @deprecated استخدم parseInquiryType */
function parseFinanceType(text) {
  return parseInquiryType(text);
}

function parseJobType(text) {
  const t = normalizeText(text).toLowerCase();
  // الأسماء أولاً حتى لا يختلط زر «مدني» مع رقم راتب لاحقاً
  if (
    t === "job_military" ||
    t === "military" ||
    t.includes("عسكري") ||
    t.includes("عسكر")
  ) {
    return "military";
  }
  if (t === "job_retired" || t === "retired" || t.includes("متقاعد")) {
    return "retired";
  }
  if (t === "job_civilian" || t === "civilian" || t.includes("مدني")) {
    return "civilian";
  }
  // توافق مع الأزرار الرقمية القديمة إن بقيت في الشاشة
  if (t === "1") return "military";
  if (t === "2") return "civilian";
  if (t === "3") return "retired";
  return null;
}

function isValidNumberInput(value) {
  return !Number.isNaN(value) && value !== null && value !== undefined;
}

function isElectronicApplication(text) {
  return (
    text === "1" ||
    text.includes("الكتروني") ||
    text.includes("إلكتروني")
  );
}

function isBranchVisit(text) {
  return (
    text === "2" ||
    text.includes("فرع") ||
    text.includes("زيارة") ||
    text.includes("حضور")
  );
}

/** اختيار رقم من قائمة (1 إلى max) */
function parseNumberedOption(text, max) {
  const n = parseInt(String(text).trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > max) return null;
  return n;
}

/** اختيار رقم من قائمة — قد يتكرر (1 ثم 1) في خطوات مختلفة */
function isMenuStyleReply(text) {
  const t = normalizeText(text).trim();
  if (/^[1-9]$/.test(t)) return true;
  if (t === "نعم" || t === "لا") return true;
  return false;
}

module.exports = {
  normalizeDigits,
  normalizeText,
  cleanNumber,
  isYes,
  isNo,
  parseRealEstateChoice,
  parseInquiryType,
  parseFinanceType,
  parseJobType,
  isValidNumberInput,
  isElectronicApplication,
  isBranchVisit,
  parseNumberedOption,
  isMenuStyleReply,
};
