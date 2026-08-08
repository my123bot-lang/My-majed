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
  const normalized = normalizeDigits(String(text || ""))
    .replace(/,/g, "")
    .trim();

  // دعم جمع بسيط: 4200+500 → 4700 (بدل دمجها كـ 4200500)
  const sumExpr = normalized.replace(/\s+/g, "");
  if (/^\d+(\+\d+)+$/.test(sumExpr)) {
    return sumExpr.split("+").reduce((sum, part) => sum + Number(part), 0);
  }

  const cleaned = normalized.replace(/[^\d.]/g, "");
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
    text === "خدمات مابعد البيع" ||
    text === "خدمات بعد البيع" ||
    text.includes("مابعد البيع") ||
    text.includes("بعد البيع") ||
    text.includes("خدمات مابعد") ||
    text.includes("خدمات بعد")
  ) {
    return "after_sales";
  }
  if (
    text === "owner_pause_reply" ||
    text.includes("إيقاف الرد") ||
    text.includes("ايقاف الرد") ||
    text.includes("ايقاف الرد الالي") ||
    text.includes("إيقاف الرد الآلي")
  ) {
    return "pause_auto_reply";
  }
  if (
    text === "owner_resume_reply" ||
    text.includes("تشغيل الرد الآلي") ||
    text.includes("تشغيل الرد الالي") ||
    text === "تشغيل الرد"
  ) {
    return "resume_auto_reply";
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
  // لا نطابق «موقع» وحدها حتى لا تُسرق أسئلة مثل «وين موقعكم؟» من الذكاء الاصطناعي
  if (text === "5" || text === "موقعنا" || text.includes("موقعنا")) {
    return "location";
  }
  return null;
}

/** @deprecated استخدم parseInquiryType */
function parseFinanceType(text) {
  return parseInquiryType(text);
}

function parseCivilianSector(text) {
  const t = normalizeText(text).toLowerCase();
  if (
    t === "1" ||
    t === "civ_gov" ||
    t === "government" ||
    t.includes("حكومي") ||
    t.includes("حكوميه") ||
    t.includes("حكومية")
  ) {
    return "government";
  }
  if (
    t === "2" ||
    t === "civ_private" ||
    t === "private" ||
    t.includes("قطاع خاص") ||
    t.includes("خاص")
  ) {
    return "private";
  }
  return null;
}

/** خدمات بعد البيع — سداد مبكر / تحصيل / شكوى */
function parseAfterSalesChoice(text) {
  const t = normalizeText(text).toLowerCase();
  if (t === "1" || t === "after_early" || t.includes("سداد مبكر")) {
    return "early_payoff";
  }
  if (
    t === "2" ||
    t === "after_collection" ||
    t.includes("تحصيل") ||
    t.includes("مشكلة بالتحصيل")
  ) {
    return "collection_issue";
  }
  if (
    t === "3" ||
    t === "after_complaint" ||
    t.includes("شكاوى") ||
    t.includes("شكوى") ||
    t.includes("شكوي")
  ) {
    return "complaint";
  }
  return null;
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
  // ترتيب الأزرار الحالي: 1 مدني، 2 عسكري، 3 متقاعد
  if (t === "1") return "civilian";
  if (t === "2") return "military";
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
  parseAfterSalesChoice,
  parseCivilianSector,
  parseJobType,
  isValidNumberInput,
  isElectronicApplication,
  isBranchVisit,
  parseNumberedOption,
  isMenuStyleReply,
};
