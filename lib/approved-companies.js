/**
 * قائمة الشركات المعتمدة — بحث ومطابقة لاسم جهة العمل
 */
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "approved-companies.json");

let cached = null;

function loadCompanies() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    cached = Array.isArray(raw.companies) ? raw.companies : [];
  } catch (_) {
    cached = [];
  }
  return cached;
}

function normalizeCompanyName(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^0-9a-z\u0600-\u06ff\s]/g, " ")
    .replace(/\b(شركه|شركة|company|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {string[]}
 */
function searchApprovedCompanies(query, limit = 10) {
  const q = normalizeCompanyName(query);
  if (!q || q.length < 2) return [];

  const companies = loadCompanies();
  const scored = [];

  for (const name of companies) {
    const n = normalizeCompanyName(name);
    if (!n) continue;
    if (n === q) {
      scored.push({ name, score: 100 });
      continue;
    }
    if (n.includes(q)) {
      scored.push({ name, score: 80 - Math.min(40, n.length - q.length) });
      continue;
    }
    if (q.includes(n) && n.length >= 4) {
      scored.push({ name, score: 60 });
      continue;
    }
    // كلمات مشتركة
    const qParts = q.split(" ").filter((p) => p.length >= 3);
    if (qParts.length) {
      const hit = qParts.filter((p) => n.includes(p)).length;
      if (hit >= Math.min(2, qParts.length) || (hit === 1 && qParts[0].length >= 5)) {
        scored.push({ name, score: 30 + hit * 10 });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  const seen = new Set();
  const out = [];
  for (const row of scored) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    out.push(row.name);
    if (out.length >= limit) break;
  }
  return out;
}

function isApprovedCompany(name) {
  const q = normalizeCompanyName(name);
  if (!q) return false;
  return loadCompanies().some((c) => normalizeCompanyName(c) === q);
}

module.exports = {
  loadCompanies,
  normalizeCompanyName,
  searchApprovedCompanies,
  isApprovedCompany,
};
