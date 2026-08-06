/**
 * مسارات كوبري الحسبة
 * POST /api/calc/personal
 * POST /api/calc/debt
 * POST /api/calc/installment
 * GET  /api/calc/rates
 */
const express = require("express");
const {
  personalFinanceCalc,
  debtPurchaseCalc,
  installmentCalc,
  ratesInfo,
} = require("../lib/calc-bridge");

const router = express.Router();

function requireBridgeAuth(req, res, next) {
  const key = String(process.env.CALC_BRIDGE_API_KEY || "").trim();
  if (!key) return next();

  const provided =
    String(req.headers["x-api-key"] || "").trim() ||
    (String(req.headers.authorization || "").startsWith("Bearer ")
      ? String(req.headers.authorization).slice(7).trim()
      : "");

  if (provided !== key) {
    return res.status(401).json({ ok: false, error: "مفتاح API غير صالح" });
  }
  return next();
}

router.use(requireBridgeAuth);

router.get("/rates", (_req, res) => {
  res.json(ratesInfo());
});

router.post("/personal", (req, res) => {
  const result = personalFinanceCalc(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

router.post("/debt", (req, res) => {
  const result = debtPurchaseCalc(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

router.post("/installment", (req, res) => {
  const result = installmentCalc(req.body || {});
  res.status(result.ok ? 200 : 400).json(result);
});

/** مسار موحّد لـ Interakt / Zapier */
router.post("/", (req, res) => {
  const body = req.body || {};
  const type = String(body.type || body.calc || "personal").toLowerCase();
  let result;
  if (type === "debt" || type === "debt_purchase") {
    result = debtPurchaseCalc(body);
  } else if (type === "installment" || type === "qist") {
    result = installmentCalc(body);
  } else if (type === "rates") {
    result = ratesInfo();
  } else {
    result = personalFinanceCalc(body);
  }
  res.status(result.ok ? 200 : 400).json(result);
});

module.exports = router;
