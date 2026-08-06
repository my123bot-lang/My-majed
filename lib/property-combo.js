/**
 * مبالغ باقة العقاري + الشخصي حسب القطاع.
 */
const CONFIG = require("../config");

function getComboPackage() {
  return CONFIG.comboPackage;
}

module.exports = {
  getComboPackage,
};
