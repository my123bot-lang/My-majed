/** منفذ Chrome DevTools — ثابت لكل حساب واتساب (نفس الحسبة في bot.js) */
function debugPortForAccount(accountId) {
  const id = String(accountId || "");
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return 9222 + (Math.abs(h) % 500);
}

module.exports = { debugPortForAccount };
