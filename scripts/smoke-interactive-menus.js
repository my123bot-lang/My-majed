/**
 * اختبار: قوالب واتساب التفاعلية تُبنى ضمن حدود API
 * ولا تتحول إلى نص مرقّم إلا بعد فشل الإرسال التفاعلي.
 */
const assert = require("assert");
const menus = require("../lib/menus");
const { menuToText, replyMenu, setPollFactory } = require("../lib/reply");
const {
  buildMenuPollSpec,
  rememberMenuPoll,
  resolveMenuPollVote,
  resetMenuPolls,
} = require("../lib/menu-poll");
const {
  buildListMessageData,
  buildButtonMessageData,
  listToButtonMenuChunks,
  listRowsForWhatsApp,
  normalizeInteractiveBody,
} = require("../lib/interactive-menu");
const {
  collectPhoneAttempts,
  splitPhone,
  isSessionWindowError,
  isTimeoutError,
  orderInteractiveVariants,
  rememberInteractiveType,
  nextInteractiveAttempt,
} = require("../lib/interakt-client");
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
const salaryPropRow = listData.message.action.sections[0].rows.find(
  (r) => r.id === "7"
);
ok(
  salaryPropRow &&
    salaryPropRow.description === "أقل راتب للصراف حسب القطاع",
  "وصف سياسة الرواتب يُرسل فقط عند اختلافه عن العنوان"
);
ok(
  listData.message.action.sections[0].rows
    .filter((r) => r.id !== "7")
    .every((r) => !r.description),
  "صفوف بدون وصف صريح لا تحصل على description مكرر للعنوان"
);
ok(
  listData.message.body.text.includes("مانوع استفسارك"),
  "نص الترحيب داخل جسم القائمة"
);

const amountMenu = menus.lowerAmountTiers([35000, 30000, 25000, 15000, 10000]);
const amountRows = listRowsForWhatsApp(amountMenu.rows);
ok(
  amountRows.every((r) => r.title && !r.description),
  "قائمة المبالغ بدون description حتى لا يتكرر الاختيار في واتساب"
);
const yearsMenu = menus.loanTermYears([1, 2, 3, 4, 5]);
const yearRows = listRowsForWhatsApp(yearsMenu.rows);
ok(
  yearRows.every((r) => r.title && !r.description),
  "قائمة السنوات بدون description حتى لا يتكرر الاختيار في واتساب"
);
ok(
  yearRows.some((r) => r.id === "5" && r.title === "5 سنوات"),
  "صف 5 سنوات يحتفظ بالعنوان فقط"
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

const sectorText = menuToText(menus.civilianSector());
ok(
  sectorText.includes("اختر نوع الجهة:") &&
    sectorText.includes("1- حكومي") &&
    sectorText.includes("2- قطاع خاص") &&
    !sectorText.includes("civ_gov") &&
    !sectorText.includes("civ_private"),
  "إذا فشلت أزرار نوع الجهة يظهر ترقيم للعميل بدون المعرف الداخلي"
);

const jobText = menuToText(menus.jobType());
ok(
  jobText.includes("1- مدني") &&
    jobText.includes("2- عسكري") &&
    jobText.includes("3- متقاعد") &&
    !jobText.includes("job_civilian"),
  "النص البديل للقطاع بأرقام، ومعرف الزر يبقى داخلياً"
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
  const listTexts = [];
  await replyMenu(
    {
      sendInteractive: async (menu) => {
        sentMenu = menu;
        return { ok: true };
      },
      reply: async (body) => {
        listTexts.push(body);
      },
    },
    main
  );
  ok(sentMenu === main, "replyMenu يرسل التفاعلي عند التوفر");
  ok(
    listTexts.some((body) => String(body).includes("1- تمويل شخصي")),
    "القائمة تُرسل نصاً أيضاً حتى لو نجح التفاعلي ولم يظهر على الجوال"
  );

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

  const spec = buildMenuPollSpec(main);
  ok(
    spec &&
      spec.question.includes("مانوع استفسارك") &&
      spec.options.length === 7 &&
      spec.options[0] === "تمويل شخصي" &&
      spec.options[6] === "سياسة الرواتب المطلوبة" &&
      !spec.options.some((name) => /^\d+-/.test(name)),
    "واتساب ويب يحوّل القائمة إلى خيارات تُضغط بدون ترقيم"
  );
  ok(
    buildMenuPollSpec(menus.yesNo("هل ترغب؟")).options.join(",") === "نعم,لا",
    "سؤال نعم/لا يصير خيارين قابلين للضغط"
  );

  setPollFactory((question, options) => ({ question, options }));
  let tapped = null;
  await replyMenu(
    {
      from: "966501234567@c.us",
      client: {},
      reply: async (content) => {
        tapped = content;
        return { id: { _serialized: "POLL123" } };
      },
    },
    main
  );
  ok(
    tapped && tapped.options[0] === "تمويل شخصي" && tapped.options.length === 7,
    "replyMenu على واتساب ويب يرسل الخيارات القابلة للضغط لا النص المرقم"
  );

  let numberedAfterPollFail = "";
  setPollFactory(() => {
    throw new Error("poll rejected");
  });
  await replyMenu(
    {
      from: "966501234567@c.us",
      client: {},
      reply: async (body) => {
        numberedAfterPollFail = body;
      },
    },
    main
  );
  ok(
    numberedAfterPollFail.includes("1- تمويل شخصي"),
    "إذا فشل الاختيار القابل للضغط نرجع للنص المرقم"
  );
  setPollFactory(null);

  resetMenuPolls();
  const savedId = rememberMenuPoll(
    { id: { _serialized: "POLL123" } },
    spec,
    "966501234567@c.us"
  );
  ok(savedId === "POLL123", "يُحفظ معرّف رسالة الاختيار");
  const picked = resolveMenuPollVote({
    voter: "966501234567@lid",
    selectedOptions: [{ name: "تمويل شخصي" }],
    parentMessage: { id: { _serialized: "POLL123" }, fromMe: true, to: "ignored" },
  });
  ok(
    picked &&
      picked.chatId === "966501234567@c.us" &&
      picked.body === "تمويل شخصي" &&
      picked.selectedId === "1",
    "ضغط الخيار يرجع عنوانه ومعرفه لنفس مسار القائمة"
  );
  ok(
    resolveMenuPollVote(
      {
        voter: "966507009290@c.us",
        selectedOptions: [{ name: "تمويل شخصي" }],
        parentMessage: { id: { _serialized: "POLL123" } },
      },
      { selfIds: ["966507009290@c.us"] }
    ) === null,
    "تصويت رقم البوت نفسه لا يُعالج كرد عميل"
  );
  resetMenuPolls();

  const metaMsg = createMetaMessage({
    phone: "966501234567",
    body: "اعادة",
    messageId: "wamid.test",
  });
  ok(
    typeof metaMsg.sendInteractive === "function",
    "مسار Meta فيه sendInteractive حتى لا تختفي الأزرار هناك"
  );

  ok(
    isSessionWindowError({
      message: "Interakt 400: User has not messaged within last 24 hours",
    }),
    "جلسة 24 ساعة تُكتشف من رسالة Interakt"
  );
  ok(
    !isSessionWindowError({ message: "invalid session token" }),
    "كلمة session العامة لا تُعتبر خطأ نافذة 24 ساعة"
  );
  ok(
    isTimeoutError({ status: 408, message: "Interakt timeout after 2500ms" }),
    "مهلة الإرسال تُكتشف حتى نرجع للنص"
  );
  rememberInteractiveType("list", "List");
  const ordered = orderInteractiveVariants("list", [
    { type: "InteractiveList" },
    { type: "List" },
  ]);
  ok(ordered[0].type === "List", "نوع القائمة الذي نجح سابقاً يُجرَّب أولاً");
  rememberInteractiveType("list", "");

  ok(
    nextInteractiveAttempt("list", {}) === "list",
    "القائمة تُجرَّب أولاً عندما لا يكون هناك فشل"
  );
  ok(
    nextInteractiveAttempt("list", { listFailed: true }) === "buttons",
    "مهلة القائمة أو رفضها يحوّل نفس الخيارات إلى أزرار لا إلى نص"
  );
  ok(
    nextInteractiveAttempt("list", { listPaused: true }) === "buttons",
    "بعد إيقاف القائمة مؤقتاً نرسل أزراراً بدون انتظار القائمة"
  );
  ok(
    nextInteractiveAttempt("buttons", { listPaused: true, listFailed: true }) ===
      "buttons",
    "فشل القائمة لا يوقف قوالب الأزرار مثل سنوات التمويل أو طريقة التقديم"
  );
  ok(
    nextInteractiveAttempt("list", {
      listFailed: true,
      buttonsPaused: true,
    }) === "text",
    "النص المرقّم فقط إذا فشلت الأزرار أيضاً"
  );
  ok(
    nextInteractiveAttempt("list", { sessionWindow: true }) === "text" &&
      nextInteractiveAttempt("buttons", { sessionWindow: true }) === "text",
    "خارج نافذة 24 ساعة لا نعيد محاولة التفاعل"
  );

  const { resolveInboundBody, parseButtonClick } = require("../lib/interakt-webhook");
  const { handleIncomingMessage } = require("../lib/handlers");
  const sessionStore = require("../lib/session");

  const buttonBody = resolveInboundBody(
    {
      message_content_type: "InteractiveButtonReply",
      message: "هل ترغب بمبلغ تمويل أقل؟",
      button_text: "نعم",
    },
    "1"
  );
  ok(buttonBody === "نعم", "ضغطة نعم لا تُقرأ كنص السؤال");

  const click = parseButtonClick({
    type: "message_api_clicked",
    data: {
      customer: { channel_phone_number: "966545881234" },
      message: {
        id: "btn1",
        button_text: "نعم",
        click_type: "QR",
        message: "هل ترغب بمبلغ تمويل أقل؟",
      },
    },
  });
  ok(click && click.body === "نعم", "message_api_clicked يُعامل كاختيار العميل");

  const from = "966545880099@c.us";
  sessionStore.clearSession(from);
  sessionStore.startSession(from);
  const session = sessionStore.getSession(from);
  session.step = "lower_amount_choice";
  session.roundedAmount = 55000;
  const sent = { texts: [], menus: [] };
  const yesMsg = {
    from,
    body: "نعم",
    type: "chat",
    sendInteractive: async (menu) => {
      sent.menus.push(menu);
      return { ok: true };
    },
    reply: async (text) => {
      sent.texts.push(text);
    },
  };
  ok(
    (await handleIncomingMessage(yesMsg)) === true,
    "نعم بعد مبلغ التمويل يُكمل المحادثة"
  );
  ok(
    sent.texts.some((t) => t.includes("50,000") && t.includes("اختر المبلغ")),
    "تُرسل قائمة المبالغ الأقل نصاً حتى لو تعطل القالب التفاعلي"
  );
  sessionStore.clearSession(from);

  function yearMsg(phone, body) {
    const sent = { texts: [], menus: [] };
    return {
      sent,
      msg: {
        from: phone,
        body,
        type: "chat",
        sendInteractive: async (menu) => {
          sent.menus.push(menu);
          return { ok: true };
        },
        reply: async (text) => {
          sent.texts.push(text);
        },
      },
    };
  }

  const yearsFrom = "966508090001@c.us";
  sessionStore.clearSession(yearsFrom);
  sessionStore.startSession(yearsFrom);
  const affordable = sessionStore.getSession(yearsFrom);
  affordable.step = "loan_term_pick";
  affordable.jobCategory = "civilian";
  affordable.jobType = "مدني";
  affordable.salary = 8000;
  affordable.commitments = 0;
  affordable.realEstate = "none";
  affordable.selectedAmount = 25000;
  const pickedYears = yearMsg(yearsFrom, "3 سنوات");
  ok(
    (await handleIncomingMessage(pickedYears.msg)) === true,
    "اختيار 3 سنوات يُعالَج"
  );
  ok(
    pickedYears.sent.texts.some((t) => String(t).includes("مبلغ التمويل:")),
    "بعد السنوات تصل تفاصيل الحسبة نصاً"
  );
  ok(
    sessionStore.getSession(yearsFrom)?.step === "application_method",
    "بعد السنوات يُسأل عن طريقة التقديم"
  );
  sessionStore.clearSession(yearsFrom);

  sessionStore.startSession(yearsFrom);
  const tight = sessionStore.getSession(yearsFrom);
  tight.step = "loan_term_pick";
  tight.jobCategory = "civilian";
  tight.jobType = "مدني";
  tight.salary = 4000;
  tight.commitments = 0;
  tight.realEstate = "none";
  tight.selectedAmount = 45000;
  const shortTerm = yearMsg(yearsFrom, "3 سنوات");
  ok(
    (await handleIncomingMessage(shortTerm.msg)) === true,
    "مدة أقصر من القدرة تُعالَج"
  );
  ok(
    shortTerm.sent.texts.some(
      (t) =>
        String(t).includes("المدة المسموحة") &&
        String(t).includes("5- 5 سنوات")
    ),
    "السنوات المسموحة تُرسل نصاً حتى لو لم تظهر القائمة"
  );
  ok(
    !shortTerm.sent.texts.some((t) => String(t).includes("مبلغ التمويل:")),
    "لا تُعرض حسبة لمدة لا تناسب الالتزام"
  );
  sessionStore.clearSession(yearsFrom);

  const debtFrom = "966506570099@c.us";
  sessionStore.clearSession(debtFrom);
  sessionStore.startSession(debtFrom);
  const debt = sessionStore.getSession(debtFrom);
  debt.flow = "debt_purchase";
  debt.step = "commitments";
  debt.jobCategory = "civilian";
  debt.salary = 12000;
  debt.realEstate = "supported";
  debt.supportAmount = 414;
  const commitments = yearMsg(debtFrom, "11498");
  ok(
    (await handleIncomingMessage(commitments.msg)) === true,
    "التزامات شراء المديونية تُعالَج"
  );
  ok(
    commitments.sent.texts.some((t) =>
      String(t).includes("كم مبلغ شراء المديونية")
    ),
    "بعد الالتزامات يُسأل عن مبلغ المديونية نصاً"
  );
  sessionStore.clearSession(debtFrom);

  sessionStore.startSession(debtFrom);
  const menuSession = sessionStore.getSession(debtFrom);
  menuSession.step = "inquiry_type";
  const unknown = yearMsg(debtFrom, "11498");
  ok(
    (await handleIncomingMessage(unknown.msg)) === true,
    "رقم غير مفهوم على القائمة لا يُسكت البوت"
  );
  ok(
    unknown.sent.texts.some((t) => String(t).includes("تمويل شخصي")),
    "القائمة تُعاد نصاً عند جواب غير مفهوم"
  );
  sessionStore.clearSession(debtFrom);

  sessionStore.startSession(debtFrom);
  sessionStore.closeRejected(debtFrom);
  const closedReply = yearMsg(debtFrom, "11498");
  ok(
    (await handleIncomingMessage(closedReply.msg)) === false,
    "الجلسة المغلقة لا ترسل رسالة انقطعت الحسبة"
  );
  ok(
    !closedReply.sent.texts.some((t) => String(t).includes("انقطعت الحسبة")),
    "لا نص انقطاع بعد إغلاق الجلسة"
  );
  sessionStore.clearSession(debtFrom);

  console.log("smoke-interactive-menus: OK");
})().catch((err) => {
  console.error("smoke-interactive-menus FAILED:", err);
  process.exit(1);
});
