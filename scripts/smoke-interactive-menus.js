/**
 * اختبار: قوالب واتساب التفاعلية تُبنى ضمن حدود API
 * ولا تتحول إلى نص مرقّم إلا بعد فشل الإرسال التفاعلي.
 */
const assert = require("assert");
const menus = require("../lib/menus");
const { menuToText, replyMenu } = require("../lib/reply");
const {
  buildListMessageData,
  buildButtonMessageData,
  listToButtonMenuChunks,
  listRowsForWhatsApp,
  normalizeInteractiveBody,
} = require("../lib/interactive-menu");
const { collectPhoneAttempts, splitPhone } = require("../lib/interakt-client");
const { createMetaMessage } = require("../lib/meta-adapter");
const { parseInquiryType } = require("../lib/validators");

function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log("✓", msg);
}

const main = menus.inquiryMain();
ok(main.kind === "list", "القائمة الرئيسية InteractiveList");
ok(main.rows.length === 7, "سبعة خيارات في القائمة الرئيسية");
ok(
  main.rows.some((r) => r.id === "7" && r.title === "سياسة الرواتب المطلوبة"),
  "خيار سياسة الرواتب المطلوبة في القائمة"
);
ok(main.buttonText === "الخيارات", "زر فتح القائمة: الخيارات");

for (const row of main.rows) {
  ok(String(row.title).length <= 24, `عنوان القائمة ≤24: ${row.title}`);
}

const listData = buildListMessageData(main.body, main.buttonText, main.rows);
ok(listData.message.type === "list", "حمولة Interakt type=list");
ok(listData.message.action.sections[0].title === "الخيارات", "عنوان القسم");
ok(
  listData.message.action.sections[0].rows.every((r) => r.description),
  "كل صف له description كما في مثال Interakt"
);
ok(
  listData.message.body.text.includes("مانوع استفسارك"),
  "نص الترحيب داخل جسم القائمة"
);

const yesNo = menus.yesNo("هل ترغب؟");
const btnData = buildButtonMessageData(yesNo.body, yesNo.buttons);
ok(btnData.message.type === "button", "حمولة الأزرار type=button");
ok(btnData.message.action.buttons.length === 2, "زرّان نعم/لا");
ok(
  btnData.message.action.buttons.every((b) => b.type === "reply" && b.reply.id && b.reply.title),
  "صيغة Cloud API للأزرار"
);

const chunks = listToButtonMenuChunks(main);
ok(chunks.length === 3, "القائمة ذات 7 صفوف تنقسم إلى 3 مجموعات أزرار");
ok(
  chunks[0].buttons.length === 3 &&
    chunks[1].buttons.length === 3 &&
    chunks[2].buttons.length === 1,
  "3+3+1 أزرار عند فشل القائمة"
);
ok(
  chunks.flatMap((c) => c.buttons).every((b) => String(b.title).length <= 20),
  "عناوين الأزرار ≤20 حرفاً"
);
ok(
  chunks[2].buttons[0].title === "سياسة الرواتب",
  "عنوان زر سياسة الرواتب لا يُقطع عند الرجوع للأزرار"
);

const numbered = menuToText(main);
ok(
  numbered.includes("1- تمويل شخصي") &&
    numbered.includes("6- خدمات مابعد البيع") &&
    numbered.includes("7- سياسة الرواتب المطلوبة"),
  "النص البديل بنفس أرقام الخيارات"
);

ok(
  parseInquiryType("تمويل شخصي") === "personal" &&
    parseInquiryType("1") === "personal",
  "اختيار القائمة أو الرقم يصل لنفس المسار"
);
ok(
  parseInquiryType("سياسة الرواتب المطلوبة") === "salary_policy" &&
    parseInquiryType("7") === "salary_policy",
  "خيار سياسة الرواتب يصل لنفس المسار من العنوان أو الرقم"
);

const collapsed = normalizeInteractiveBody("سطر\n\n\n\nسطر");
ok(collapsed === "سطر\n\nسطر", "طي الأسطر الفارغة الزائدة في جسم القائمة");

const fromIntl = collectPhoneAttempts("966501234567");
ok(
  fromIntl[0].countryCode === "+966" && fromIntl[0].phoneNumber === "501234567",
  "تجزئة 9665… إلى رمز دولة ورقم محلي"
);
const fromLocal = splitPhone("0501234567");
ok(fromLocal.phoneNumber === "501234567", "تجزئة 05…");

const waRows = listRowsForWhatsApp(main.rows);
ok(waRows.length === 7 && waRows[0].id === "1", "صفوف واتساب تحافظ على المعرفات");
ok(waRows[6].id === "7", "صف سياسة الرواتب يحافظ على المعرف 7");

(async () => {
  let sentMenu = null;
  await replyMenu(
    {
      sendInteractive: async (menu) => {
        sentMenu = menu;
        return { ok: true };
      },
      reply: async () => {
        throw new Error("should not fallback to text");
      },
    },
    main
  );
  ok(sentMenu === main, "replyMenu يرسل التفاعلي عند التوفر");

  let fallbackText = "";
  await replyMenu(
    {
      sendInteractive: async () => {
        throw new Error("Interakt 400: invalid interactive");
      },
      reply: async (body) => {
        fallbackText = body;
      },
    },
    main
  );
  ok(
    fallbackText.includes("1- تمويل شخصي"),
    "إذا فشل التفاعلي يُرسل النص المرقّم حتى لا يصمت البوت"
  );

  const metaMsg = createMetaMessage({
    phone: "966501234567",
    body: "اعادة",
    messageId: "wamid.test",
  });
  ok(
    typeof metaMsg.sendInteractive === "function",
    "مسار Meta فيه sendInteractive حتى لا تختفي الأزرار هناك"
  );

  console.log("smoke-interactive-menus: OK");
})().catch((err) => {
  console.error("smoke-interactive-menus FAILED:", err);
  process.exit(1);
});
