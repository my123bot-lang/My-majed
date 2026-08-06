/** هل عملية Node (نافذة البوت) ما زالت تعمل؟ */
function isPidAlive(pid) {
  const n = Number(pid);
  if (!n || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

module.exports = { isPidAlive };
