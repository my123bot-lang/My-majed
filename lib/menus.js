/**
 * قوائم اختيارات واتساب — أزرار (≤3) أو قائمة (أكثر)
 * معرفات الأزرار أرقام/نصوص يفهمها validators.js كما هي
 */

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

function inquiryMain() {
  return {
    kind: "list",
    body: "مرحبا معاك ماجد.\n\nمانوع استفسارك؟",
    buttonText: "الخيارات",
    rows: [
      { id: "1", title: "تمويل شخصي" },
      { id: "2", title: "شراء مديونية" },
      { id: "3", title: "إيقاف خدمات" },
      { id: "4", title: "ساعات الدوام" },
      { id: "5", title: "موقعنا" },
      { id: "6", title: "خدمات مابعد البيع" },
    ],
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

function inquiryInvalid() {
  return {
    kind: "list",
    body: "الرجاء اختيار أحد الخيارات:",
    buttonText: "الخيارات",
    rows: inquiryMain().rows,
  };
}

function jobType() {
  return {
    kind: "buttons",
    body: "أي قطاع؟",
    // معرفات نصية — لا تُفسَّر كراتب إذا بقي الزر ظاهراً في واتساب
    buttons: [
      { id: "job_military", title: "عسكري" },
      { id: "job_civilian", title: "مدني" },
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
  const rows = (matches || []).slice(0, 10).map((name, i) => ({
    id: `co_${i + 1}`,
    title: String(name).slice(0, 24),
    description: String(name).slice(0, 72),
  }));
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
  inquiryMain,
  inquiryInvalid,
  afterSales,
  jobType,
  jobTypeInvalid,
  civilianSector,
  companyMatches,
  realEstate,
  realEstateInvalid,
  applicationMethod,
  applicationMethodInvalid,
  lowerAmountTiers,
  shrinkTiersForWhatsAppList,
};
