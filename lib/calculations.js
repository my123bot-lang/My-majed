/**
 * معادلات التمويل الشخصي — قيم النسب والمعاملات من config.js فقط.
 *
 * ملاحظة مهمة (سلوك محفوظ):
 * - فحص الحد الأدنى للراتب حسب القطاع (minSalaryByCategory) على الراتب بعد خصم بدل النائية.
 * - الدعم الشهري يُضاف إلى الدخل فقط عند realEstateType === "supported".
 */
const CONFIG = require("../config");

const { ratios, multiplier, divisor } = CONFIG.calculation;

/**
 * @param {"supported"|"unsupported"|"none"|"old"} realEstateType
 * @param {number} salary الراتب الأساسي
 * @param {number} commitments
 * @param {number} [supportAmount=0]
 * @returns {number} المبلغ التقديري مقرباً
 */
function calculateEstimatedAmount(
  realEstateType,
  salary,
  commitments,
  supportAmount = 0
) {
  let ratio = ratios.none;
  let income = salary;

  if (realEstateType === "supported") {
    ratio = ratios.supported;
    income = salary + supportAmount;
  } else if (realEstateType === "unsupported" || realEstateType === "old") {
    ratio = ratios.unsupported;
  }

  return Math.round((((income * ratio) - commitments) * multiplier) / divisor);
}

/**
 * @param {number} amount
 * @returns {boolean}
 */
function meetsMinimumEstimatedAmount(amount) {
  return amount >= CONFIG.limits.minEstimatedAmount;
}

/**
 * @param {number} salary الراتب الأساسي (بدون دعم)
 * @returns {boolean}
 */
function getMinSalaryForCategory(jobCategory) {
  const byCategory = CONFIG.limits.minSalaryByCategory;
  if (jobCategory && byCategory && byCategory[jobCategory] != null) {
    return byCategory[jobCategory];
  }
  return CONFIG.limits.minSalary;
}

function meetsMinimumSalary(salary, jobCategory) {
  return Number(salary) >= getMinSalaryForCategory(jobCategory);
}

/** أقل راتب لدخول المحادثة — عسكري 7,000 (مسار العرض العقاري+شخصي)، باقي القطاعات حسب minSalaryByCategory */
function getMinSalaryForEntry(jobCategory) {
  if (jobCategory === "military") {
    return (
      CONFIG.comboPackage?.minSalary ??
      CONFIG.limits.comboMinSalary ??
      7000
    );
  }
  return getMinSalaryForCategory(jobCategory);
}

function meetsMinimumSalaryForEntry(salary, jobCategory) {
  return Number(salary) >= getMinSalaryForEntry(jobCategory);
}

function getMilitaryGrossSalary(session) {
  return Number(session.grossSalary ?? session.salary);
}

/** راتب العسكري بعد خصم بدل المناطق النائية (يُستخدم في الشروط والحسبة) */
function getMilitaryEffectiveSalary(session) {
  if (!session) return 0;
  if (session.grossSalary != null && session.grossSalary !== undefined) {
    return Number(
      session.salary ??
        getEffectiveSalary(session.grossSalary, session.remoteAllowance)
    );
  }
  return Number(session.salary ?? 0);
}

/** عسكري — الراتب الفعلي بعد البدل أقل من 10,000 */
function isMilitaryBelowPersonalMinSalary(session) {
  return (
    session?.jobCategory === "military" &&
    getMilitaryEffectiveSalary(session) <
      getMinSalaryForCategory("military")
  );
}

/** عسكري + لا عقاري + راتب أقل من 10,000 */
function militaryNoPropertyBelowPersonalMin(session) {
  return (
    isMilitaryBelowPersonalMinSalary(session) && session.realEstate === "none"
  );
}

/**
 * عسكري أقل من 10,000: الباقة فقط إذا لا عقاري وراتب 7,000+
 * غير ذلك — لا عرض ولا حسبة شخصية
 */
function shouldOfferPropertyComboToMilitary(session) {
  if (!militaryNoPropertyBelowPersonalMin(session)) {
    return false;
  }
  return meetsMinimumSalaryForEntry(
    getMilitaryEffectiveSalary(session),
    "military"
  );
}

function needsMilitaryRemoteAllowanceCheck(session) {
  return (
    session?.jobCategory === "military" &&
    getMilitaryGrossSalary(session) >= getMinSalaryForCategory("military")
  );
}

/**
 * شراء مديونية — مدني/متقاعد فقط: لا عقاري + راتب 7,000+
 * (العسكري يُعالج عبر shouldOfferPropertyComboToMilitary في handlers)
 */
function shouldOfferPropertyComboForDebt(session) {
  if (
    session?.flow !== "debt_purchase" ||
    session.realEstate !== "none" ||
    session.jobCategory === "military"
  ) {
    return false;
  }
  const minCombo =
    CONFIG.comboPackage?.minSalary ?? CONFIG.limits.comboMinSalary ?? 7000;
  return Number(session.salary) >= minCombo;
}

/** @deprecated */
function shouldOfferPropertyComboOnly(session) {
  return shouldOfferPropertyComboForDebt(session);
}

const {
  roundToHundreds,
  roundThousandsRemainderMin,
  roundThousandsRemainderMax,
  roundToTenThousandsMinAmount,
  roundToTenThousandsStep,
  lowerStep,
  minLowerAmount,
  loanTermMonths,
} = CONFIG.financing;

/**
 * تقريب مبلغ العرض — 27,826→27,000 | 28,923→28,900 | 10,330→10,300
 */
function roundDownToStep(amount) {
  const n = Math.round(Number(amount));
  if (!n || n <= 0) return 0;

  if (
    roundToTenThousandsMinAmount &&
    roundToTenThousandsStep &&
    n >= roundToTenThousandsMinAmount
  ) {
    return n - (n % roundToTenThousandsStep);
  }

  const rem1000 = n % 1000;
  const bumpMin = roundThousandsRemainderMin ?? 800;
  const bumpMax = roundThousandsRemainderMax ?? 900;

  if (rem1000 >= bumpMin && rem1000 < bumpMax) {
    return n - rem1000;
  }

  const hundreds = roundToHundreds ?? 100;
  return n - (n % hundreds);
}

/**
 * مبالغ أقل: أول خيار = تقريب المبلغ المعروض لأسفل لأقرب lowerStep
 * (44,000 → 40,000 ثم 35,000 … حتى minLowerAmount)
 */
function buildLowerAmountTiers(
  roundedAmount,
  step = lowerStep,
  minAmount = minLowerAmount
) {
  const base = Math.round(Number(roundedAmount));
  if (!base || base <= 0) return [];

  const tiers = [];
  let amount = base - (base % step);

  if (amount >= base) {
    amount -= step;
  }

  while (amount >= minAmount) {
    tiers.push(amount);
    amount -= step;
  }

  return tiers;
}

function getInstallmentFormula(jobCategory) {
  const byCategory = CONFIG.financing.installmentFormulaByCategory || {};
  if (jobCategory && byCategory[jobCategory]) {
    return byCategory[jobCategory];
  }
  return CONFIG.financing.installmentFormula || "equalPrincipal";
}

/** أقساط مركبة — للعسكري */
function calculateAmortizedInstallment(
  principal,
  annualRatePercent,
  months = loanTermMonths
) {
  const p = Number(principal);
  const r = Number(annualRatePercent) / 100 / 12;
  if (!p || p <= 0) return 0;
  if (!r || r <= 0) return Math.round(p / months);
  const factor = Math.pow(1 + r, months);
  return Math.round((p * r * factor) / (factor - 1));
}

/** أصل القرض ÷ المدة + فائدة شهرية على المبلغ — للمدني والمتقاعد */
function calculateEqualPrincipalInstallment(
  principal,
  annualRatePercent,
  months = loanTermMonths
) {
  const p = Number(principal);
  const annual = Number(annualRatePercent) / 100;
  if (!p || p <= 0) return 0;
  if (!annual || annual <= 0) return Math.round(p / months);
  return Math.round(p / months + (p * annual) / 12);
}

/**
 * قسط شهري حسب معادلة القطاع (من config.financing.installmentFormulaByCategory)
 */
/**
 * إجمالي سداد التمويل (أصل + أرباح على مدة العقد) — مثال 10,000 @ 13% / 60 شهر → 16,500
 */
function calculateTotalRepayment(
  principal,
  annualRatePercent,
  months = loanTermMonths
) {
  const p = Number(principal);
  const annual = Number(annualRatePercent) / 100;
  if (!p || p <= 0) return 0;
  const years = months / 12;
  return Math.round(p * (1 + annual * years));
}

function calculateMonthlyInstallment(
  principal,
  annualRatePercent,
  months = loanTermMonths,
  jobCategory = null
) {
  const formula = getInstallmentFormula(jobCategory);
  if (formula === "equalPrincipal") {
    return calculateEqualPrincipalInstallment(
      principal,
      annualRatePercent,
      months
    );
  }
  return calculateAmortizedInstallment(principal, annualRatePercent, months);
}

function formatMoney(amount) {
  return Number(amount).toLocaleString("en-US");
}

/**
 * الراتب بعد خصم بدل المناطق النائية (يُستخدم في الحسبة كالراتب الأصلي).
 */
function getEffectiveSalary(grossSalary, remoteAllowance = 0) {
  return Number(grossSalary) - Number(remoteAllowance || 0);
}

function isHighCommitmentsForCivilian(salary, commitments) {
  const ratio = CONFIG.limits.civilianHighCommitmentsRatio;
  return Number(commitments) >= Number(salary) * ratio;
}

/**
 * عقاري + شخصي — بعد فشل التمويل الشخصي العادي:
 * لا عقاري، راتب 7,000+، والمبلغ التقديري أقل من الحد الأدنى، والتزامات مرتفعة.
 */
function qualifiesForPropertyCombo(session, estimatedAmount, totalCommitments) {
  if (militaryNoPropertyBelowPersonalMin(session)) {
    return false;
  }

  const minCombo =
    CONFIG.comboPackage?.minSalary ?? CONFIG.limits.comboMinSalary ?? 7000;
  const salary = Number(session.salary);

  if (session.realEstate !== "none" || salary < minCombo) {
    return false;
  }
  if (meetsMinimumEstimatedAmount(estimatedAmount)) {
    return false;
  }

  return isHighCommitmentsForCivilian(salary, totalCommitments);
}

/**
 * سبب عدم التمويل الشخصي قبل عرض الباقة (عقاري + شخصي)
 * @returns {"military_low_salary"|"high_commitments"|null}
 */
function resolveComboRejectReason(session, estimatedAmount, totalCommitments) {
  if (shouldOfferPropertyComboToMilitary(session)) {
    return "military_low_salary";
  }

  if (qualifiesForPropertyCombo(session, estimatedAmount, totalCommitments)) {
    return "high_commitments";
  }

  return null;
}

/**
 * سبب الرفض النهائي (بدون عرض الباقة)
 */
function resolveFinalRejectReason(
  session,
  estimatedAmount = null,
  totalCommitments = null
) {
  if (isMilitaryBelowPersonalMinSalary(session)) {
    return "military_low_salary";
  }

  const jobCategory = session?.jobCategory;
  if (session?.salary !== undefined || session?.grossSalary !== undefined) {
    const salaryForEntry =
      jobCategory === "military"
        ? getMilitaryGrossSalary(session)
        : Number(session.salary);
    if (!meetsMinimumSalaryForEntry(salaryForEntry, jobCategory)) {
      return jobCategory === "military"
        ? "military_low_salary"
        : "civilian_low_salary";
    }
  }

  if (estimatedAmount != null && totalCommitments != null) {
    const salary = Number(session.salary);
    if (isHighCommitmentsForCivilian(salary, totalCommitments)) {
      return "high_commitments";
    }
    if (!meetsMinimumEstimatedAmount(estimatedAmount)) {
      return "low_amount";
    }
  }

  return "low_amount";
}

module.exports = {
  calculateEstimatedAmount,
  meetsMinimumEstimatedAmount,
  meetsMinimumSalary,
  roundDownToStep,
  buildLowerAmountTiers,
  calculateMonthlyInstallment,
  calculateTotalRepayment,
  formatMoney,
  getEffectiveSalary,
  getMinSalaryForCategory,
  getMinSalaryForEntry,
  meetsMinimumSalaryForEntry,
  isMilitaryBelowPersonalMinSalary,
  militaryNoPropertyBelowPersonalMin,
  shouldOfferPropertyComboToMilitary,
  shouldOfferPropertyComboForDebt,
  needsMilitaryRemoteAllowanceCheck,
  getMilitaryGrossSalary,
  shouldOfferPropertyComboOnly,
  qualifiesForPropertyCombo,
  resolveComboRejectReason,
  resolveFinalRejectReason,
  getMilitaryEffectiveSalary,
  getMilitaryGrossSalary,
  isHighCommitmentsForCivilian,
};
