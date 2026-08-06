/**

 * تشغيل / إيقاف الرد الآلي — أوامر من حسابك (رسائل fromMe).

 */

const CONFIG = require("../config");

const { normalizeText } = require("./validators");



let autoReplyEnabled = true;



/** محادثات أوقف فيها العميل الرد الآلي (خيار 6) */

const pausedChats = new Set();



const { stopCommands, startCommands } = CONFIG.botControl;



const recentOwnerCommandIds = new Set();



function normalizeCommand(text) {

  return normalizeText(text).toLowerCase();

}



function isEnabled() {

  return autoReplyEnabled;

}



function resumeAllChats() {

  pausedChats.clear();

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

  const stopAllList = (CONFIG.botControl.stopAllCommands || []).map(normalizeCommand);
  const startAllList = (CONFIG.botControl.startAllCommands || []).map(normalizeCommand);
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

  return pausedChats.size;

}



function pauseChat(chatId) {

  if (chatId) pausedChats.add(chatId);

}



function resumeChat(chatId) {

  if (chatId) pausedChats.delete(chatId);

}



function isChatPaused(chatId) {

  return pausedChats.has(chatId);

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

};


