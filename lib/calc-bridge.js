/**
 * واجهة HTTP اختيارية لنفس معادلات lib/calculations.js
 * الحسبة الأساسية للعميل تمر عبر handlers عبر كوبري Interakt — ليس عبر هذه الصفحة.
 */

const CONFIG = require("../config");
const {
  calculateEstimatedAmount,
  roundDownToStep,
  buildLowerAmountTiers,
  calculateMonthlyInstallment,
  calculateTotalRepayment,
  formatMoney,
  getEffectiveSalary,
  getMinSalaryForCategory,
  getMinSalaryForEntry,
  meetsMinimumSalary,
  meetsMinimumSalaryForEntry,
  meetsMinimumEstimatedAmount,
  isHighCommitmentsForCivilian,
  qualifiesForPropertyCombo,
  resolveFinalRejectReason,
} = require("./calculations");
const { calculateDebtPurchaseOffer } = require("./debt-purchase");
const { resolveInterestRate, resolveDebtPurchaseInterestRate } = require("./interest-rate");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeJobCategory(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (["military", "عسكري", "1"].includes(s)) return "military";
  if (["civilian", "مدني", "2"].includes(s)) return "civilian";
  if (["retired", "متقاعد", "3"].includes(s)) return "retired";
  return null;
}

function normalizeRealEstate(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (["supported", "مدعوم", "عقاري مدعوم", "1"].includes(s)) return "supported";
  if (["unsupported", "غير مدعوم", "عقاري غير مدعوم", "2"].includes(s)) {
    return "unsupported";
  }
  if (["old", "قديم", "تمويل عقاري قديم", "4"].includes(s)) return "old";
  if (["none", "لا", "لا يوجد", "لا يوجد عقاري", "3"].includes(s)) return "none";
  return "none";
}

/**
 * حسبة التمويل الشخصي
 * body: { jobCategory, salary, commitments, realEstate, supportAmount?, remoteAllowance? }
 */
function personalFinanceCalc(input = {}) {
  const jobCategory = normalizeJobCategory(input.jobCategory || input.sector);
  if (!jobCategory) {
    return { ok: false, error: "jobCategory مطلوب: military | civilian | retired" };
  }

  const grossSalary = num(input.salary ?? input.grossSalary);
  const remoteAllowance = num(input.remoteAllowance);
  const salary = getEffectiveSalary(grossSalary, remoteAllowance);
  const commitments = num(input.commitments);
  const realEstate = normalizeRealEstate(input.realEstate || input.realEstateType);
  const supportAmount =
    realEstate === "supported" ? num(input.supportAmount) : 0;
  const presetDeduction = realEstate === "old" ? num(CONFIG.financing.oldMortgageInstallment, 1667) : 0;
  const totalCommitments = commitments + presetDeduction;

  const interestRate = resolveInterestRate({ jobCategory });
  const rawAmount = calculateEstimatedAmount(
    realEstate,
    salary,
    totalCommitments,
    supportAmount
  );
  const roundedAmount = roundDownToStep(rawAmount);
  const installment = calculateMonthlyInstallment(
    roundedAmount,
    interestRate,
    undefined,
    jobCategory
  );
  const totalRepayment = calculateTotalRepayment(
    roundedAmount,
    interestRate,
    undefined
  );
  const lowerTiers = buildLowerAmountTiers(roundedAmount);

  const entryOk = meetsMinimumSalaryForEntry(
    jobCategory === "military" ? grossSalary : salary,
    jobCategory
  );
  const salaryOk = meetsMinimumSalary(salary, jobCategory);
  const amountOk = meetsMinimumEstimatedAmount(roundedAmount);
  const highCommitments = isHighCommitmentsForCivilian(salary, totalCommitments);

  const sessionLike = {
    jobCategory,
    salary,
    grossSalary,
    remoteAllowance,
    realEstate,
    commitments: totalCommitments,
  };
  const comboEligible = qualifiesForPropertyCombo(
    sessionLike,
    roundedAmount,
    totalCommitments
  );
  const rejectReason = resolveFinalRejectReason(
    sessionLike,
    roundedAmount,
    totalCommitments
  );

  const eligible = entryOk && salaryOk && amountOk && !highCommitments;

  return {
    ok: true,
    type: "personal",
    inputs: {
      jobCategory,
      grossSalary,
      remoteAllowance,
      salary,
      commitments: totalCommitments,
      realEstate,
      supportAmount,
      interestRate,
    },
    result: {
      eligible,
      rawAmount,
      amount: roundedAmount,
      amountFormatted: formatMoney(roundedAmount),
      installment,
      installmentFormatted: formatMoney(installment),
      totalRepayment,
      totalRepaymentFormatted: formatMoney(totalRepayment),
      lowerAmountTiers: lowerTiers,
      lowerAmountTiersFormatted: lowerTiers.map(formatMoney),
      minSalary: getMinSalaryForCategory(jobCategory),
      minEntrySalary: getMinSalaryForEntry(jobCategory),
      minEstimatedAmount: CONFIG.limits.minEstimatedAmount,
      checks: {
        entryOk,
        salaryOk,
        amountOk,
        highCommitments,
        comboEligible,
      },
      rejectReason: eligible ? null : rejectReason,
      comboPackage: CONFIG.comboPackage,
    },
  };
}

/**
 * حسبة شراء المديونية
 * body: { jobCategory, salary, commitments, debtAmount, realEstate?, supportAmount?, remoteAllowance? }
 */
function debtPurchaseCalc(input = {}) {
  const jobCategory = normalizeJobCategory(input.jobCategory || input.sector);
  if (!jobCategory) {
    return { ok: false, error: "jobCategory مطلوب: military | civilian | retired" };
  }

  const grossSalary = num(input.salary ?? input.grossSalary);
  const remoteAllowance = num(input.remoteAllowance);
  const salary = getEffectiveSalary(grossSalary, remoteAllowance);
  const commitments = num(input.commitments);
  const debtAmount = num(input.debtAmount ?? input.debt);
  const realEstate = normalizeRealEstate(input.realEstate || input.realEstateType);
  const supportAmount =
    realEstate === "supported" ? num(input.supportAmount) : 0;
  const interestRate = resolveDebtPurchaseInterestRate();

  const offer = calculateDebtPurchaseOffer(
    salary,
    commitments,
    debtAmount,
    interestRate,
    jobCategory,
    realEstate,
    supportAmount
  );

  if (!offer.eligible) {
    return {
      ok: true,
      type: "debt_purchase",
      inputs: {
        jobCategory,
        grossSalary,
        remoteAllowance,
        salary,
        commitments,
        debtAmount,
        realEstate,
        supportAmount,
        interestRate,
      },
      result: {
        eligible: false,
        reason: offer.reason,
        personalCap: offer.personalCap ?? null,
        personalCapFormatted:
          offer.personalCap != null ? formatMoney(offer.personalCap) : null,
        debtAmount: offer.debtAmount ?? debtAmount,
      },
    };
  }

  return {
    ok: true,
    type: "debt_purchase",
    inputs: {
      jobCategory,
      grossSalary,
      remoteAllowance,
      salary,
      commitments,
      debtAmount,
      realEstate,
      supportAmount,
      interestRate,
    },
    result: {
      eligible: true,
      personalCap: offer.personalCap,
      personalCapFormatted: formatMoney(offer.personalCap),
      debtAmount: offer.debtAmount,
      debtAmountFormatted: formatMoney(offer.debtAmount),
      surplus: offer.surplus,
      surplusFormatted: formatMoney(offer.surplus),
      total: offer.total,
      totalFormatted: formatMoney(offer.total),
      installment: offer.installment,
      installmentFormatted: formatMoney(offer.installment),
      interestRate: offer.interestRate,
    },
  };
}

/**
 * قسط فقط — لأي مبلغ ونسبة
 */
function installmentCalc(input = {}) {
  const principal = num(input.amount ?? input.principal);
  const jobCategory = normalizeJobCategory(input.jobCategory || input.sector);
  const interestRate =
    num(input.interestRate, NaN) ||
    (jobCategory
      ? resolveInterestRate({ jobCategory })
      : Number(CONFIG.debtPurchase.interestRate));
  const months = num(input.months, CONFIG.financing.loanTermMonths || 60);

  if (!principal || principal <= 0) {
    return { ok: false, error: "amount مطلوب ويجب أن يكون أكبر من صفر" };
  }

  const installment = calculateMonthlyInstallment(
    principal,
    interestRate,
    months,
    jobCategory
  );
  const totalRepayment = calculateTotalRepayment(principal, interestRate, months);

  return {
    ok: true,
    type: "installment",
    result: {
      principal,
      principalFormatted: formatMoney(principal),
      interestRate,
      months,
      installment,
      installmentFormatted: formatMoney(installment),
      totalRepayment,
      totalRepaymentFormatted: formatMoney(totalRepayment),
    },
  };
}

function ratesInfo() {
  return {
    ok: true,
    brand: CONFIG.brand.name,
    personal: {
      military: CONFIG.jobCategories.military.interestRate,
      civilian: CONFIG.jobCategories.civilian.interestRate,
      retired: CONFIG.jobCategories.retired.interestRate,
    },
    debtPurchase: CONFIG.debtPurchase.interestRate,
    limits: CONFIG.limits,
    calculation: CONFIG.calculation,
    financing: {
      loanTermMonths: CONFIG.financing.loanTermMonths,
      lowerStep: CONFIG.financing.lowerStep,
      minLowerAmount: CONFIG.financing.minLowerAmount,
      oldMortgageInstallment: CONFIG.financing.oldMortgageInstallment,
      portalUrl: CONFIG.financing.portalUrl,
    },
  };
}

module.exports = {
  personalFinanceCalc,
  debtPurchaseCalc,
  installmentCalc,
  ratesInfo,
  normalizeJobCategory,
  normalizeRealEstate,
};
