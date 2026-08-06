/**
 * حسبة مسار شراء المديونية — فائدة 12% على الإجمالي (جميع القطاعات).
 */
const CONFIG = require("../config");
const {
  calculateEstimatedAmount,
  calculateMonthlyInstallment,
} = require("./calculations");

const { surplusMaxRatioOfDebt } = CONFIG.debtPurchase;

/**
 * @param {number} effectiveSalary راتب بعد خصم البدل إن وجد
 * @param {number} commitments
 * @param {number} debtAmount مبلغ شراء المديونية
 * @param {number} [annualRatePercent] افتراضي من config.debtPurchase.interestRate (12%)
 */
function calculateDebtPurchaseOffer(
  effectiveSalary,
  commitments,
  debtAmount,
  annualRatePercent,
  jobCategory = null,
  realEstateType = "none",
  supportAmount = 0
) {
  const interestRate =
    Number(annualRatePercent) || Number(CONFIG.debtPurchase.interestRate) || 12;
  const personalCap = calculateEstimatedAmount(
    realEstateType || "none",
    effectiveSalary,
    commitments,
    supportAmount || 0
  );
  const debt = Number(debtAmount);

  if (!debt || debt <= 0) {
    return { eligible: false, reason: "invalid_debt" };
  }

  if (personalCap < debt) {
    return {
      eligible: false,
      reason: "insufficient_cap",
      personalCap,
      debtAmount: debt,
    };
  }

  const maxSurplus = Math.round(debt * surplusMaxRatioOfDebt);
  const surplus = Math.min(Math.max(0, personalCap - debt), maxSurplus);
  const total = debt + surplus;
  const installment = calculateMonthlyInstallment(
    total,
    interestRate,
    undefined,
    jobCategory
  );

  return {
    eligible: true,
    personalCap,
    debtAmount: debt,
    surplus,
    total,
    installment,
    interestRate,
  };
}

module.exports = {
  calculateDebtPurchaseOffer,
};
