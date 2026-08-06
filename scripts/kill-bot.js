/**
 * إيقاف عملية البوت فقط (bot.js) دون إيقاف لوحة التحكم (server.js)
 * npm run kill-bot
 */
const { execSync } = require("child_process");

if (process.platform !== "win32") {
  console.log("استخدم kill-bot يدوياً على هذا النظام.");
  process.exit(0);
}

try {
  const out = execSync(
    'wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:list',
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  const blocks = out.split(/\r?\n\r?\n/).filter((b) => b.includes("bot.js"));
  const pids = new Set();
  for (const block of blocks) {
    if (block.includes("server.js")) continue;
    const m = block.match(/ProcessId=(\d+)/i);
    if (m) pids.add(m[1]);
  }
  if (pids.size === 0) {
    console.log("لا توجد عملية bot.js شغّالة.");
    process.exit(0);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      console.log("تم إيقاف البوت PID:", pid);
    } catch (_) {
      console.warn("تعذر إيقاف PID", pid);
    }
  }
} catch (err) {
  console.warn("kill-bot:", err.message);
}
