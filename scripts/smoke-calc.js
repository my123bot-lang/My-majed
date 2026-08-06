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
