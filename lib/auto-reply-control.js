/**
 * تشغيل / إيقاف الرد الآلي — أوامر من حسابك (رسائل fromMe).
 * stop/start = عميل واحد · stop all/start all = الجميع
 *
 * تُحفظ المحادثات المتوقفة على القرص وتُطابق بعدة مفاتيح
 * (chatId / رقم الجوال / @c.us) حتى لا يفشل الإيقاف مع @lid.
 */
const fs = require("fs");
const path = require("path");
const CONFIG = require("../config");
const { normalizeText } = require("./validators");
const {
  digitsOnly,
  phoneFromChatId,
  phoneToWhatsAppDigits,
  normalizeSaudiDisplay,
} = require("./contact-phone");
const { getCurrentWaAccountId } = require("./current-wa-account");

let autoReplyEnabled = true;

/**
 * كل عنصر = محادثة واحدة متوقفة بكل مفاتيحها المعروفة.
 * @type {Array<{ keys: string[] }>}
 */
let pausedEntries = [];

const { stopCommands, startCommands } = CONFIG.botControl;
const recentOwnerCommandIds = new Set();

const DATA_DIR = path.join(__dirname, "..", "data");

function safeFilePart(accountId) {
  return String(accountId || "default").replace(/[^a-z0-9_-]/gi, "_");
}

function pausedPathForAccount(accountId) {
  return path.join(DATA_DIR, `paused-chats-${safeFilePart(accountId)}.json`);
}

function normalizeCommand(text) {
  return normalizeText(text).toLowerCase();
}

/**
 * كل الصيغ الممكنة لنفس العميل — للمطابقة بين @lid و @c.us ورقم الجوال.
 * @param {...(string|null|undefined)} ids
 * @returns {string[]}
 */
function expandChatKeys(...ids) {
  const keys = new Set();

  const add = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    keys.add(raw);

    const user = raw.includes("@") ? raw.split("@")[0] : raw;
    const digits = digitsOnly(user);
    if (!digits) return;

    keys.add(digits);

    const wa = phoneToWhatsAppDigits(digits);
    if (wa) {
      keys.add(wa);
      keys.add(`${wa}@c.us`);
    }

    const display = normalizeSaudiDisplay(digits) || phoneFromChatId(raw);
    if (display) {
      keys.add(display);
      const localDigits = digitsOnly(display);
      if (localDigits) {
        keys.add(localDigits);
        keys.add(`${localDigits}@c.us`);
      }
    }

    if (!raw.includes("@") && /^\d+$/.test(digits)) {
      keys.add(`${digits}@c.us`);
    }
  };

  for (const id of ids) add(id);
  return [...keys];
}

function entryMatchesAny(entry, lookupKeys) {
  const set = new Set(entry.keys);
  return lookupKeys.some((k) => set.has(k));
}

function loadPausedForCurrentAccount() {
  pausedEntries = [];
  const accountId = getCurrentWaAccountId() || "default";
  const filePath = pausedPathForAccount(accountId);
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (Array.isArray(raw?.entries)) {
      for (const entry of raw.entries) {
        const keys = expandChatKeys(...(entry.keys || []));
        if (keys.length) pausedEntries.push({ keys });
      }
      return;
    }

    // توافق مع الشكل القديم: قائمة مفاتيح مسطّحة
    const list = Array.isArray(raw?.keys)
      ? raw.keys
      : Array.isArray(raw)
        ? raw
        : [];
    if (list.length) {
      pausedEntries.push({ keys: expandChatKeys(...list) });
    }
  } catch (err) {
    console.warn("تعذر قراءة المحادثات المتوقفة:", err.message);
  }
}

function persistPausedForCurrentAccount() {
  const accountId = getCurrentWaAccountId() || "default";
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      accountId,
      updatedAt: new Date().toISOString(),
      entries: pausedEntries,
    };
    fs.writeFileSync(
      pausedPathForAccount(accountId),
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  } catch (err) {
    console.warn("تعذر حفظ المحادثات المتوقفة:", err.message);
  }
}

let loadedAccountId = null;

function ensureLoaded() {
  const accountId = getCurrentWaAccountId() || "default";
  if (loadedAccountId !== accountId) {
    loadedAccountId = accountId;
    loadPausedForCurrentAccount();
  }
}

function isEnabled() {
  return autoReplyEnabled;
}

function resumeAllChats() {
  ensureLoaded();
  pausedEntries = [];
  persistPausedForCurrentAccount();
}

function enable(options = {}) {
  autoReplyEnabled = true;
  if (options.clearPausedChats !== false) {
    resumeAllChats();
  }
  return autoReplyEnabled;
}

function disable() {
  autoReplyEnabled = false;
  return autoReplyEnabled;
}

/**
 * @returns {'stop'|'start'|'stop_all'|'start_all'|null}
 */
function parseOwnerCommand(text) {
  const cmd = normalizeCommand(text);
  if (!cmd) return null;

  const stopAllList = (CONFIG.botControl.stopAllCommands || []).map(
    normalizeCommand
  );
  const startAllList = (CONFIG.botControl.startAllCommands || []).map(
    normalizeCommand
  );
  const stopList = stopCommands.map(normalizeCommand);
  const startList = startCommands.map(normalizeCommand);

  if (stopAllList.includes(cmd)) return "stop_all";
  if (startAllList.includes(cmd)) return "start_all";
  if (stopList.includes(cmd)) return "stop";
  if (startList.includes(cmd)) return "start";

  return null;
}

function rememberOwnerCommandMessage(msg) {
  const id = msg?.id?._serialized || msg?.id;
  if (!id) return false;
  if (recentOwnerCommandIds.has(id)) return true;
  recentOwnerCommandIds.add(id);
  setTimeout(() => recentOwnerCommandIds.delete(id), 15000);
  return false;
}

function statusLabel() {
  return autoReplyEnabled ? "يعمل" : "متوقف";
}

function pausedChatsCount() {
  ensureLoaded();
  return pausedEntries.length;
}

/**
 * @param {string} chatId
 * @param {{ extraKeys?: string[] }} [options]
 */
function pauseChat(chatId, options = {}) {
  ensureLoaded();
  const extras = Array.isArray(options.extraKeys) ? options.extraKeys : [];
  const keys = expandChatKeys(chatId, ...extras);
  if (!keys.length) return;

  const existing = pausedEntries.find((entry) => entryMatchesAny(entry, keys));
  if (existing) {
    existing.keys = expandChatKeys(...existing.keys, ...keys);
  } else {
    pausedEntries.push({ keys });
  }
  persistPausedForCurrentAccount();
}

/**
 * @param {string} chatId
 * @param {{ extraKeys?: string[] }} [options]
 */
function resumeChat(chatId, options = {}) {
  ensureLoaded();
  const extras = Array.isArray(options.extraKeys) ? options.extraKeys : [];
  const keys = expandChatKeys(chatId, ...extras);
  if (!keys.length) return;

  const before = pausedEntries.length;
  pausedEntries = pausedEntries.filter(
    (entry) => !entryMatchesAny(entry, keys)
  );
  if (pausedEntries.length !== before) {
    persistPausedForCurrentAccount();
  }
}

function isChatPaused(chatId) {
  ensureLoaded();
  if (!chatId) return false;
  const keys = expandChatKeys(chatId);
  return pausedEntries.some((entry) => entryMatchesAny(entry, keys));
}

module.exports = {
  isEnabled,
  enable,
  disable,
  parseOwnerCommand,
  rememberOwnerCommandMessage,
  statusLabel,
  pausedChatsCount,
  resumeAllChats,
  pauseChat,
  resumeChat,
  isChatPaused,
  expandChatKeys,
};
