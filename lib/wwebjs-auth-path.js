/**
 * مجلد جلسات واتساب — خارج OneDrive لتجنب تلف الجلسة وإغلاق Chrome
 */
const path = require("path");
const os = require("os");

function getWwebjsAuthPath() {
  if (process.env.WWEBJS_AUTH_PATH) {
    return path.resolve(process.env.WWEBJS_AUTH_PATH);
  }
  // Windows: %LOCALAPPDATA%\whatsapp_direct_bot_wwebjs
  // Linux/macOS: ~/.local/share/whatsapp_direct_bot_wwebjs
  if (process.platform === "win32") {
    const local =
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "whatsapp_direct_bot_wwebjs");
  }
  const dataHome =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "whatsapp_direct_bot_wwebjs");
}

function getSessionDir(clientId) {
  return path.join(getWwebjsAuthPath(), `session-${clientId}`);
}

module.exports = { getWwebjsAuthPath, getSessionDir };
