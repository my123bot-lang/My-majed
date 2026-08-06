/**
 * فتح محادثة عميل — طلب للبوت عبر طابور (لا اتصال Puppeteer من اللوحة)
 */
const botStatus = require("./bot-status");
const { phoneToWhatsAppDigits } = require("./contact-phone");
const { isPidAlive } = require("./process-alive");
const openChatQueue = require("./open-chat-queue");

function botStartHint(accountId) {
  if (accountId === "majed") return "start-majed.bat";
  if (accountId === "majed") return "start-majed.bat";
  return `start-bot-account.bat ${accountId}`;
}

async function openWhatsAppChat(waAccountId, customerPhone) {
  const accountId = String(waAccountId || "").trim();
  if (!accountId) {
    throw new Error("لم يُحدد جوال البوت — تأكد أن الحساب النشط هو ماجد");
  }

  const digits = phoneToWhatsAppDigits(customerPhone);
  if (!digits) {
    throw new Error("رقم العميل غير صالح");
  }

  const raw = botStatus.readStatusForAccount(accountId);
  const st = botStatus.getStatusForAccount(accountId);
  const label = st.label || accountId;
  const hint = botStartHint(accountId);

  if (st.status !== "ready") {
    throw new Error(
      `البوت غير جاهز لـ «${label}» — افتح نافذة البوت (${hint}) وانتظر «جاهز»`
    );
  }

  if (raw.pid && !isPidAlive(raw.pid)) {
    throw new Error(
      `نافذة بوت «${label}» غير شغّالة — شغّل ${hint} واترك النافذة مفتوحة`
    );
  }

  if (!st.botProcessAlive && !raw.pid) {
    throw new Error(
      `لا يمكن التحقق من بوت «${label}» — شغّل ${hint} ثم أعد المحاولة`
    );
  }

  const item = openChatQueue.enqueue({
    waAccountId: accountId,
    phone: String(customerPhone || "").trim(),
    digits,
  });

  const result = await openChatQueue.waitForResult(item.id, 45000, accountId);

  return {
    ok: true,
    accountId,
    label,
    url: result.url || `https://web.whatsapp.com/send?phone=${digits}`,
    newTab: result.newTab !== false,
  };
}

module.exports = { openWhatsAppChat };
