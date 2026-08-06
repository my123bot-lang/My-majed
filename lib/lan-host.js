/**
 * اختيار عنوان LAN للمشاركة — يستبعد 169.254 (APIPA) و localhost
 */
const os = require("os");

function isShareableLanIp(ip) {
  const a = String(ip || "").trim();
  if (!a) return false;
  if (a.startsWith("127.")) return false;
  if (a.startsWith("169.254.")) return false;
  return true;
}

function lanIpScore(ip) {
  if (ip.startsWith("192.168.")) return 100;
  if (ip.startsWith("10.")) return 80;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 70;
  return 10;
}

function collectShareableLanIps(nets) {
  const interfaces = nets || os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (
        net.family === "IPv4" &&
        !net.internal &&
        isShareableLanIp(net.address)
      ) {
        out.push(net.address);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => lanIpScore(b) - lanIpScore(a));
}

function pickBestLanIp(nets) {
  const list = collectShareableLanIps(nets);
  return list[0] || null;
}

function formatHostWithPort(ip, port) {
  const p = Number(port) || 3000;
  if (!ip) return `127.0.0.1:${p}`;
  return `${ip}:${p}`;
}

module.exports = {
  isShareableLanIp,
  collectShareableLanIps,
  pickBestLanIp,
  formatHostWithPort,
};
