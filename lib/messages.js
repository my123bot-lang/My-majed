/**
 * بناء الرسائل من CONFIG — لا منطق أعمال هنا.
 */
const CONFIG = require("../config");
const {
  buildLowerAmountTiers,
  calculateMonthlyInstallment,
  calculateTotalRepayment,
  formatMoney,
} = require("./calculations");

const { messages, templates, brand } = CONFIG;
const { loadSettingsForAccount } = require("./settings-store");
const {
  getStartMessageForAccount,
  getInvalidInquiryMessageForAccount,
} = require("./wa-account-agents");
const { getCurrentWaAccountId } = require("./current-wa-account");
const {
  resolveInterestRate,
  resolveJobCategory,
  formatInterestRate,
} = require("./interest-rate");
const { calculateDebtPurchaseOffer } = require("./debt-purchase");
const { getComboPackage } = require("./property-combo");

function personalAmountOfferMessage(session) {
  const rate = resolveInterestRate(session);
  const jobCategory = resolveJobCategory(session);
  const roundedAmount = session.roundedAmount;
  const installment = calculateMonthlyInstallment(
    roundedAmount,
    rate,
    undefined,
    jobCategory
  );
  const body = templates.personalAmountOffer(
    formatMoney(roundedAmount),
    formatMoney(installment)
  );

  session.interestRate = rate;
  session.jobCategory = jobCategory || session.jobCategory;
  return body;
}

function lowerAmountsNumberedListMessage(session, tiers) {
  const lines = tiers.map(
    (amount, index) => `${index + 1}- ${formatMoney(amount)}`
  );
  return templates.lowerAmountsNumberedList(lines.join("\n"));
}

function selectedAmountDetailMessage(session, amount) {
  const rate = resolveInterestRate(session);
  const jobCategory = resolveJobCategory(session);
  const installment = calculateMonthlyInstallment(
    amount,
    rate,
    undefined,
    jobCategory
  );
  const total = calculateTotalRepayment(amount, rate);
  return templates.selectedAmountDetail(
    formatMoney(amount),
    formatMoney(total),
    formatMoney(installment)
  );
}

function getContactSettings(session) {
  const waId = session?.waAccountId || getCurrentWaAccountId() || "majed";
  return loadSettingsForAccount(waId);
}

function getPersonalAgentContact(session) {
  const settings = getContactSettings(session);
  if (session?.comboPackage) {
    return {
      name: settings.propertyComboAgentName,
      phone: settings.propertyComboAgentPhone,
    };
  }
  return {
    name: settings.personalAgentName,
    phone: settings.personalAgentPhone,
  };
}

/** اسم ورقم التواصل حسب المسار (شخصي / فرع / باقة عقاري+شخصي / إيقاف خدمات) */
function resolveEmployeeContact(session) {
  const settings = getContactSettings(session);
  if (isServiceStopSession(session)) {
    return {
      name: settings.serviceStopAgentName,
      phone: settings.serviceStopAgentPhone,
      label: "المندوب",
    };
  }
  if (session?.comboPackage) {
    return {
      name: settings.propertyComboAgentName,
      phone: settings.propertyComboAgentPhone,
      label: "المندوب",
    };
  }
  if (session?.applicationMethod === "branch") {
    return {
      name: settings.branchEmployeeName,
      phone: settings.branchEmployeePhone,
      label: "الموظف",
    };
  }
  return {
    name: settings.personalAgentName,
    phone: settings.personalAgentPhone,
    label: "الموظف",
  };
}

function captureContactOnSession(session, deliveryKind) {
  if (!session) return;
  const settings = getContactSettings(session);
  let name = null;
  let phone = null;
  let delivery = deliveryKind;

  switch (deliveryKind) {
    case "electronic":
      delivery = "electronic_link";
      if (session.comboPackage) {
        name = settings.propertyComboAgentName;
        phone = settings.propertyComboAgentPhone;
      } else {
        name = settings.personalAgentName;
        phone = settings.personalAgentPhone;
      }
      session.portalUrl = settings.portalUrl || null;
      break;
    case "combo_agent":
      name = settings.propertyComboAgentName;
      phone = settings.propertyComboAgentPhone;
      delivery = "agent_direct";
      break;
    case "debt_complete":
      name = settings.personalAgentName;
      phone = settings.personalAgentPhone;
      delivery = "electronic_link";
      session.portalUrl = settings.portalUrl || null;
      break;
    case "service_stop":
      name = settings.serviceStopAgentName;
      phone = settings.serviceStopAgentPhone;
      delivery = "agent_direct";
      break;
    case "branch":
      name = settings.branchEmployeeName;
      phone = settings.branchEmployeePhone;
      delivery = "branch";
      break;
    case "employee":
    default: {
      const c = resolveEmployeeContact(session);
      name = c.name;
      phone = c.phone;
      delivery = deliveryKind === "branch" ? "branch" : "phone";
      break;
    }
  }

  applyContactToSession(session, name, phone, delivery);
}

function applyContactToSession(session, name, phone, delivery) {
  session.contactAgentName = name || null;
  session.contactAgentPhone = phone || null;
  session.contactDelivery = delivery || null;
}

function isCivilianLikeCategory(session) {
  const cat = resolveJobCategory(session);
  return cat === "civilian" || cat === "retired";
}

function salaryMessage(session) {
  return isCivilianLikeCategory(session)
    ? messages.salaryCivilian
    : messages.salaryMilitary;
}

function invalidSalaryMessage(session) {
  return isCivilianLikeCategory(session)
    ? messages.invalidSalaryCivilian
    : messages.invalidSalaryMilitary;
}

function salesCodeFromPortalUrl(portalUrl) {
  const m = String(portalUrl || "").match(/[?&]DSA=([A-Za-z0-9]+)/i);
  return m ? m[1] : "SF1888";
}

function electronicApplicationMessage(session) {
  const settings = getContactSettings(session);
  const contact = getPersonalAgentContact(session);
  return templates.electronicApplication(
    settings.portalUrl,
    contact.name,
    contact.phone,
    salesCodeFromPortalUrl(settings.portalUrl)
  );
}

function isServiceStopSession(session) {
  return session?.inquiryType === "إيقاف خدمات";
}

function employeeContactMessage(session) {
  const settings = getContactSettings(session);
  if (isServiceStopSession(session)) {
    const attribution =
      settings.serviceStopContactHint || "من طرف ماجد";
    return templates.serviceStopAgentContact(
      settings.serviceStopAgentName,
      settings.serviceStopAgentPhone,
      attribution
    );
  }
  const { name, phone, label } = resolveEmployeeContact(session);
  return templates.employeeContact(name, phone, label);
}

function propertyFinalMessage(session) {
  const settings = getContactSettings(session);
  if (isServiceStopSession(session)) {
    return templates.serviceStopQualified(
      settings.serviceStopAgentName,
      settings.serviceStopAgentPhone,
      settings.serviceStopContactHint
    );
  }
  return templates.propertySuccess(brand.contactPhone, brand.contactHint);
}

function serviceStopWelcomeMessage() {
  const build =
    templates.serviceStopWelcome || messages.serviceStopWelcome;
  if (typeof build !== "function") {
    throw new Error("serviceStopWelcome template missing");
  }
  const pkg = CONFIG.comboPackage;
  return build(
    formatMoney(pkg.totalExample),
    formatMoney(pkg.propertyAmount),
    formatMoney(pkg.personalAmount)
  );
}

function serviceStopContactQuestionMessage() {
  return templates.serviceStopContactQuestion();
}

function serviceStopDeclinedMessage() {
  return templates.serviceStopDeclined();
}

function invalidServiceStopContactMessage() {
  return templates.invalidServiceStopContact();
}

function debtPurchaseOfferMessage(offer) {
  const body = templates.debtPurchaseOffer(
    formatMoney(offer.debtAmount),
    formatMoney(offer.surplus),
    formatMoney(offer.installment)
  );
  return body;
}

function debtPurchaseCompleteMessage(session) {
  const settings = getContactSettings(session);
  const letterCompany = CONFIG.debtPurchase.letterCompanyExample;
  return templates.debtPurchaseComplete(
    settings.personalAgentName,
    settings.personalAgentPhone,
    settings.portalUrl,
    letterCompany
  );
}

function propertyComboAgentMessage(session) {
  const settings = getContactSettings(session);
  const footer =
    settings.propertyComboContactFooter ||
    CONFIG.financing.propertyComboContactFooter ||
    "من طرف ماجد\nربي يسر أمرك";
  return templates.propertyComboAgentDirect(
    settings.propertyComboAgentName,
    settings.propertyComboAgentPhone,
    footer
  );
}

/** @deprecated */
function propertyComboAcceptedMessage() {
  return propertyComboAgentMessage();
}

function invalidAgentContactMessage() {
  return templates.invalidServiceStopContact();
}

function withInquiryFooter(body) {
  const footer = messages.inquiryMenuFooter || "";
  return `${body}${footer}`;
}

/** @deprecated */
function personalFinalMessage(amount, _jobLabel, interestRate) {
  return personalAmountOfferMessage({
    roundedAmount: amount,
    interestRate,
  });
}

function personalRejectReasonMessage(reasonKey) {
  if (!reasonKey) return null;
  const fn =
    templates.personalRejectReason || templates.personalRejectBeforeCombo;
  if (!fn) return null;
  const text = fn(reasonKey);
  return text || null;
}

/** @deprecated */
function personalRejectBeforeComboMessage(reasonKey) {
  return personalRejectReasonMessage(reasonKey);
}

function notQualifiedWithRetryMessage(reasonKey) {
  const apology =
    personalRejectReasonMessage(reasonKey) || "نعتذر منك";
  const footer = messages.rejectRetryFooter || "";
  return footer ? `${apology}\n\n${footer}` : apology;
}

function notQualifiedFinalMessage(reasonKey) {
  return personalRejectReasonMessage(reasonKey) || "نعتذر منك";
}

function propertyComboOfferMessage(_session) {
  const pkg = CONFIG.comboPackage;
  return templates.propertyComboOffer(
    formatMoney(pkg.totalExample),
    formatMoney(pkg.propertyAmount),
    formatMoney(pkg.personalAmount)
  );
}

module.exports = {
  startMessage: () => getStartMessageForAccount(messages.start),
  pauseChatAutoReplyMessage: () => messages.pauseChatAutoReply,
  invalidInquiryTypeMessage: () =>
    getInvalidInquiryMessageForAccount(messages.invalidInquiryType),
  invalidFinanceTypeMessage: () =>
    getInvalidInquiryMessageForAccount(messages.invalidInquiryType),
  debtPurchaseInfoMessage: () => withInquiryFooter(brand.debtPurchaseInfo),
  workingHoursMessage: () => brand.workingHours,
  locationInfoMessage: () => brand.locationInfo,
  assistantContactMessage: () => {
    const settings = getContactSettings(null);
    return withInquiryFooter(
      templates.assistantContact(
        settings.personalAgentName,
        settings.personalAgentPhone
      )
    );
  },
  jobTypeMessage: () => messages.jobType,
  invalidJobTypeMessage: () => messages.invalidJobType,
  realEstateMessage: () => messages.realEstate,
  invalidRealEstateMessage: () => messages.invalidRealEstate,
  supportAmountMessage: () => messages.supportAmount,
  invalidSupportAmountMessage: () => messages.invalidSupportAmount,
  retiredAgeNoticeMessage: () => messages.retiredAgeNotice,
  salaryMessage,
  invalidSalaryMessage,
  commitmentsMessage: (session) => {
    if (session?.flow === "debt_purchase") {
      return messages.commitmentsDebtPurchase;
    }
    if (session?.realEstate === "old") {
      return messages.commitmentsWithOldMortgage;
    }
    return messages.commitments;
  },
  invalidCommitmentsMessage: (session) => {
    if (session?.flow === "debt_purchase") {
      return messages.invalidCommitmentsDebtPurchase;
    }
    if (session?.realEstate === "old") {
      return messages.invalidCommitmentsWithOldMortgage;
    }
    return messages.invalidCommitments;
  },
  propertySalaryQuestion: () => messages.propertySalary,
  invalidPropertySalaryQuestion: () => messages.invalidPropertySalary,
  serviceStopWelcomeMessage,
  debtOverQuestion: () => messages.debtOver,
  invalidDebtOverQuestion: () => messages.invalidDebtOver,
  nonTextMessage: () => messages.nonText,
  notQualifiedWithRetryMessage,
  notQualifiedFinalMessage,
  remoteAllowanceCheckMessage: () => messages.remoteAllowanceCheck,
  invalidRemoteAllowanceCheckMessage: () => messages.invalidRemoteAllowanceCheck,
  remoteAllowanceAmountMessage: () => messages.remoteAllowanceAmount,
  invalidRemoteAllowanceAmountMessage: () => messages.invalidRemoteAllowanceAmount,
  personalRejectReasonMessage,
  personalRejectBeforeComboMessage,
  propertyComboOfferMessage,
  militaryComboOfferMessage: propertyComboOfferMessage,
  invalidPropertyComboMessage: () => messages.invalidPropertyCombo,
  propertyComboDeclinedDebtMessage: () => messages.propertyComboDeclinedDebt,
  propertyComboDeclinedApologyMessage: () => messages.propertyComboDeclinedApology,
  invalidMilitaryComboMessage: () => messages.invalidPropertyCombo,
  propertyComboAgentMessage,
  propertyComboAcceptedMessage,
  militaryComboAcceptedMessage: propertyComboAgentMessage,
  debtPurchaseRulesMessage: () => messages.debtPurchaseRules,
  debtPurchaseAmountMessage: () => messages.debtPurchaseAmount,
  invalidDebtPurchaseAmountMessage: () => messages.invalidDebtPurchaseAmount,
  debtPurchaseOfferMessage,
  debtContinueQuestionMessage: () => messages.debtContinueQuestion,
  invalidDebtContinueMessage: () => messages.invalidDebtContinue,
  debtPurchaseCompleteMessage,
  debtDeclinedMessage: () => messages.debtDeclined,
  personalAmountOfferMessage,
  lowerAmountsNumberedListMessage,
  selectedAmountDetailMessage,
  invalidLowerAmountMessage: () => messages.invalidLowerAmount,
  invalidLowerAmountPickMessage: () => messages.invalidLowerAmountPick,
  applicationMethodMessage: () => messages.applicationMethod,
  invalidApplicationMethodMessage: () => messages.invalidApplicationMethod,
  electronicApplicationMessage,
  contactEmployeeQuestionMessage: () => messages.contactEmployeeQuestion,
  serviceStopContactQuestionMessage,
  serviceStopDeclinedMessage,
  invalidServiceStopContactMessage,
  invalidAgentContactMessage,
  invalidContactEmployeeMessage: () => messages.invalidContactEmployee,
  employeeContactMessage,
  captureContactOnSession,
  applicationCompleteNoEmployeeMessage: () =>
    templates.applicationCompleteNoEmployee,
  personalFinalMessage,
  propertyFinalMessage,
  temporaryErrorMessage: () => templates.temporaryError,
  orderNumberRecordedMessage: () =>
    CONFIG.messages.orderNumberRecorded ||
    "شكراً، تم تسجيل رقم الطلب في سجل العملاء.",
};
