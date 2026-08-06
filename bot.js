/**
 * نقطة تشغيل بوت واتساب — ماجد (تمويل)
 *
 * تشغيل: npm start  أو  node bot.js
 */
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const CONFIG = require("./config");
const { getWwebjsAuthPath } = require("./lib/wwebjs-auth-path");
const { debugPortForAccount } = require("./lib/wa-debug-port");
const { handleIncomingMessage } = require("./lib/handlers");
const sessionStore = require("./lib/session");
const messages = require("./lib/messages");
const { replyToMessage } = require("./lib/reply");
const autoReplyControl = require("./lib/auto-reply-control");
const callStats = require("./lib/call-stats");
const waAccounts = require("./lib/whatsapp-accounts-store");
const { setCurrentWaAccountId } = require("./lib/current-wa-account");
const { loadSettingsForAccount } = require("./lib/settings-store");
const botStatus = require("./lib/bot-status");
const { setWhatsAppClient } = require("./lib/whatsapp-client");
const outboundQueue = require("./lib/outbound-wa-queue");
const openChatQueue = require("./lib/open-chat-queue");
const {
  openCustomerChatTab,
  closeExtraWaTabs,
} = require("./lib/bot-browser-chat");
const { sendWhatsAppText } = require("./lib/send-wa-message");
const customerLeads = require("./lib/customer-leads");
const { shouldSkipInboundMessage } = require("./lib/inbound-filter");

function resolveWaAccount() {
  const fromEnv = process.env.WA_ACCOUNT_ID || process.argv[2];
  if (fromEnv && String(fromEnv).trim()) {
    return waAccounts.getAccountById(String(fromEnv).trim());
  }
  return waAccounts.getActiveAccount();
}

const activeWaAccount = resolveWaAccount();
setCurrentWaAccountId(activeWaAccount.id);
botStatus.configureAccount(activeWaAccount.id);

const dbgPort = debugPortForAccount(activeWaAccount.id);

const startupContacts = loadSettingsForAccount(activeWaAccount.id);

console.log("");
console.log("============================================");
console.log(`  حساب واتساب لهذه النافذة: ${activeWaAccount.label}`);
console.log(`  المعرّف: ${activeWaAccount.id}`);
console.log(
  `  موظف التمويل الشخصي: ${startupContacts.personalAgentName} — ${startupContacts.personalAgentPhone}`
);
if (process.env.WA_ACCOUNT_ID || process.argv[2]) {
  console.log("  تشغيل بحساب محدد من سطر الأوامر");
} else {
  console.log("  الحساب النشط: اللوحة → تفعيل → start-bot.bat أو start-majed.bat");
}
console.log("============================================");
console.log("");
botStatus.writeStatus({
  accountId: activeWaAccount.id,
  label: activeWaAccount.label,
  status: "starting",
  qr: null,
  phone: null,
  debugPort: dbgPort,
});

const authDataPath = getWwebjsAuthPath();
console.log("مجلد الجلسة (خارج OneDrive):", authDataPath);
const agentPreview = loadSettingsForAccount(activeWaAccount.id);
console.log(
  `مندوب الباقة: ${agentPreview.propertyComboAgentName} / ${agentPreview.propertyComboAgentPhone}`
);
console.log(
  `مندوب إيقاف الخدمات (خيار 3): ${agentPreview.serviceStopAgentName} / ${agentPreview.serviceStopAgentPhone}`
);

const headlessEnv = process.env.PUPPETEER_HEADLESS;
const puppeteerArgs = [...(CONFIG.puppeteer.args || [])];
if (!puppeteerArgs.some((a) => String(a).includes("remote-debugging-port"))) {
  puppeteerArgs.push(`--remote-debugging-port=${dbgPort}`);
}

const puppeteerOptions = {
  headless:
    headlessEnv === "1" || headlessEnv === "true"
      ? true
      : headlessEnv === "0" || headlessEnv === "false"
        ? false
        : CONFIG.puppeteer.headless,
  args: puppeteerArgs,
  defaultViewport: null,
};

const chromePath =
  process.env.PUPPETEER_EXECUTABLE_PATH || CONFIG.puppeteer.executablePath;
if (chromePath) {
  const fs = require("fs");
  if (fs.existsSync(chromePath)) {
    puppeteerOptions.executablePath = chromePath;
  } else {
    console.warn(
      `Chrome غير موجود على المسار: ${chromePath} — سيُستخدم Chromium الافتراضي إن وُجد`
    );
  }
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: activeWaAccount.id,
    dataPath: authDataPath,
  }),
  puppeteer: puppeteerOptions,
  takeoverOnConflict: true,
  restartOnAuthFail: false,
});

setWhatsAppClient(client);

client.on("qr", (qr) => {
  console.log(CONFIG.messages.qrLog);
  console.log(
    `امسح QR من نافذة Chrome (واتساب ويب) أو من اللوحة → حساب: ${activeWaAccount.label}`
  );
  if (!puppeteerOptions.headless) {
    console.log("انتظر نافذة Chrome — لا تغلقها حتى يكتمل الربط");
  }
  qrcode.generate(qr, { small: true });
  botStatus.writeStatus({
    accountId: activeWaAccount.id,
    label: activeWaAccount.label,
    status: "qr",
    qr,
    phone: null,
  });
});

let statusHeartbeatTimer = null;

function writeReadyStatus() {
  let phone = null;
  try {
    const wid = client.info?.wid?.user;
    if (wid) phone = String(wid).replace(/\D/g, "");
  } catch (_) {}
  botStatus.writeStatus({
    accountId: activeWaAccount.id,
    label: activeWaAccount.label,
    status: "ready",
    qr: null,
    phone,
    reason: null,
  });
}

function stopStatusHeartbeat() {
  if (statusHeartbeatTimer) {
    clearInterval(statusHeartbeatTimer);
    statusHeartbeatTimer = null;
  }
}

function startStatusHeartbeat() {
  stopStatusHeartbeat();
  writeReadyStatus();
  statusHeartbeatTimer = setInterval(writeReadyStatus, 45000);
}

client.on("ready", async () => {
  console.log(CONFIG.messages.readyLog);
  try {
    const closed = await closeExtraWaTabs(client.pupBrowser, client.pupPage);
    if (closed > 0) {
      console.log(`[فتح محادثة] أُغلقت ${closed} تبويب واتساب زائدة — الرد الآلي يعمل على النافذة الرئيسية`);
    }
  } catch (_) {}
  startStatusHeartbeat();
  console.log(
    `الرد الآلي: ${autoReplyControl.statusLabel()} — stop/start = هذا العميل فقط · stop all/start all = الكل`
  );
  startOutboundPoller();
  startOpenChatPoller();
});

let outboundBusy = false;
let openChatBusy = false;

async function processOutboundQueue() {
  if (outboundBusy) return;
  outboundBusy = true;
  try {
    const st = botStatus.getStatusForAccount(activeWaAccount.id);
    if (st.status !== "ready") return;

    const batch = outboundQueue.claimPending(activeWaAccount.id, 1);
    for (const item of batch) {
      try {
        await sendWhatsAppText(client, item.phone, item.message);
        outboundQueue.markSent(item.id);
        if (item.leadId) {
          customerLeads.markFollowUpSent(item.leadId, item.message);
        }
        console.log(
          `[متابعة إلكتروني] ${item.phone} — ${activeWaAccount.label}`
        );
      } catch (err) {
        outboundQueue.markFailed(item.id, err.message);
        console.warn(
          `[متابعة إلكتروني] فشل ${item.phone}:`,
          err.message
        );
      }
      await sleep(CONFIG.outbound?.delayMs || 3500);
    }
  } catch (err) {
    console.warn("outbound queue:", err.message);
  } finally {
    outboundBusy = false;
  }
}

function startOutboundPoller() {
  const pollMs = CONFIG.outbound?.pollMs || 2500;
  setInterval(processOutboundQueue, pollMs);
  processOutboundQueue();
}

async function processOpenChatQueue() {
  if (openChatBusy) return;
  openChatBusy = true;
  try {
    const st = botStatus.getStatusForAccount(activeWaAccount.id);
    if (st.status !== "ready") return;

    const batch = openChatQueue.claimPending(activeWaAccount.id, 2);
    for (const item of batch) {
      try {
        const phone = item.phone || item.digits;
        const result = await openCustomerChatTab(client, phone);
        openChatQueue.markDone(item.id, result, activeWaAccount.id);
        console.log(
          `[فتح محادثة] ${phone} — ${activeWaAccount.label}${result.newTab ? " (تبويب جديد)" : ""}`
        );
      } catch (err) {
        openChatQueue.markFailed(item.id, err.message, activeWaAccount.id);
        console.warn(`[فتح محادثة] فشل ${item.phone}:`, err.message);
      }
    }
  } catch (err) {
    console.warn("open-chat queue:", err.message);
  } finally {
    openChatBusy = false;
  }
}

function startOpenChatPoller() {
  openChatQueue.migrateLegacyPending(activeWaAccount.id);
  setInterval(processOpenChatQueue, 400);
  processOpenChatQueue();
}

client.on("disconnected", (reason) => {
  stopStatusHeartbeat();
  const reasonText = String(reason || "");
  console.log("تم فصل البوت:", reasonText);
  console.log("نافذة Chrome قد تُغلق — لا تغلق نافذة البوت يدوياً إن أعدت التشغيل");
  if (reasonText === "LOGOUT") {
    console.log(`
واتساب غير متصل (LOGOUT). الحل:
  1) أوقف البوت (Ctrl+C)
  2) npm run unlock
  3) npm start
  4) امسح QR من لوحة التحكم: npm run admin ثم http://127.0.0.1:3000
`);
  }
  botStatus.writeStatus({
    accountId: activeWaAccount.id,
    label: activeWaAccount.label,
    status: "disconnected",
    qr: null,
    reason: reasonText,
  });
});

client.on("auth_failure", (message) => {
  stopStatusHeartbeat();
  console.log("فشل تسجيل الدخول:", message);
  botStatus.writeStatus({
    accountId: activeWaAccount.id,
    label: activeWaAccount.label,
    status: "auth_failure",
    qr: null,
    reason: String(message || ""),
  });
});

/**
 * أوامر المالك stop / start (رسائلك الصادرة).
 * stop | start = هذا العميل فقط — stop all | start all = جميع العملاء
 */
async function handleOwnerMessage(msg) {
  if (!msg.fromMe) return false;
  if (autoReplyControl.rememberOwnerCommandMessage(msg)) return true;

  const ownerCmd = autoReplyControl.parseOwnerCommand(msg.body);
  if (!ownerCmd) return false;

  const chatId = msg.to || msg.from;

  if (ownerCmd === "stop") {
    autoReplyControl.pauseChat(chatId);
    console.log("الرد الآلي موقوف لهذه المحادثة:", chatId);
    await client.sendMessage(chatId, CONFIG.botControl.chatPausedReply);
    return true;
  }

  if (ownerCmd === "start") {
    autoReplyControl.resumeChat(chatId);
    console.log("الرد الآلي مستأنف لهذه المحادثة:", chatId);
    await client.sendMessage(chatId, CONFIG.botControl.chatResumedReply);
    return true;
  }

  if (ownerCmd === "stop_all") {
    autoReplyControl.disable();
    console.log("الرد الآلي: متوقف بالكامل (أمر stop all من المالك)");
    await client.sendMessage(chatId, CONFIG.botControl.pausedReply);
    return true;
  }

  if (ownerCmd === "start_all") {
    autoReplyControl.enable({ clearPausedChats: true });
    console.log("الرد الآلي: يعمل — تم استئناف جميع المحادثات");
    await client.sendMessage(chatId, CONFIG.botControl.resumedReply);
    return true;
  }

  return false;
}

async function handleCustomerMessage(msg) {
  const from = msg.from;
  const preview = String(msg.body || "").slice(0, 60);
  console.log("رسالة واردة من:", from, "|", preview);

  const skip = shouldSkipInboundMessage(msg);
  if (skip.skip) {
    console.log("تجاهل رسالة (بدون رد):", from, "|", skip.reason, "|", preview);
    return;
  }

  if (!autoReplyControl.isEnabled()) {
    console.log("الرد الآلي متوقف — تجاهل رسالة من:", from);
    return;
  }

  if (autoReplyControl.isChatPaused(from)) {
    console.log("رد آلي موقوف لهذه المحادثة — تجاهل:", from);
    return;
  }

  if (sessionStore.shouldThrottle(from, String(msg.body || ""))) {
    console.log("تجاهل رسالة سريعة من:", from);
    return;
  }

  callStats.recordInboundContact();
  const replied = await handleIncomingMessage(msg);
  if (!replied) {
    console.warn(
      "لم يُرسل رد — من:",
      from,
      "| نص:",
      String(msg.body || "").slice(0, 80)
    );
  }
}

client.on("message", async (msg) => {
  try {
    const from = msg.from || "";

    if (from.includes("@g.us")) return;
    if (from.includes("broadcast")) return;

    if (await handleOwnerMessage(msg)) return;
    if (msg.fromMe) return;

    await handleCustomerMessage(msg);
  } catch (error) {
    console.error("BOT ERROR:", error);
    try {
      if (!msg.fromMe) {
        await replyToMessage(msg, messages.temporaryErrorMessage());
      }
    } catch (_) {
      /* ignore */
    }
  }
});

/** رسائل من هاتفك قد تصل عبر هذا الحدث فقط */
client.on("message_create", async (msg) => {
  try {
    if (!msg.fromMe) return;
    const from = msg.from || "";
    if (from.includes("@g.us") || from.includes("broadcast")) return;
    await handleOwnerMessage(msg);
  } catch (error) {
    console.error("OWNER CMD ERROR:", error);
  }
});

function isRecoverableInitError(msg) {
  return (
    msg.includes("Execution context was destroyed") ||
    msg.includes("Protocol error") ||
    msg.includes("Target closed") ||
    msg.includes("already running")
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function printInitHelp(msg) {
  if (msg.includes("already running")) {
    console.log(`
الحل (Chrome عالق على الجلسة):
  1) أغلق كل نوافذ Chrome
  2) من مجلد المشروع: npm run unlock
     أو شغّل start-bot.bat (يفك القفل تلقائياً)
  3) إن استمر: taskkill /F /IM chrome.exe ثم start-bot.bat
`);
  } else if (isRecoverableInitError(msg)) {
    console.log(`
الحل:
  1) taskkill /F /IM chrome.exe
  2) npm run reset-wa-session -- ${activeWaAccount.id}
  3) start-bot.bat
  4) امسح QR من Chrome (يبقى مفتوحاً) او من اللوحة
`);
  }
}

async function initializeBot(attempt = 1) {
  const maxAttempts = 3;
  try {
    await client.initialize();
  } catch (err) {
    const msg = String(err.message || err);
    console.error(`\n❌ فشل التشغيل (محاولة ${attempt}/${maxAttempts}):\n`, msg);

    if (attempt < maxAttempts && isRecoverableInitError(msg)) {
      console.log("إعادة المحاولة بعد 5 ثوانٍ...");
      await sleep(5000);
      return initializeBot(attempt + 1);
    }

    printInitHelp(msg);
    botStatus.writeStatus({
      accountId: activeWaAccount.id,
      label: activeWaAccount.label,
      status: "auth_failure",
      qr: null,
      reason: msg.slice(0, 200),
    });
    process.exit(1);
  }
}

process.on("unhandledRejection", (err) => {
  console.error("خطأ غير متوقع:", err);
});

initializeBot();
