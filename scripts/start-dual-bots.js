/**
 * فتح نافذة بوت منفصلة لكل جوال (تشغيل متعدد)
 * npm run start-dual
 */
const { spawn } = require("child_process");
const path = require("path");
const waAccounts = require("../lib/whatsapp-accounts-store");

const root = path.join(__dirname, "..");
const startOneBat = path.join(root, "start-bot-account.bat");

function accountsToRun() {
  const fromEnv = process.env.WA_DUAL_ACCOUNTS;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => waAccounts.getAccountById(id));
  }
  return waAccounts.listRunnableAccounts();
}

const accounts = accountsToRun();
if (accounts.length === 0) {
  console.error("لا توجد حسابات للتشغيل (أضف جوالاً غير admin في اللوحة).");
  process.exit(1);
}

console.log("تشغيل", accounts.length, "جوال/جوالات:");
for (const acc of accounts) {
  console.log(" -", acc.id, "—", acc.label);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", startOneBat, acc.id], {
        cwd: root,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      }).unref();
    } else {
      spawn("node", ["bot.js"], {
        cwd: root,
        env: { ...process.env, WA_ACCOUNT_ID: acc.id },
        detached: true,
        stdio: "ignore",
      }).unref();
    }
    if (i < accounts.length - 1) await sleep(25000);
  }
  console.log("\nتم فتح النوافذ — لا تغلقها. انتظر Chrome. اللوحة: npm run admin");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
