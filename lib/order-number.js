/**
 * رقم طلب العميل يبدأ دائماً بـ 101 (أرقام فقط)
 */
const { normalizeDigits } = require("./validators");

const ORDER_PREFIX = "101";
/** أرقام الطلب الفعلية 8 أرقام (101 + 5) — لا نعتبر 101525 راتباً طلباً */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;
/** غالبية أرقام الطلب في النظام (101 + 5 أرقام) */
const STANDARD_ORDER_DIGITS = 8;
/** بقايا أرقام ملتصقة بعد رقم الطلب (مثل نسخ من البوابة) */
const MIN_TRAILING_GROUP = 5;

function digitsOnly(value) {
  return normalizeDigits(String(value || "")).replace(/\D/g, "");
}

function prepareText(text) {
  return normalizeDigits(String(text || "").trim());
}

function isSaudiMobileDigits(digits) {
  const d = digitsOnly(digits);
  if (/^05\d{8}$/.test(d)) return true;
  if (/^9665\d{8}$/.test(d)) return true;
  return false;
}

/** رسالة فيها راتب/التزامات — لا نستخرج منها رقم طلب إلا بعبارة «رقم الطلب» */
function isSalaryOrAmountContext(text) {
  return /راتب|راتبي|مرتب|دخلي|دخل|خصم|التزام|التزامات|قسط|راتبك|salary|income/i.test(
    String(text || "")
  );
}

function hasExplicitOrderLabel(text) {
  return /رقم\s*الطلب|رقم\s*طلب|طلب\s*رقم|order|reference|ticket/i.test(
    String(text || "")
  );
}

function isValidOrderNumber(value) {
  const d = digitsOnly(value);
  if (!d.startsWith(ORDER_PREFIX)) return false;
  if (d.length < MIN_DIGITS || d.length > MAX_DIGITS) return false;
  if (isSaudiMobileDigits(d)) return false;
  return /^\d+$/.test(d);
}

function normalizeOrderNumber(value) {
  const d = digitsOnly(value);
  if (!isValidOrderNumber(d)) return null;
  return d;
}

function pickBest101Match(candidates) {
  const valid = [...new Set(candidates.filter(isValidOrderNumber))];
  if (!valid.length) return null;

  const standard = valid.filter((v) => v.length === STANDARD_ORDER_DIGITS);
  if (standard.length === 1) return standard[0];
  if (standard.length > 1) return standard.sort()[0];

  valid.sort((a, b) => a.length - b.length);
  return valid[0];
}

/** عند التصاق رقم ثانٍ بعد 10160533 مثل 3800124 نأخذ الثمانية أرقام فقط */
function pickOrderAtStart(allDigits, start) {
  const from = String(allDigits || "").slice(start);
  if (!from.startsWith(ORDER_PREFIX)) return null;

  const standard = from.slice(0, STANDARD_ORDER_DIGITS);
  if (isValidOrderNumber(standard)) {
    const remainder = from.slice(STANDARD_ORDER_DIGITS);
    if (
      remainder.length >= MIN_TRAILING_GROUP &&
      !remainder.startsWith(ORDER_PREFIX)
    ) {
      return standard;
    }
  }

  for (let len = MAX_DIGITS; len >= MIN_DIGITS; len--) {
    const slice = from.slice(0, len);
    if (isValidOrderNumber(slice)) return slice;
  }
  return null;
}

function extractLabeledOrderNumber(text, pattern) {
  const m = String(text || "").match(pattern);
  if (!m) return null;

  const chunk = String(m[1] || "").trim();
  const firstToken = digitsOnly(chunk.split(/\s+/)[0]);
  if (isValidOrderNumber(firstToken)) return firstToken;

  const fromChunk = find101NumbersInText(chunk);
  return pickBest101Match(fromChunk);
}

function find101NumbersInText(text) {
  const raw = String(text || "");
  const found = [];

  const spaced = raw.replace(/\s+/g, " ");
  const re = /\b101[\d\s\-]{2,18}\b/g;
  let m;
  while ((m = re.exec(spaced)) !== null) {
    const d = digitsOnly(m[0]);
    if (isValidOrderNumber(d)) found.push(d);
  }

  const allDigits = digitsOnly(raw);
  let idx = 0;
  while (idx < allDigits.length) {
    const start = allDigits.indexOf(ORDER_PREFIX, idx);
    if (start < 0) break;
    const picked = pickOrderAtStart(allDigits, start);
    if (picked) found.push(picked);
    idx = start + 1;
  }

  return found;
}

function extractOrderNumber(text) {
  const raw = prepareText(text);
  if (!raw || raw.length > 300) return null;

  const normalized = raw.replace(/\s+/g, " ");
  const salaryContext = isSalaryOrAmountContext(raw);

  const labeledAr = extractLabeledOrderNumber(
    normalized,
    /رقم\s*(?:ال)?طلب\s*[:：\-]?\s*(101[\d\s\-]{2,18})/i
  );
  if (labeledAr) return labeledAr;

  const labeledEn = extractLabeledOrderNumber(
    normalized,
    /(?:order|ref|reference|ticket|طلب)\s*[#:]?\s*(101[\d\s\-]{2,18})/i
  );
  if (labeledEn) return labeledEn;

  if (salaryContext) return null;

  const fromText = find101NumbersInText(raw);
  const best = pickBest101Match(fromText);
  if (best) return best;

  if (
    raw.length <= 40 &&
    !/[^\d\s\-]/.test(raw.replace(/[\d\s\-]/g, ""))
  ) {
    const compact = digitsOnly(raw);
    const fromCompact = pickOrderAtStart(compact, 0);
    if (fromCompact) return fromCompact;
  }

  return null;
}

/** رسالة يبدو أنها رقم طلب فقط (وليست بداية محادثة جديدة) */
function isLikelyOrderReply(text) {
  const t = String(text || "").trim();
  if (hasExplicitOrderLabel(t)) return Boolean(extractOrderNumber(text));

  if (isSalaryOrAmountContext(t)) return false;

  const orderNumber = extractOrderNumber(text);
  if (!orderNumber) return false;

  const d = digitsOnly(t);
  const nonNumeric = t.replace(/[\d\s\-]/g, "").trim();
  if (isValidOrderNumber(d) && t.length <= 60 && nonNumeric.length <= 8) {
    return true;
  }

  return false;
}

module.exports = {
  ORDER_PREFIX,
  extractOrderNumber,
  isLikelyOrderReply,
  isValidOrderNumber,
  normalizeOrderNumber,
  isSaudiMobileDigits,
};
