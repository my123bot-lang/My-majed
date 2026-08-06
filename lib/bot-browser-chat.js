/**
 * فتح محادثة عميل داخل نافذة واتساب الرئيسية للبوت — بدون تبويب ثانٍ (لا يوقف الرد الآلي)
 */
const { phoneToWhatsAppDigits } = require("./contact-phone");

async function focusPage(page) {
  if (!page) return;
  try {
    await page.bringToFront();
  } catch (_) {}
  try {
    const session = await page.target().createCDPSession();
    await session.send("Page.bringToFront");
  } catch (_) {}
}

/** إغلاق تبويبات واتساب الزائدة التي قد تُوقف البوت */
async function closeExtraWaTabs(browser, mainPage) {
  if (!browser || !mainPage) return 0;
  let closed = 0;
  const pages = await browser.pages();
  for (const p of pages) {
    if (p === mainPage) continue;
    try {
      const u = p.url();
      if (u.includes("web.whatsapp.com")) {
        await p.close();
        closed += 1;
      }
    } catch (_) {}
  }
  return closed;
}

async function resolveChatId(client, digits) {
  let chatId = `${digits}@c.us`;
  try {
    const wid = await client.getNumberId(digits);
    if (wid) {
      chatId = wid._serialized || wid.user || chatId;
      if (chatId && !chatId.includes("@")) chatId = `${chatId}@c.us`;
    }
  } catch (_) {}
  return chatId;
}

async function openCustomerChatTab(client, customerPhone) {
  const digits = phoneToWhatsAppDigits(customerPhone);
  if (!digits) throw new Error("رقم العميل غير صالح");

  const browser = client.pupBrowser;
  const mainPage = client.pupPage;
  if (!browser || !mainPage || !client.interface) {
    throw new Error("المتصفح غير جاهز — انتظر «جاهز» في نافذة البوت");
  }

  await closeExtraWaTabs(browser, mainPage);

  const chatId = await resolveChatId(client, digits);

  try {
    await client.interface.openChatWindow(chatId);
  } catch (err) {
    try {
      await client.interface.openChatDrawer(chatId);
    } catch (_) {
      throw new Error(
        `تعذّر فتح المحادثة — تأكد أن الرقم مسجّل على واتساب (${err.message || ""})`
      );
    }
  }

  await focusPage(mainPage);

  return {
    url: `https://web.whatsapp.com/`,
    chatId,
    newTab: false,
    openedInMainWindow: true,
  };
}

module.exports = { openCustomerChatTab, closeExtraWaTabs };
