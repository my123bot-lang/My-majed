/**
 * اختبار سريع لكوبري الحسبة
 */
const assert = require("assert");
const {
  personalFinanceCalc,
  debtPurchaseCalc,
  installmentCalc,
  ratesInfo,
} = require("../lib/calc-bridge");
const {
  calculateEstimatedAmount,
  roundDownToStep,
  capEstimatedAmountToAffordable,
  isLoanTermAffordable,
  listAffordableLoanTermYears,
  calculateMonthlyInstallment,
} = require("../lib/calculations");

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

const rates = ratesInfo();
ok(rates.ok, "ratesInfo");
ok(rates.personal.military === 18.5, "military rate 18.5");
ok(rates.debtPurchase === 12, "debt rate 12");

const personal = personalFinanceCalc({
  jobCategory: "civilian",
  salary: 10000,
  commitments: 1000,
  realEstate: "none",
});
ok(personal.ok, "personal calc ok");
ok(personal.result.amount > 0, `personal amount=${personal.result.amount}`);
ok(personal.result.installment > 0, `installment=${personal.result.installment}`);

const military = personalFinanceCalc({
  jobCategory: "military",
  salary: 12000,
  commitments: 2000,
  realEstate: "none",
  remoteAllowance: 1000,
});
ok(military.ok && military.inputs.salary === 11000, "military effective salary after allowance");

// عسكري: لا يُعرض مبلغ قسطه أكبر من القدرة ثم يُرفض عند اختيار 5 سنوات
const milSession = {
  salary: 11000,
  commitments: 1500,
  realEstate: "none",
  jobCategory: "military",
};
const milRaw = calculateEstimatedAmount("none", 11000, 1500, 0);
const milOld = roundDownToStep(milRaw);
const milOffer = capEstimatedAmountToAffordable(milSession, milRaw, 18.5, "military");
ok(milOld === 120000, `legacy rounded military amount=${milOld}`);
ok(
  calculateMonthlyInstallment(milOld, 18.5, 60, "military") === 3850,
  "legacy 120k@18.5% installment 3850"
);
ok(
  !isLoanTermAffordable(milSession, milOld, 5, 18.5, "military"),
  "legacy 120k not affordable at 5y"
);
ok(milOffer > 0 && milOffer < milOld, `capped offer=${milOffer} < legacy`);
ok(
  isLoanTermAffordable(milSession, milOffer, 5, 18.5, "military"),
  "capped offer affordable at 5y"
);
ok(
  listAffordableLoanTermYears(milSession, milOffer, 18.5, "military").includes(5),
  "5 years allowed for capped offer"
);
ok(
  military.result.amount ===
    capEstimatedAmountToAffordable(
      {
        salary: military.inputs.salary,
        commitments: military.inputs.commitments,
        realEstate: "none",
      },
      military.result.rawAmount,
      18.5,
      "military"
    ),
  "bridge military amount is affordability-capped"
);

const debt = debtPurchaseCalc({
  jobCategory: "civilian",
  salary: 12000,
  commitments: 1500,
  debtAmount: 20000,
  realEstate: "none",
});
ok(debt.ok, "debt calc ok");
ok(debt.result.eligible === true, "debt eligible");
ok(debt.result.surplus >= 0, "debt surplus");

const qist = installmentCalc({ amount: 10000, interestRate: 13, jobCategory: "civilian" });
ok(qist.ok && qist.result.installment === 275, `installment 10k@13%=${qist.result.installment}`);

console.log("\nAll calc bridge smoke tests passed.");
