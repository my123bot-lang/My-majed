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
      { id: "6", title: "إيقاف الرد الآلي" },
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
    buttons: [
      { id: "1", title: "عسكري" },
      { id: "2", title: "مدني" },
      { id: "3", title: "متقاعد" },
    ],
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
 * إذا زادت المبالغ نوزّعها مع الإبقاء على الأعلى والأدنى (حتى minLowerAmount=10000).
 */
function shrinkTiersForWhatsAppList(tiers, maxRows = 10) {
  const all = Array.isArray(tiers) ? tiers.filter((n) => Number(n) > 0) : [];
  if (all.length <= maxRows) return all;

  const last = all[all.length - 1];
  const stride = Math.ceil(all.length / maxRows);
  const out = [];
  for (let i = 0; i < all.length; i += stride) {
    out.push(all[i]);
  }
  if (out[out.length - 1] !== last) out.push(last);

  // إن بقي أكثر من الحد بسبب الإضافة، أعد التوزيع بالتساوي مع أول وآخر
  if (out.length > maxRows) {
    const evenly = [];
    const lastIdx = all.length - 1;
    for (let i = 0; i < maxRows - 1; i++) {
      const idx = Math.round((i * lastIdx) / (maxRows - 1));
      evenly.push(all[idx]);
    }
    evenly.push(all[lastIdx]);
    return [...new Set(evenly)].slice(0, maxRows);
  }

  return out;
}

function lowerAmountTiers(tiers) {
  const rows = shrinkTiersForWhatsAppList(tiers, 10).map((amount, i) => ({
    id: String(i + 1),
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
  jobType,
  jobTypeInvalid,
  realEstate,
  realEstateInvalid,
  applicationMethod,
  applicationMethodInvalid,
  lowerAmountTiers,
  shrinkTiersForWhatsAppList,
};
