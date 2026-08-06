/**
 * تحميل متغيرات .env بدون حزمة خارجية
 * القيم من الملف تغلب على بيئة الطرفية القديمة (مثل SEND_MODE=template)
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath = path.join(__dirname, "..", ".env")) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    return true;
  } catch (err) {
    console.warn("[env] تعذر قراءة .env:", err.message);
    return false;
  }
}

module.exports = { loadEnvFile };
