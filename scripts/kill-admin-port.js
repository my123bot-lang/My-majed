/**
 * تحرير المنفذ 3000 (لوحة التحكم) على Windows
 * npm run kill-port
 */
const { execSync } = require("child_process");

const port = process.env.ADMIN_PORT || "3000";

if (process.platform !== "win32") {
  console.log("استخدم kill-port يدوياً على هذا النظام.");
  process.exit(0);
}

try {
  const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
  const pids = new Set();
  for (const line of out.split("\n")) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }
  if (pids.size === 0) {
    console.log(`المنفذ ${port} غير مستخدم.`);
    process.exit(0);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
      console.log("تم إيقاف العملية:", pid);
    } catch (_) {
      console.warn("تعذر إيقاف PID", pid, "— شغّل PowerShell كمسؤول");
    }
  }
} catch (_) {
  console.log(`المنفذ ${port} غير مستخدم.`);
}
