/**
 * إدارة الجلسات — عميل واحد = جلسة واحدة في الذاكرة.
 *
 * الحالات:
 * - sessions[from]     : محادثة نشطة (step + data)
 * - closedUsers[from]  : انتهت (نجاح أو رفض) — لا رد إلا إعادة محاولة واحدة
 * - retryUsed[from]    : استُخدمت إعادة التقييم بعد الرفض
 * - lastMessageTime    : حماية سبام (تأخير بين الرسائل)
 *
 * مستقبلاً: استبدال هذا الملف بطبقة DB دون تغيير واجهة الدوال العامة.
 */
const CONFIG = require("../config");
const messages = require("./messages");
const callStats = require("./call-stats");
const customerLeads = require("./customer-leads");

/** @type {Record<string, object>} */
const sessions = {};

/** @type {Record<string, { type: 'success'|'rejected', retryAllowed: boolean, postCloseCount?: number }>} */
const closedUsers = {};

/** @type {Record<string, boolean>} */
const retryUsed = {};

/** @type {Record<string, number>} */
const lastMessageTime = {};

const { spamDelayMs, resetKeywords, rateLimitCleanupHours, postCloseMenuThreshold } =
  CONFIG.session;

function startSession(from) {
  const { getCurrentWaAccountId } = require("./current-wa-account");
  const waAccountId = getCurrentWaAccountId() || null;
  sessions[from] = {
    step: "inquiry_type",
    chatId: from,
    whatsappNumber: null,
    phoneDisplay: null,
    waAccountId,
  };
  callStats.recordConversationStart();
}

function ensureSessionWaAccount(session) {
  if (!session) return;
  const { getCurrentWaAccountId } = require("./current-wa-account");
  const id = getCurrentWaAccountId();
  if (id) session.waAccountId = id;
}

function getSession(from) {
  return sessions[from] || null;
}

function isClosed(from) {
  return Boolean(closedUsers[from]);
}

function getClosedState(from) {
  return closedUsers[from] || null;
}

/**
 * إغلاق بعد قبول — لا إعادة محاولة.
 */
function closeSuccess(from) {
  const session = sessions[from];
  customerLeads.recordSuccess(from, session);
  closedUsers[from] = { type: "success", retryAllowed: false, postCloseCount: 0 };
  delete sessions[from];
  callStats.recordOutcome("success");
}

/**
 * إغلاق بعد رفض — إعادة محاولة واحدة فقط إن لم تُستخدم سابقاً.
 * @returns {string} نص الرسالة للعميل
 */
function closeRejected(from) {
  const session = sessions[from];
  const hasUsedRetry = retryUsed[from] === true;

  const reasonKey = session?.rejectReason || null;

  if (hasUsedRetry) {
    customerLeads.recordRejected(from, session);
    closedUsers[from] = { type: "rejected", retryAllowed: false };
    delete sessions[from];
    callStats.recordOutcome("rejected");
    return messages.notQualifiedFinalMessage(reasonKey);
  }

  customerLeads.recordRejected(from, session);
  closedUsers[from] = { type: "rejected", retryAllowed: true };
  delete sessions[from];
  callStats.recordOutcome("rejected");
  return messages.notQualifiedWithRetryMessage(reasonKey);
}

/** إغلاق بعد رفض — بدون رسالة إضافية (مثلاً رفض عرض عقاري+شخصي) */
function closeRejectedFinal(from) {
  const session = sessions[from];
  customerLeads.recordRejected(from, session);
  closedUsers[from] = { type: "rejected", retryAllowed: false };
  delete sessions[from];
  callStats.recordOutcome("rejected");
}

/**
 * إعادة ضبط كاملة (أمر reset من العميل أو الدعم).
 */
function clearSession(from) {
  delete sessions[from];
  delete closedUsers[from];
  delete retryUsed[from];
  delete lastMessageTime[from];
}

function resetUser(from) {
  clearSession(from);
  startSession(from);
}

/**
 * إعادة تقييم بعد رفض — مرة واحدة عند إرسال "1".
 */
function tryRetry(from) {
  const closed = closedUsers[from];
  if (!closed || closed.type !== "rejected" || !closed.retryAllowed) {
    return false;
  }

  retryUsed[from] = true;
  delete closedUsers[from];
  startSession(from);
  return true;
}

/**
 * بعد إتمام التقديم (رابط / فرع) — عدّ رسائل العميل قبل إعادة القائمة.
 * @returns {{ shouldRestart: boolean, count: number, threshold: number }}
 */
function handlePostSuccessMessage(from) {
  const closed = closedUsers[from];
  if (!closed || closed.type !== "success") {
    return { shouldRestart: true, count: 0, threshold: postCloseMenuThreshold || 5 };
  }

  closed.postCloseCount = (closed.postCloseCount || 0) + 1;
  const threshold = Math.max(1, Number(postCloseMenuThreshold) || 5);
  return {
    shouldRestart: closed.postCloseCount >= threshold,
    count: closed.postCloseCount,
    threshold,
  };
}

function isResetCommand(text) {
  return resetKeywords.includes(text);
}

/**
 * حماية سبام: رفض معالجة رسائل متتالية سريعة من نفس المرسل.
 * @param {string} [text] نص الرسالة — أرقام القائمة (1، 2…) لا تُحظر
 * @returns {boolean} true إذا يجب تجاهل الرسالة
 */
function shouldThrottle(from, text) {
  const { isMenuStyleReply } = require("./validators");
  if (sessions[from] && isMenuStyleReply(text)) {
    lastMessageTime[from] = Date.now();
    return false;
  }

  const now = Date.now();
  const last = lastMessageTime[from];

  if (last && now - last < spamDelayMs) {
    return true;
  }

  lastMessageTime[from] = now;
  pruneStaleRateLimits(now);
  return false;
}

/**
 * تنظيف ذاكرة rate-limit للمستخدمين غير النشطين (لا يؤثر على الجلسة المفتوحة).
 */
function pruneStaleRateLimits(now = Date.now()) {
  const maxAge = rateLimitCleanupHours * 60 * 60 * 1000;

  for (const [userId, timestamp] of Object.entries(lastMessageTime)) {
    if (sessions[userId] || closedUsers[userId]) continue;
    if (now - timestamp > maxAge) {
      delete lastMessageTime[userId];
    }
  }
}

module.exports = {
  sessions,
  startSession,
  ensureSessionWaAccount,
  getSession,
  isClosed,
  getClosedState,
  closeSuccess,
  closeRejected,
  closeRejectedFinal,
  clearSession,
  resetUser,
  tryRetry,
  handlePostSuccessMessage,
  isResetCommand,
  shouldThrottle,
};
