/**
 * قوائم اختيارات واتساب — أزرار (≤3) أو قائمة (أكثر)
 * معرفات الأزرار أرقام/نصوص يفهمها validators.js كما هي
 */
const CONFIG = require("../config");

function formatSalaryAmount(n) {
  return Number(n).toLocaleString("en-US");
}

function salaryPolicyMinAmounts() {
  const mins = CONFIG.limits?.minSalaryByCategory || {};
  return {
    civilian: Number(mins.civilian) || 4000,
    retired: Number(mins.retired) || 4000,
    military: Number(mins.military) || 10000,
  };
}

function yesNo(body) {
  return {
    kind: "buttons",
    body,
    buttons: [
      { id: "1", title: "نعم" },
      { id: "2", title: "لا" },
    ],
  };
}

/** أزرار واضحة للمالك فقط داخل محادثة واتساب — لا يراها العميل */
function ownerAutoReplyControls() {
  return {
    kind: "buttons",
    body:
      "تحكم الرد الآلي (هذه الأزرار لك فقط داخل واتساب):\n" +
      "إيقاف = آخر عميل راسل البوت",
    buttons: [
      { id: "owner_pause_reply", title: "إيقاف الرد الآلي" },
      { id: "owner_resume_reply", title: "تشغيل الرد الآلي" },
    ],
  };
}

/**
 * @param {{ ownerControls?: boolean }} [options]
 * ownerControls=true يضيف خيارات إيقاف/تشغيل الرد الآلي — لأرقام التحكم فقط
 */
function inquiryMain(options = {}) {
  const rows = [
    { id: "1", title: "تمويل شخصي" },
    { id: "2", title: "شراء مديونية" },
    { id: "3", title: "إيقاف خدمات" },
    { id: "4", title: "ساعات الدوام" },
    { id: "5", title: "موقعنا" },
    { id: "6", title: "خدمات مابعد البيع" },
    {
      id: "7",
      title: "سياسة الرواتب المطلوبة",
      buttonTitle: "سياسة الرواتب",
      description: "أقل راتب للصراف حسب القطاع",
    },
  ];
  if (options.ownerControls) {
    // في أعلى القائمة حتى لا تُخفى تحت الخيارات
    rows.unshift(
      { id: "owner_pause_reply", title: "إيقاف الرد الآلي" },
      { id: "owner_resume_reply", title: "تشغيل الرد الآلي" }
    );
  }
  return {
    kind: "list",
    body: options.ownerControls
      ? "وعليكم السلام ورحمه الله وبركاته\n\nمرحبا معك ماجد.\nمانوع استفسارك؟\n\n(من قائمتك فقط: إيقاف/تشغيل الرد الآلي — العميل لا يراها)"
      : "وعليكم السلام ورحمه الله وبركاته\n\nمرحبا معك ماجد.\nمانوع استفسارك؟",
    buttonText: "الخيارات",
    rows,
  };
}

/**
 * بعد اختيار «سياسة الرواتب المطلوبة» — قائمة القطاعات والحد الأدنى.
 * 3 بنود تُعرض كأزرار مباشرة حتى تظهر المبالغ بدون فتح قائمة إضافية.
 */
function salaryPolicy() {
  const mins = salaryPolicyMinAmounts();
  const civilian = formatSalaryAmount(mins.civilian);
  const retired = formatSalaryAmount(mins.retired);
  const military = formatSalaryAmount(mins.military);
  return {
    kind: "buttons",
    body:
      "أقل راتب ينزل في الصراف إيداع راتب\n\n" +
      `* ${civilian} ريال للمدني\n` +
      `* ${retired} ريال للمتقاعد\n` +
      `* ${military} ريال للعسكري\n\n` +
      "ملاحظة: أقل مما ذُكر يتم رفضه.",
    buttons: [
      { id: "sal_civilian", title: `مدني ${civilian} ريال` },
      { id: "sal_retired", title: `متقاعد ${retired} ريال` },
      { id: "sal_military", title: `عسكري ${military} ريال` },
    ],
  };
}

function salaryPolicyInvalid() {
  return {
    kind: "buttons",
    body:
      "الرجاء اختيار القطاع من القائمة:\n\n" + salaryPolicy().body,
    buttons: salaryPolicy().buttons,
  };
}

function afterSales() {
  return {
    kind: "buttons",
    body: "خدمات مابعد البيع\n\nاختر نوع الطلب:",
    buttons: [
      { id: "after_early", title: "سداد مبكر" },
      { id: "after_collection", title: "مشكلة بالتحصيل" },
      { id: "after_complaint", title: "شكاوى" },
    ],
  };
}

/**
 * @param {{ ownerControls?: boolean }} [options]
 */
function inquiryInvalid(options = {}) {
  return {
    kind: "list",
    body: "الرجاء اختيار أحد الخيارات:",
    buttonText: "الخيارات",
    rows: inquiryMain(options).rows,
  };
}

function jobType() {
  return {
    kind: "buttons",
    body: "أي قطاع؟",
    // معرفات نصية — لا تُفسَّر كراتب إذا بقي الزر ظاهراً في واتساب
    buttons: [
      { id: "job_civilian", title: "مدني" },
      { id: "job_military", title: "عسكري" },
      { id: "job_retired", title: "متقاعد" },
    ],
  };
}

function civilianSector() {
  return {
    kind: "buttons",
    body: "اختر نوع الجهة:",
    buttons: [
      { id: "civ_gov", title: "حكومي" },
      { id: "civ_private", title: "قطاع خاص" },
    ],
  };
}

function companyMatches(matches) {
  // صف أخير لإعادة البحث — حد واتساب 10 صفوف
  const rows = (matches || []).slice(0, 9).map((name, i) => ({
    id: `co_${i + 1}`,
    title: String(name).slice(0, 24),
  }));
  rows.push({
    id: "co_research",
    title: "إعادة البحث",
    description: "البحث مجدداً عن جهة العمل",
  });
  return {
    kind: "list",
    body: "اختر الشركة من النتائج:",
    buttonText: "الشركات",
    rows,
  };
}

function jobTypeInvalid() {
  return {
    kind: "buttons",
    body: "الرجاء اختيار القطاع:",
    buttons: jobType().buttons,
  };
}

function realEstate() {
  return {
    kind: "list",
    body: "هل لديك تمويل عقاري؟",
    buttonText: "الخيارات",
    rows: [
      { id: "1", title: "عقاري مدعوم" },
      { id: "2", title: "عقاري غير مدعوم" },
      { id: "3", title: "لا يوجد عقاري" },
      { id: "4", title: "قديم قسط 1667" },
    ],
  };
}

function realEstateInvalid() {
  return {
    kind: "list",
    body: "الرجاء اختيار نوع التمويل العقاري:",
    buttonText: "الخيارات",
    rows: realEstate().rows,
  };
}

function loanTermYears(years = [1, 2, 3, 4, 5], body = "اختر عدد السنوات:") {
  const labels = {
    1: "سنة",
    2: "سنتين",
    3: "3 سنوات",
    4: "4 سنوات",
    5: "5 سنوات",
  };
  const rows = (years || [1, 2, 3, 4, 5]).map((year) => ({
    id: String(year),
    title: labels[year] || `${year} سنوات`,
  }));
  return {
    kind: "list",
    body,
    buttonText: "السنوات",
    rows,
  };
}

function loanTermYearsInvalid(years) {
  return loanTermYears(years, "الرجاء اختيار عدد السنوات من 1 إلى 5:");
}

/** قائمة السنوات المسموحة حسب الالتزامات */
function loanTermYearsAllowed(years) {
  return loanTermYears(years, "المدة المسموحة لك — اختر عدد السنوات:");
}

function loanTermYearsAllowedInvalid(years) {
  return loanTermYears(years, "الرجاء اختيار مدة من السنوات المسموحة لك:");
}

function applicationMethod() {
  return {
    kind: "buttons",
    body: "هل ترغب بالتقديم؟",
    buttons: [
      { id: "1", title: "إلكتروني" },
      { id: "2", title: "زيارة فرع" },
    ],
  };
}

function applicationMethodInvalid() {
  return {
    kind: "buttons",
    body: "الرجاء اختيار طريقة التقديم:",
    buttons: applicationMethod().buttons,
  };
}

/**
 * واتساب InteractiveList حدها 10 صفوف.
 * نوزّع المبالغ مع الإبقاء على الأعلى + 15,000 + 10,000 عند توفرها.
 */
function shrinkTiersForWhatsAppList(tiers, maxRows = 10) {
  const all = Array.isArray(tiers) ? tiers.filter((n) => Number(n) > 0) : [];
  if (all.length <= maxRows) return all;

  const first = all[0];
  const mustKeep = [15000, 10000].filter((n) => all.includes(n));
  const reserved = new Set([first, ...mustKeep]);
  const middle = all.filter((n) => !reserved.has(n));
  const slots = Math.max(0, maxRows - reserved.size);

  const picked = [];
  if (slots > 0 && middle.length) {
    if (middle.length <= slots) {
      picked.push(...middle);
    } else {
      const stride = Math.ceil(middle.length / slots);
      for (let i = 0; i < middle.length && picked.length < slots; i += stride) {
        picked.push(middle[i]);
      }
    }
  }

  const out = [first, ...picked, ...mustKeep];
  // إزالة تكرار مع الحفاظ على ترتيب تنازلي
  const seen = new Set();
  return out
    .filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .sort((a, b) => b - a)
    .slice(0, maxRows);
}

function lowerAmountTiers(tiers) {
  // id = المبلغ نفسه حتى لو وصل العنوان «15,000» أو المعرف يُطابق نفس القيمة
  const rows = shrinkTiersForWhatsAppList(tiers, 10).map((amount) => ({
    id: String(amount),
    title: String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
  }));
  return {
    kind: "list",
    body: "اختر المبلغ المناسب:",
    buttonText: "المبالغ",
    rows,
  };
}

module.exports = {
  yesNo,
  ownerAutoReplyControls,
  inquiryMain,
  inquiryInvalid,
  salaryPolicy,
  salaryPolicyInvalid,
  salaryPolicyMinAmounts,
  afterSales,
  jobType,
  jobTypeInvalid,
  civilianSector,
  companyMatches,
  realEstate,
  realEstateInvalid,
  loanTermYears,
  loanTermYearsInvalid,
  loanTermYearsAllowed,
  loanTermYearsAllowedInvalid,
  applicationMethod,
  applicationMethodInvalid,
  lowerAmountTiers,
  shrinkTiersForWhatsAppList,
};
