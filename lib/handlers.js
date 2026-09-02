/**
 * معالجات خطوات المحادثة — نفس ترتيب الأسئلة والشروط كالنسخة السابقة.
 *
 * تدفقات:
 * 1) inquiry_type → 7 خيارات (شخصي | مديونية | إيقاف خدمات | دوام | موقع | مابعد البيع | سياسة الرواتب)
 * 2) المسار 3 (إيقاف خدمات): راتب≥7000 وبلا عقاري؟ → الباقة → نعم؟ → رقمين مندوبين
 * 3) المسار 1 (شخصي) — جميع القطاعات (تفاصيل في config.personalFinancingPath):
 *    مشترك: قطاع → راتب → عقاري → التزامات → تفاصيل الحسبة → مبلغ أقل؟
 *           (لا → تقديم | نعم → اختيار مبلغ → سنوات → تقديم)
 *    عسكري: ≥10,000 بدل نائية؛ <10,000 + لا عقاري + ≥7,000 → باقة فقط؛ <10,000 + عقاري → رفض
 *    مدني/متقاعد: حسبة شخصية أولاً؛ باقة إن فشل الحد → شروط الباقة + رقم المندوب فقط
 * 4) شراء مديونية (config.debtPurchasePath): قطاع → راتب → عقاري → التزامات → مبلغ المديونية → عرض → تكمل؟
 *    عسكري <10k + لا عقاري: باقة؛ رفض الباقة → اعتذار | مدني/متقاعد لا عقاري 7k+: باقة بعد الالتزامات أو مباشرة للمبلغ
 * 5) إيقاف خدمات: سؤال التأهيل → الباقة → رقمين المندوبين
 */
const CONFIG = require("../config");
const messages = require("./messages");
const {
  calculateEstimatedAmount,
  meetsMinimumEstimatedAmount,
  meetsMinimumSalary,
  meetsMinimumSalaryForEntry,
  shouldOfferPropertyComboForDebt,
  shouldOfferPropertyComboToMilitary,
  isMilitaryBelowPersonalMinSalary,
  needsMilitaryRemoteAllowanceCheck,
  roundDownToStep,
  buildLowerAmountTiers,
  getEffectiveSalary,
  getMinSalaryForEntry,
  qualifiesForPropertyCombo,
  resolveComboRejectReason,
  resolveFinalRejectReason,
  isLoanTermAffordable,
  listAffordableLoanTermYears,
  capEstimatedAmountToAffordable,
} = require("./calculations");
const {
  normalizeText,
  cleanNumber,
  isYes,
  isNo,
  parseRealEstateChoice,
  parseInquiryType,
  parseAfterSalesChoice,
  parseCivilianSector,
  parseJobType,
  isElectronicApplication,
  isBranchVisit,
  parseNumberedOption,
  parseLoanTermYears,
  matchesStartKeyword,
} = require("./validators");
const sessionStore = require("./session");
const { replyToMessage, replyMenu } = require("./reply");
const menus = require("./menus");
const { calculateDebtPurchaseOffer } = require("./debt-purchase");
const {
  resolveInterestRate,
  resolveDebtPurchaseInterestRate,
  resolveJobCategory,
} = require("./interest-rate");
const { getComboPackage } = require("./property-combo");
const { allowsAssistantContact } = require("./wa-account-agents");
const autoReplyControl = require("./auto-reply-control");
const callStats = require("./call-stats");
const customerLeads = require("./customer-leads");
const {
  extractOrderNumber,
  isLikelyOrderReply,
} = require("./order-number");
const {
  isOwnerControlMessage,
  tryHandleOwnerRemoteControl,
} = require("./owner-remote-control");
const {
  phoneToWhatsAppDigits,
  normalizeSaudiDisplay,
} = require("./contact-phone");

async function tryReplyOrderNumberCapture(msg, from, text, session) {
  if (!extractOrderNumber(text)) return false;

  const closed = sessionStore.isClosed(from)
    ? sessionStore.getClosedState(from)
    : null;

  // أثناء محادثة البوت (قبل إرسال الرابط) — لا نلتقط أرقام قد تكون راتباً
  if (session && !closed) return false;

  const allowBroad =
    isLikelyOrderReply(text) || closed?.type === "success";
  if (!allowBroad) return false;

  const captured = await customerLeads.tryCaptureOrderNumberFromMessage(
    msg,
    text,
    session
  );
  if (!captured?.ok) return false;

  if (captured.updated) {
    await replyToMessage(msg, messages.orderNumberRecordedMessage());
  }
  return true;
}

async function replyReject(msg, from, session, reasonKey) {
  if (session && reasonKey) session.rejectReason = reasonKey;
  await replyToMessage(msg, sessionStore.closeRejected(from));
}
const { attachPhoneToSession } = require("./contact-phone");

function isDebtFlow(session) {
  return session.flow === "debt_purchase";
}

function isEarlySalaryFlow(session) {
  return session.financeType === "شخصي";
}

async function continueAfterEarlySalary(msg, session) {
  if (session.jobCategory === "military" && needsMilitaryRemoteAllowanceCheck(session)) {
    session.step = "remote_allowance_check";
    await replyMenu(msg, menus.yesNo("هل لديك بدل مناطق نائية؟\n\n(يُخصم من راتبك الأساسي قبل الحسبة)"));
    return;
  }
  if (session.jobCategory === "military") {
    session.remoteAllowance = 0;
    session.salary = getEffectiveSalary(
      session.grossSalary,
      session.remoteAllowance
    );
  }
  await continueAfterRemoteAllowance(msg, session);
}

async function continueAfterRemoteAllowance(msg, session) {
  if (isDebtFlow(session)) {
    session.step = "real_estate";
    await replyMenu(msg, menus.realEstate());
    return;
  }
  session.step = "real_estate";
  await replyMenu(msg, menus.realEstate());
}

const {
  searchApprovedCompanies,
} = require("./approved-companies");

const { restartKeywords, menuStartKeywords } = CONFIG.session;

function isMenuStartTrigger(text) {
  const keywords = menuStartKeywords || ["مرحبا", "هلا", "1"];
  return matchesStartKeyword(text, keywords);
}

async function openMainMenu(msg, from) {
  sessionStore.resetUser(from);
  sessionStore.startSession(from);
  const session = sessionStore.getSession(from);
  await attachPhoneToSession(msg, session);
  const ownerControls = isOwnerControlMessage(msg, session);
  console.log(
    "[menu] قائمة رئيسية",
    ownerControls ? "مع تحكم المالك" : "عميل",
    "| from:",
    from,
    "| phone:",
    msg._interaktPhone || session?.whatsappNumber || session?.phoneDisplay || "-"
  );
  if (ownerControls) {
    // أزرار مباشرة أولاً — أوضح من صفوف القائمة السفلية
    await replyMenu(msg, menus.ownerAutoReplyControls());
  }
  await replyMenu(msg, menus.inquiryMain({ ownerControls }));
  return true;
}

const { jobCategories } = CONFIG;

const { oldMortgageInstallment } = CONFIG.financing;

const REAL_ESTATE_LABELS = {
  supported: "عقاري مدعوم",
  unsupported: "عقاري غير مدعوم",
  none: "لا يوجد عقاري",
  old: "تمويل عقاري قديم (قسط 1667)",
};

function isTextLikeMessage(msg) {
  const type = String(msg?.type || "chat");
  if (type === "chat") return true;
  if (type === "buttons_response" || type === "list_response") {
    return Boolean(String(msg?.body || "").trim());
  }
  return false;
}

/**
 * نقطة دخول واحدة لكل رسالة واردة (بعد فلاتر bot.js).
 * @returns {Promise<boolean>} true إذا تم الرد على العميل
 */
async function handleIncomingMessage(msg) {
  const from = msg.from;
  const text = normalizeText(msg.body);

  // إيقاف/تشغيل الرد الآلي للمالك فقط (أزرار القائمة / رقم التحكم / اللوحة)
  // العميل لا يستطيع إيقاف الرد الآلي بنص stop/start

  let session = sessionStore.getSession(from);
  if (session) {
    sessionStore.ensureSessionWaAccount(session);
    await attachPhoneToSession(msg, session);
  }

  // أزرار إيقاف/تشغيل الرد الآلي للمالك — من أي خطوة
  if (isOwnerControlMessage(msg, session)) {
    const ownerChoice = parseInquiryType(text);
    if (ownerChoice === "pause_auto_reply" || ownerChoice === "resume_auto_reply") {
      const fromPhone =
        msg._interaktPhone ||
        msg._metaPhone ||
        phoneToWhatsAppDigits(session?.whatsappNumber || msg.from) ||
        msg.from;
      const cmdText = ownerChoice === "pause_auto_reply" ? "stop" : "start";
      await tryHandleOwnerRemoteControl(fromPhone, cmdText, {
        send: async (_chatId, body) => {
          await replyToMessage(msg, body);
        },
      });
      return true;
    }
    // اختصار: اكتب «تحكم» لعرض زرّي الإيقاف/التشغيل فقط
    if (text === "تحكم" || text === "التحكم") {
      await replyMenu(msg, menus.ownerAutoReplyControls());
      return true;
    }
  } else if (text === "تحكم" || text === "التحكم") {
    const detected =
      normalizeSaudiDisplay(
        msg._interaktPhone ||
          msg._metaPhone ||
          session?.whatsappNumber ||
          msg.from
      ) ||
      phoneToWhatsAppDigits(
        msg._interaktPhone || session?.whatsappNumber || msg.from
      ) ||
      "غير معروف";
    await replyToMessage(
      msg,
      "هذا الرقم غير مسجّل كجوال تحكم منفصل.\n\n" +
        `الرقم الذي وصل للبوت: ${detected}\n\n` +
        "إذا رقم البوت هو واتساب عملك: لا يظهر زر خاص داخل قائمة العميل.\n" +
        "أوقف الرد من سجل العملاء (زر إيقاف الرد الآلي) أو اكتب stop داخل شات العميل من صندوق Interakt.\n\n" +
        "اختياري: من اللوحة → الإعدادات → أضف جوالك الشخصي (غير رقم البوت) ثم أعد إرسال: تحكم"
    );
    return true;
  }

  // «إعادة» / reset → إعادة الجلسة من القائمة الرئيسية
  // مرحبا / هلا → نفس السلوك (و«1» خارج الجلسة عبر المسار أدناه)
  if (sessionStore.isResetCommand(text) || matchesStartKeyword(text, restartKeywords)) {
    return openMainMenu(msg, from);
  }

  if (await tryReplyOrderNumberCapture(msg, from, text, session)) {
    return true;
  }

  if (sessionStore.isClosed(from)) {
    if (!isMenuStartTrigger(text)) {
      return false;
    }
    if (text === "1") {
      sessionStore.tryRetry(from);
    }
    return openMainMenu(msg, from);
  }

  if (!session) {
    if (!isMenuStartTrigger(text)) {
      return false;
    }
    return openMainMenu(msg, from);
  }

  if (!isTextLikeMessage(msg)) {
    await replyToMessage(msg, messages.nonTextMessage());
    return true;
  }

  switch (session.step) {
    case "inquiry_type":
    case "finance_type":
      return handleInquiryType(msg, session, text);
    case "after_sales_choice":
      return handleAfterSalesChoice(msg, from, session, text);
    case "after_sales_details":
      return handleAfterSalesDetails(msg, from, session, text);
    case "job_type":
      return handleJobType(msg, session, text);
    case "civilian_sector":
      return handleCivilianSector(msg, session, text);
    case "company_search":
      return handleCompanySearch(msg, from, session, text);
    case "company_pick":
      return handleCompanyPick(msg, from, session, text);
    case "remote_allowance_check":
      return handleRemoteAllowanceCheck(msg, session, text);
    case "remote_allowance_amount":
      return handleRemoteAllowanceAmount(msg, session, text);
    case "military_combo_offer":
      return handleMilitaryComboOffer(msg, from, session, text);
    case "service_stop_qualify":
      return handleServiceStopQualify(msg, from, session, text);
    case "service_stop_combo":
      return handleServiceStopCombo(msg, from, session, text);
    case "real_estate":
      return handleRealEstate(msg, session, text);
    case "support_amount":
      return handleSupportAmount(msg, session, text);
    case "salary":
      return handleSalary(msg, from, session, text);
    case "commitments":
      return handleCommitments(msg, from, session, text);
    case "lower_amount_choice":
      return handleLowerAmountChoice(msg, from, session, text);
    case "lower_amount_pick":
      return handleLowerAmountPick(msg, from, session, text);
    case "loan_term_pick":
      return handleLoanTermPick(msg, from, session, text);
    case "application_method":
      return handleApplicationMethod(msg, from, session, text);
    case "contact_employee":
      return handleContactEmployee(msg, from, session, text);
    case "service_stop_contact":
    case "property_combo_contact":
      return handleServiceStopContact(msg, from, session, text);
    case "debt_purchase_amount":
      return handleDebtPurchaseAmount(msg, from, session, text);
    case "debt_continue":
      return handleDebtContinue(msg, from, session, text);
    default:
      // خطوة غير معروفة — إنهاء صامت؛ القائمة فقط بكلمات البدء
      sessionStore.resetUser(from);
      return false;
  }
}

// ---------------------------------------------------------------------------
// القائمة الرئيسية — 7 خيارات
// ---------------------------------------------------------------------------

async function handleInquiryType(msg, session, text) {
  const choice = parseInquiryType(text);
  const ownerControls = isOwnerControlMessage(msg, session);

  if (choice === "assistant_contact" && !allowsAssistantContact()) {
    await replyMenu(msg, menus.inquiryInvalid({ ownerControls }));
    return true;
  }

  // خيارات إيقاف/تشغيل الرد الآلي — ظاهرة وتعمل لأرقام التحكم فقط
  if (choice === "pause_auto_reply" || choice === "resume_auto_reply") {
    if (!ownerControls) {
      await replyMenu(msg, menus.inquiryInvalid({ ownerControls: false }));
      return true;
    }
    const fromPhone =
      msg._interaktPhone ||
      msg._metaPhone ||
      phoneToWhatsAppDigits(msg.from) ||
      msg.from;
    const cmdText = choice === "pause_auto_reply" ? "stop" : "start";
    const send = async (_chatId, body) => {
      await replyToMessage(msg, body);
    };
    await tryHandleOwnerRemoteControl(fromPhone, cmdText, { send });
    sessionStore.resetUser(msg.from);
    return true;
  }

  if (choice === "personal") {
    callStats.recordInquiryType("personal");
    session.inquiryType = "تمويل شخصي";
    session.financeType = "شخصي";
    session.step = "job_type";
    await replyMenu(msg, menus.jobType());
    return true;
  }

  if (choice === "debt_purchase") {
    callStats.recordInquiryType("debt_purchase");
    session.inquiryType = "شراء مديونية";
    session.flow = "debt_purchase";
    session.financeType = "شراء مديونية";
    session.step = "job_type";
    await replyMenu(msg, menus.jobType());
    return true;
  }

  if (choice === "service_stop") {
    callStats.recordInquiryType("service_stop");
    session.inquiryType = "إيقاف خدمات";
    session.flow = "service_stop";
    session.step = "service_stop_qualify";
    await replyMenu(
      msg,
      menus.yesNo(messages.serviceStopQualifyQuestionMessage())
    );
    return true;
  }

  if (choice === "hours") {
    callStats.recordInquiryType("hours");
    session.inquiryType = "ساعات الدوام";
    await replyToMessage(msg, messages.workingHoursMessage());
    // لا نعيد القائمة تلقائياً — العميل يكتب مرحبا/هلا/1 إن أراد
    sessionStore.resetUser(msg.from);
    return true;
  }

  if (choice === "location") {
    callStats.recordInquiryType("location");
    session.inquiryType = "موقعنا";
    await replyToMessage(msg, messages.locationInfoMessage());
    sessionStore.resetUser(msg.from);
    return true;
  }

  if (choice === "assistant_contact") {
    callStats.recordInquiryType("assistant_contact");
    session.inquiryType = "رقم المساعد";
    await replyToMessage(msg, messages.assistantContactMessage());
    session.step = "inquiry_type";
    return true;
  }

  if (choice === "after_sales") {
    callStats.recordInquiryType("after_sales");
    session.inquiryType = "خدمات مابعد البيع";
    session.step = "after_sales_choice";
    await replyMenu(msg, menus.afterSales());
    return true;
  }

  if (choice === "salary_policy") {
    callStats.recordInquiryType("salary_policy");
    session.inquiryType = "سياسة الرواتب المطلوبة";
    await replyToMessage(msg, messages.salaryPolicyNoteMessage());
    sessionStore.resetUser(msg.from);
    return true;
  }

  // خارج خيارات القائمة — صمت حتى يرد الذكاء الاصطناعي أو الموظف
  return false;
}

async function handleAfterSalesChoice(msg, from, session, text) {
  const choice = parseAfterSalesChoice(text);

  if (choice === "early_payoff") {
    session.afterSalesType = "سداد مبكر";
    session.step = "after_sales_details";
    await replyToMessage(msg, messages.afterSalesEarlyPayoffMessage());
    return true;
  }

  if (choice === "collection_issue") {
    session.afterSalesType = "مشكلة بالتحصيل";
    session.step = "after_sales_details";
    await replyToMessage(msg, messages.afterSalesCollectionIssueMessage());
    return true;
  }

  if (choice === "complaint") {
    session.afterSalesType = "شكاوى";
    session.step = "after_sales_details";
    await replyToMessage(msg, messages.afterSalesComplaintMessage());
    return true;
  }

  await replyMenu(msg, menus.afterSales());
  return true;
}

async function handleAfterSalesDetails(msg, from, session, text) {
  const details = String(text || "").trim();
  if (!details || details.length < 3) {
    await replyToMessage(
      msg,
      "الرجاء إرسال البيانات المطلوبة بشكل واضح."
    );
    return true;
  }

  session.afterSalesDetails = details;
  messages.captureContactOnSession(session, "branch");
  await replyToMessage(msg, messages.afterSalesDetailsReceivedMessage());
  sessionStore.closeSuccess(from);
  return true;
}

// ---------------------------------------------------------------------------
// مسار التمويل الشخصي — نوع العمل (عسكري / مدني / متقاعد)
// ---------------------------------------------------------------------------

async function proceedToSalary(msg, session) {
  session.step = "salary";
  await replyToMessage(msg, messages.salaryMessage(session));
}

async function handleJobType(msg, session, text) {
  const job = parseJobType(text);
  const category = job ? jobCategories[job] : null;

  if (category) {
    session.jobCategory = job;
    session.jobType = category.label;
    session.interestRate = Number(category.interestRate);
    session.remoteAllowance = 0;

    if (job === "retired") {
      await replyToMessage(msg, messages.retiredAgeNoticeMessage());
    }

    if (job === "civilian") {
      session.step = "civilian_sector";
      await replyMenu(msg, menus.civilianSector());
      return true;
    }

    await proceedToSalary(msg, session);
    return true;
  }

  await replyMenu(msg, menus.jobTypeInvalid());
  return true;
}

async function handleCivilianSector(msg, session, text) {
  const sector = parseCivilianSector(text);
  if (!sector) {
    await replyMenu(msg, menus.civilianSector());
    return true;
  }

  session.civilianSector = sector;
  session.civilianSectorLabel =
    sector === "government" ? "حكومي" : "قطاع خاص";

  // البحث في الشركات المعتمدة للقطاع الخاص فقط
  if (sector === "private") {
    session.step = "company_search";
    await promptCompanySearch(msg);
    return true;
  }

  await proceedToSalary(msg, session);
  return true;
}

async function promptCompanySearch(msg) {
  await replyToMessage(msg, messages.companySearchPromptMessage());
}

async function acceptApprovedCompany(msg, session, companyName) {
  session.employerCompany = companyName;
  session.employerApproved = true;
  await replyToMessage(msg, messages.companyApprovedMessage(companyName));
  await proceedToSalary(msg, session);
  return true;
}

async function handleCompanySearch(msg, from, session, text) {
  const query = String(text || "").trim();

  // تجاهل زر حسناً القديم إن بقي ظاهراً، أو إعادة إرسال قطاع خاص بالخطأ
  if (
    !query ||
    query.length < 2 ||
    query === "co_ok" ||
    query === "حسناً" ||
    query === "حسنا" ||
    parseCivilianSector(query)
  ) {
    await promptCompanySearch(msg);
    return true;
  }

  // اختيار من نتائج سابقة بالعنوان الكامل
  if (session.companyMatchOptions?.includes(query)) {
    return acceptApprovedCompany(msg, session, query);
  }

  const matches = searchApprovedCompanies(query, 10);
  if (!matches.length) {
    await replyToMessage(msg, messages.companyNotFoundMessage());
    await promptCompanySearch(msg);
    return true;
  }

  if (matches.length === 1) {
    return acceptApprovedCompany(msg, session, matches[0]);
  }

  session.companyMatchOptions = matches.slice(0, 9);
  session.step = "company_pick";
  await replyMenu(msg, menus.companyMatches(session.companyMatchOptions));
  return true;
}

function wantsCompanyResearch(text) {
  const t = String(text || "").trim();
  if (t === "co_research") return true;
  if (
    t.includes("إعادة البحث") ||
    t.includes("اعادة البحث") ||
    t.includes("إعادة بحث") ||
    t.includes("اعادة بحث") ||
    t.includes("البحث مجددا")
  ) {
    return true;
  }
  return false;
}

async function restartCompanySearch(msg, session) {
  session.companyMatchOptions = null;
  session.step = "company_search";
  await promptCompanySearch(msg);
  return true;
}

async function handleCompanyPick(msg, from, session, text) {
  const raw = String(text || "").trim();
  const options = session.companyMatchOptions || [];

  if (wantsCompanyResearch(raw)) {
    return restartCompanySearch(msg, session);
  }

  // id مثل co_1 أو رقم الترتيب أو الاسم الكامل/المختصر
  let picked = null;
  const idMatch = raw.match(/^co_(\d+)$/i);
  if (idMatch) {
    const idx = Number(idMatch[1]) - 1;
    if (options[idx]) picked = options[idx];
  }
  if (!picked) {
    const asNum = parseInt(raw, 10);
    if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= options.length) {
      picked = options[asNum - 1];
    }
  }
  if (!picked) {
    picked = options.find(
      (name) =>
        name === raw ||
        name.startsWith(raw) ||
        raw.startsWith(String(name).slice(0, 24))
    );
  }

  if (!picked) {
    // نص جديد = بحث جديد مباشرة
    session.companyMatchOptions = null;
    session.step = "company_search";
    return handleCompanySearch(msg, from, session, text);
  }

  return acceptApprovedCompany(msg, session, picked);
}

// ---------------------------------------------------------------------------
// عسكري — بدل مناطق نائية
// ---------------------------------------------------------------------------

async function finishMilitaryRemoteAllowanceStep(msg, from, session) {
  const minEntry = getMinSalaryForEntry("military");
  if (Number(session.salary) < minEntry) {
    await replyReject(msg, from, session, "military_low_salary");
    return true;
  }
  await continueAfterRemoteAllowance(msg, session);
  return true;
}

async function handleRemoteAllowanceCheck(msg, session, text) {
  const from = msg.from;
  if (isYes(text)) {
    session.step = "remote_allowance_amount";
    await replyToMessage(msg, messages.remoteAllowanceAmountMessage());
    return true;
  }

  if (isNo(text)) {
    session.remoteAllowance = 0;
    session.salary = getEffectiveSalary(
      session.grossSalary,
      session.remoteAllowance
    );
    return finishMilitaryRemoteAllowanceStep(msg, from, session);
  }

  await replyMenu(msg, menus.yesNo("هل لديك بدل مناطق نائية؟"));
  return true;
}

async function handleRemoteAllowanceAmount(msg, session, text) {
  const from = msg.from;
  const allowance = cleanNumber(text);

  if (!allowance || allowance <= 0 || Number.isNaN(allowance)) {
    await replyToMessage(msg, messages.invalidRemoteAllowanceAmountMessage());
    return true;
  }

  session.remoteAllowance = allowance;
  session.salary = getEffectiveSalary(
    session.grossSalary,
    session.remoteAllowance
  );
  return finishMilitaryRemoteAllowanceStep(msg, from, session);
}

async function beginPersonalResult(msg, session, amount) {
  if (isMilitaryBelowPersonalMinSalary(session)) {
    if (shouldOfferPropertyComboToMilitary(session)) {
      return offerPropertyComboOnly(msg, session);
    }
    await replyReject(msg, msg.from, session, "military_low_salary");
    return true;
  }

  session.rawAmount =
    session.rawAmount != null ? session.rawAmount : amount;
  session.roundedAmount = roundDownToStep(amount);
  session.selectedAmount = session.roundedAmount;
  const defaultMonths = CONFIG.financing.loanTermMonths || 60;
  session.loanTermMonths = defaultMonths;
  session.loanTermYears = Math.round(defaultMonths / 12);
  callStats.recordQualified();
  customerLeads.recordQualified(msg.from, session);
  session.step = "lower_amount_choice";
  await replyToMessage(
    msg,
    messages.selectedAmountDetailMessage(session, session.selectedAmount)
  );
  await replyMenu(msg, menus.yesNo("هل ترغب بمبلغ تمويل أقل؟"));
  return true;
}

async function sendPropertyComboOffer(msg, session) {
  const reason = session.comboRejectReason;
  if (reason) {
    const apology = messages.personalRejectReasonMessage(reason);
    if (apology) await replyToMessage(msg, apology);
  }
  await replyToMessage(msg, messages.propertyComboOfferMessage(session));
  await replyMenu(msg, menus.yesNo("هل ترغب بهذا العرض؟"));
}

async function offerPropertyComboOnly(msg, session) {
  session.comboRejectReason = "military_low_salary";
  session.step = "military_combo_offer";
  await sendPropertyComboOffer(msg, session);
  return true;
}

async function beginPropertyComboResult(msg, from, session) {
  session.comboPackage = true;
  callStats.recordQualified();
  customerLeads.recordQualified(msg.from, session);
  messages.captureContactOnSession(session, "combo_agent");
  await replyToMessage(msg, messages.propertyComboAgentMessage(session));
  sessionStore.closeSuccess(from);
}

// ---------------------------------------------------------------------------
// التمويل العقاري السابق + الراتب + الالتزامات
// ---------------------------------------------------------------------------

async function handleRealEstate(msg, session, text) {
  const choice = parseRealEstateChoice(text);
  const from = msg.from;

  if (choice === "supported") {
    session.realEstate = "supported";
    session.realEstateLabel = REAL_ESTATE_LABELS.supported;
    if (isMilitaryBelowPersonalMinSalary(session)) {
      await replyReject(msg, from, session, "military_low_salary");
      return true;
    }
    session.step = "support_amount";
    await replyToMessage(msg,messages.supportAmountMessage());
    return true;
  }

  if (choice === "unsupported") {
    session.realEstate = "unsupported";
    session.realEstateLabel = REAL_ESTATE_LABELS.unsupported;
    session.supportAmount = 0;
    if (isMilitaryBelowPersonalMinSalary(session)) {
      await replyReject(msg, from, session, "military_low_salary");
      return true;
    }
    session.step = "commitments";
    await replyToMessage(msg, messages.commitmentsMessage(session));
    return true;
  }

  if (choice === "none") {
    session.realEstate = "none";
    session.realEstateLabel = REAL_ESTATE_LABELS.none;
    session.supportAmount = 0;
    if (shouldOfferPropertyComboToMilitary(session)) {
      return offerPropertyComboOnly(msg, session);
    }
    if (isMilitaryBelowPersonalMinSalary(session)) {
      await replyReject(msg, from, session, "military_low_salary");
      return true;
    }
    session.step = "commitments";
    await replyToMessage(msg, messages.commitmentsMessage(session));
    return true;
  }

  if (choice === "old") {
    session.realEstate = "old";
    session.realEstateLabel = REAL_ESTATE_LABELS.old;
    session.supportAmount = 0;
    session.presetCommitmentDeduction = oldMortgageInstallment;
    if (isMilitaryBelowPersonalMinSalary(session)) {
      await replyReject(msg, from, session, "military_low_salary");
      return true;
    }
    session.step = "commitments";
    await replyToMessage(msg, messages.commitmentsMessage(session));
    return true;
  }

  await replyMenu(msg, menus.realEstateInvalid());
  return true;
}

async function handleSupportAmount(msg, session, text) {
  const supportAmount = cleanNumber(text);

  if (supportAmount < 0 || Number.isNaN(supportAmount)) {
    await replyToMessage(msg,messages.invalidSupportAmountMessage());
    return true;
  }

  session.supportAmount = supportAmount;
  if (isMilitaryBelowPersonalMinSalary(session)) {
    await replyReject(msg, msg.from, session, "military_low_salary");
    return true;
  }
  session.step = "commitments";
  await replyToMessage(msg, messages.commitmentsMessage(session));
  return true;
}

async function handleSalary(msg, from, session, text) {
  // أزرار القطاع تبقى ظاهرة في واتساب؛ الضغط عليها أثناء سؤال الراتب
  // كان يُفهم كرقم (مثل مدني → 2) ويُرفض بالخطأ برسالة العسكري.
  const asJob = parseJobType(text);
  const grossSalary = cleanNumber(text);
  if (asJob && (!grossSalary || grossSalary < 500)) {
    return handleJobType(msg, session, text);
  }

  // أرقام الأزرار (1–9) أو قيم غير واقعية كراتب → إعادة الطلب لا إغلاق الجلسة
  if (
    !grossSalary ||
    grossSalary <= 0 ||
    Number.isNaN(grossSalary) ||
    grossSalary < 500
  ) {
    await replyToMessage(msg, messages.invalidSalaryMessage(session));
    return true;
  }

  const remoteAllowance = session.remoteAllowance || 0;
  const effectiveSalary = getEffectiveSalary(grossSalary, remoteAllowance);

  if (effectiveSalary <= 0) {
    await replyToMessage(msg, messages.invalidSalaryMessage(session));
    return true;
  }

  const salaryForMinCheck =
    session.jobCategory === "military" ? grossSalary : effectiveSalary;

  if (
    !meetsMinimumSalaryForEntry(salaryForMinCheck, session.jobCategory)
  ) {
    const reasonKey =
      session.jobCategory === "military"
        ? "military_low_salary"
        : "civilian_low_salary";
    console.warn(
      "[راتب] رفض حد أدنى",
      session.jobCategory,
      salaryForMinCheck,
      reasonKey
    );
    await replyReject(msg, from, session, reasonKey);
    return true;
  }

  session.grossSalary = grossSalary;
  session.salary = effectiveSalary;

  if (isEarlySalaryFlow(session)) {
    await continueAfterEarlySalary(msg, session);
    return true;
  }

  if (isDebtFlow(session)) {
    if (session.jobCategory === "military") {
      await continueAfterEarlySalary(msg, session);
      return true;
    }
    session.step = "real_estate";
    await replyMenu(msg, menus.realEstate());
    return true;
  }

  session.step = "commitments";
  await replyToMessage(msg, messages.commitmentsMessage(session));
  return true;
}

/**
 * العميل اختار «لا» على باقة عقاري + شخصي
 */
async function promptDebtPurchaseAmount(msg) {
  await replyToMessage(msg, messages.debtPurchaseRulesMessage());
  await replyToMessage(msg, messages.debtPurchaseAmountMessage());
}

async function continueAfterComboDeclined(msg, from, session) {
  session.comboPackage = false;

  if (isDebtFlow(session) && !isMilitaryBelowPersonalMinSalary(session)) {
    session.step = "debt_purchase_amount";
    await replyToMessage(msg, messages.propertyComboDeclinedDebtMessage());
    await promptDebtPurchaseAmount(msg);
    return true;
  }

  await replyToMessage(msg, messages.propertyComboDeclinedApologyMessage());
  sessionStore.closeRejectedFinal(from);
  return true;
}

async function handlePropertyComboOffer(msg, from, session, text) {
  if (isYes(text)) {
    await beginPropertyComboResult(msg, from, session);
    return true;
  }

  if (isNo(text)) {
    return continueAfterComboDeclined(msg, from, session);
  }

  await replyMenu(msg, menus.yesNo("هل ترغب بهذا العرض؟"));
  return true;
}

/** @deprecated */
const handleMilitaryComboOffer = handlePropertyComboOffer;

async function handleCommitments(msg, from, session, text) {
  const commitments = cleanNumber(text);

  if (commitments < 0 || Number.isNaN(commitments)) {
    await replyToMessage(msg, messages.invalidCommitmentsMessage(session));
    return true;
  }

  session.commitments = commitments;

  if (isDebtFlow(session)) {
    return continueDebtFlowAfterCommitments(msg, from, session);
  }

  if (isMilitaryBelowPersonalMinSalary(session)) {
    if (shouldOfferPropertyComboToMilitary(session)) {
      return offerPropertyComboOnly(msg, session);
    }
    await replyReject(msg, from, session, "military_low_salary");
    return true;
  }

  const presetDeduction = session.presetCommitmentDeduction || 0;
  const totalCommitments = commitments + presetDeduction;

  const rawAmount = calculateEstimatedAmount(
    session.realEstate,
    session.salary,
    totalCommitments,
    session.supportAmount || 0
  );

  // حدّ المبلغ بما يناسب أطول مدة — لا نعرض مبلغاً ثم نعتذر عند اختيار السنوات
  const rate = resolveInterestRate(session);
  const jobCategory = resolveJobCategory(session);
  const amount = capEstimatedAmountToAffordable(
    session,
    rawAmount,
    rate,
    jobCategory
  );

  if (meetsMinimumEstimatedAmount(amount)) {
    session.rawAmount = rawAmount;
    await beginPersonalResult(msg, session, amount);
    return true;
  }

  if (qualifiesForPropertyCombo(session, amount, totalCommitments)) {
    session.comboRejectReason = resolveComboRejectReason(
      session,
      amount,
      totalCommitments
    );
    session.step = "military_combo_offer";
    await sendPropertyComboOffer(msg, session);
    return true;
  }

  await replyReject(
    msg,
    from,
    session,
    resolveFinalRejectReason(session, amount, totalCommitments)
  );
  return true;
}

async function continueDebtFlowAfterCommitments(msg, from, session) {
  if (isMilitaryBelowPersonalMinSalary(session)) {
    if (shouldOfferPropertyComboToMilitary(session)) {
      return offerPropertyComboOnly(msg, session);
    }
    await replyReject(msg, from, session, "military_low_salary");
    return true;
  }
  if (shouldOfferPropertyComboForDebt(session)) {
    session.comboRejectReason = null;
    session.step = "military_combo_offer";
    await sendPropertyComboOffer(msg, session);
    return true;
  }
  session.step = "debt_purchase_amount";
  await promptDebtPurchaseAmount(msg);
  return true;
}

function loanTermYearsOptions() {
  return CONFIG.financing.loanTermYearsOptions || [1, 2, 3, 4, 5];
}

async function promptLoanTerm(msg, session) {
  session.step = "loan_term_pick";
  delete session.allowedLoanTermYears;
  await replyMenu(msg, menus.loanTermYears(loanTermYearsOptions()));
}

async function promptApplicationMethod(msg, session) {
  session.step = "application_method";
  await replyMenu(msg, menus.applicationMethod());
}

async function handleLowerAmountChoice(msg, from, session, text) {
  if (isYes(text)) {
    const tiers = buildLowerAmountTiers(session.roundedAmount);
    if (tiers.length === 0) {
      // لا توجد مبالغ أقل — نبقى على العرض الافتراضي دون سؤال السنوات
      session.selectedAmount = session.roundedAmount;
      await promptApplicationMethod(msg, session);
      return true;
    }
    const displayTiers = menus.shrinkTiersForWhatsAppList(tiers, 10);
    session.lowerAmountTiers = displayTiers;
    session.step = "lower_amount_pick";
    await replyMenu(msg, menus.lowerAmountTiers(displayTiers));
    return true;
  }

  if (isNo(text)) {
    // رفض مبلغ أقل: نثبت العرض الحالي (مدة افتراضية) ونتجه للتقديم مباشرة
    session.selectedAmount = session.roundedAmount;
    await promptApplicationMethod(msg, session);
    return true;
  }

  await replyMenu(msg, menus.yesNo("هل ترغب بمبلغ تمويل أقل؟"));
  return true;
}

async function handleLowerAmountPick(msg, from, session, text) {
  const tiers = session.lowerAmountTiers || [];
  let amount = null;

  // قائمة واتساب تُرجع العنوان («15,000») أو معرف المبلغ — ليس رقم الترتيب فقط
  const byValue = cleanNumber(text);
  if (byValue > 0) {
    const match = tiers.find((tier) => Number(tier) === byValue);
    if (match != null) amount = Number(match);
  }

  if (amount == null) {
    const choice = parseNumberedOption(text, tiers.length);
    if (choice) amount = Number(tiers[choice - 1]);
  }

  if (amount == null || Number.isNaN(amount)) {
    await replyMenu(
      msg,
      menus.lowerAmountTiers(session.lowerAmountTiers || tiers)
    );
    return true;
  }

  session.selectedAmount = amount;
  await promptLoanTerm(msg, session);
  return true;
}

async function handleLoanTermPick(msg, from, session, text) {
  const allOptions = loanTermYearsOptions();
  const pickOptions =
    Array.isArray(session.allowedLoanTermYears) &&
    session.allowedLoanTermYears.length
      ? session.allowedLoanTermYears
      : allOptions;
  const years = parseLoanTermYears(text, pickOptions);

  if (years == null) {
    await replyMenu(
      msg,
      session.allowedLoanTermYears?.length
        ? menus.loanTermYearsAllowedInvalid(session.allowedLoanTermYears)
        : menus.loanTermYearsInvalid(allOptions)
    );
    return true;
  }

  const amount = session.selectedAmount;
  const rate = resolveInterestRate(session);
  const jobCategory = resolveJobCategory(session);

  // اختيار من قائمة السنوات المسموحة مسبقاً
  if (session.allowedLoanTermYears?.length) {
    const allowedSet = new Set(
      session.allowedLoanTermYears.map((y) => Number(y))
    );
    if (!allowedSet.has(Number(years))) {
      await replyMenu(
        msg,
        menus.loanTermYearsAllowedInvalid(session.allowedLoanTermYears)
      );
      return true;
    }
    session.loanTermYears = years;
    session.loanTermMonths = years * 12;
    await replyToMessage(
      msg,
      messages.selectedAmountDetailMessage(session, amount)
    );
    await promptApplicationMethod(msg, session);
    return true;
  }

  // الاختيار الأول من 1–5: إن لم يناسب الالتزامات → قائمة المدد المسموحة فقط
  if (!isLoanTermAffordable(session, amount, years, rate, jobCategory)) {
    const affordable = listAffordableLoanTermYears(
      session,
      amount,
      rate,
      jobCategory,
      allOptions
    );
    if (!affordable.length) {
      await replyReject(msg, from, session, "high_commitments");
      return true;
    }
    session.allowedLoanTermYears = affordable;
    await replyMenu(msg, menus.loanTermYearsAllowed(affordable));
    return true;
  }

  session.loanTermYears = years;
  session.loanTermMonths = years * 12;
  await replyToMessage(
    msg,
    messages.selectedAmountDetailMessage(session, amount)
  );
  await promptApplicationMethod(msg, session);
  return true;
}

async function handleApplicationMethod(msg, from, session, text) {
  if (isElectronicApplication(text)) {
    session.applicationMethod = "electronic";
    callStats.recordApplication("electronic");
    messages.captureContactOnSession(session, "electronic");
    await replyToMessage(msg, messages.electronicApplicationMessage(session));
    sessionStore.closeSuccess(from);
    return true;
  }

  if (isBranchVisit(text)) {
    session.applicationMethod = "branch";
    callStats.recordApplication("branch");
    messages.captureContactOnSession(session, "branch");
    await replyToMessage(msg, messages.employeeContactMessage(session));
    sessionStore.closeSuccess(from);
    return true;
  }

  await replyMenu(msg, menus.applicationMethodInvalid());
  return true;
}

async function handleDebtPurchaseAmount(msg, from, session, text) {
  const debtAmount = cleanNumber(text);

  if (!debtAmount || debtAmount <= 0 || Number.isNaN(debtAmount)) {
    await replyToMessage(msg, messages.invalidDebtPurchaseAmountMessage());
    return true;
  }

  session.debtPurchaseAmount = debtAmount;
  const presetDeduction = session.presetCommitmentDeduction || 0;
  const totalCommitments = Number(session.commitments) + presetDeduction;
  const offer = calculateDebtPurchaseOffer(
    session.salary,
    totalCommitments,
    debtAmount,
    resolveDebtPurchaseInterestRate(session),
    session.jobCategory,
    session.realEstate || "none",
    session.supportAmount || 0
  );

  if (!offer.eligible) {
    await replyReject(
      msg,
      from,
      session,
      resolveFinalRejectReason(session, offer.personalCap, totalCommitments)
    );
    return true;
  }

  session.debtOffer = offer;
  session.step = "debt_continue";
  await replyToMessage(msg, messages.debtPurchaseOfferMessage(offer));
  await replyMenu(msg, menus.yesNo("هل تبي تكمل إجراءات شراء المديونية؟"));
  return true;
}

async function handleDebtContinue(msg, from, session, text) {
  if (isYes(text)) {
    messages.captureContactOnSession(session, "debt_complete");
    await replyToMessage(msg, messages.debtPurchaseCompleteMessage(session));
    sessionStore.closeSuccess(from);
    return true;
  }

  if (isNo(text)) {
    await replyToMessage(msg, messages.debtDeclinedMessage());
    sessionStore.closeSuccess(from);
    return true;
  }

  await replyMenu(msg, menus.yesNo("هل تبي تكمل إجراءات شراء المديونية؟"));
  return true;
}

async function handleContactEmployee(msg, from, session, text) {
  if (isYes(text)) {
    messages.captureContactOnSession(session, "employee");
    await replyToMessage(msg, messages.employeeContactMessage(session));
    sessionStore.closeSuccess(from);
    return true;
  }

  if (isNo(text)) {
    await replyToMessage(msg, messages.applicationCompleteNoEmployeeMessage());
    sessionStore.closeSuccess(from);
    return true;
  }

  await replyMenu(msg, menus.yesNo("هل ترغب بالتواصل مع الموظف؟"));
  return true;
}

async function handleServiceStopQualify(msg, from, session, text) {
  if (isYes(text)) {
    session.step = "service_stop_combo";
    await replyToMessage(msg, messages.serviceStopPackageMessage());
    await replyMenu(msg, menus.yesNo("هل ترغب بهذا العرض؟"));
    return true;
  }

  if (isNo(text)) {
    await replyToMessage(msg, messages.serviceStopDeclinedMessage());
    sessionStore.closeSuccess(from);
    return true;
  }

  await replyMenu(
    msg,
    menus.yesNo(messages.serviceStopQualifyQuestionMessage())
  );
  return true;
}

async function handleServiceStopCombo(msg, from, session, text) {
  if (isYes(text)) {
    session.comboPackage = true;
    callStats.recordQualified();
    customerLeads.recordQualified(msg.from, session);
    messages.captureContactOnSession(session, "service_stop");
    await replyToMessage(msg, messages.serviceStopTwoAgentsMessage());
    sessionStore.closeSuccess(from);
    return true;
  }

  if (isNo(text)) {
    await replyToMessage(msg, messages.serviceStopDeclinedMessage());
    sessionStore.closeSuccess(from);
    return true;
  }

  await replyMenu(msg, menus.yesNo("هل ترغب بهذا العرض؟"));
  return true;
}

async function handleServiceStopContact(msg, from, session, text) {
  // توافق قديم — نحوّل للمسار الجديد
  session.step = "service_stop_qualify";
  await replyMenu(
    msg,
    menus.yesNo(messages.serviceStopQualifyQuestionMessage())
  );
  return true;
}

module.exports = {
  handleIncomingMessage,
};
