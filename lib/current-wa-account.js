/**
 * حساب واتساب لهذه العملية (تشغيل مزدوج: WA_ACCOUNT_ID)
 */
let currentId = process.env.WA_ACCOUNT_ID || null;

function setCurrentWaAccountId(accountId) {
  currentId = accountId ? String(accountId).trim() : null;
  if (currentId) process.env.WA_ACCOUNT_ID = currentId;
}

function getCurrentWaAccountId() {
  return currentId || process.env.WA_ACCOUNT_ID || null;
}

module.exports = {
  setCurrentWaAccountId,
  getCurrentWaAccountId,
};
