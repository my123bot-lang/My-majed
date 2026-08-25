/**
 * جلب جهات اتصال إنترأكت واستيرادها كسجل عملاء — يُستخدم من لوحة التحكم
 * وتلقائياً عند إقلاع السيرفر إذا القرص المؤقت انصفر بعد نشر جديد.
 */
const interakt = require("./interakt-client");
const { importLeadsBackup, getLeads, getPersistenceInfo } = require("./customer-leads");

async function syncCustomersFromInterakt({ days = 30, noFilter = false, debug = false } = {}) {
  if (!interakt.isConfigured()) {
    throw new Error("INTERAKT_API_KEY غير مضبوط على Render");
  }
  const boundedDays = Math.min(Math.max(Number(days) || 30, 1), 3650);
  const since = new Date(Date.now() - boundedDays * 24 * 3600 * 1000).toISOString();
  const incoming = [];
  let offset = 0;
  let fetched = 0;
  let firstRaw = null;

  for (let page = 0; page < 200; page++) {
    const pack = await interakt.listUsersPage({
      offset,
      limit: 100,
      sinceIso: noFilter ? null : since,
    });
    if (debug && firstRaw == null) firstRaw = pack.raw;
    fetched += pack.users.length;
    for (const user of pack.users) {
      const phone =
        user.phoneNumber ||
        user.phone_number ||
        user.phone ||
        user.traits?.phone ||
        user.traits?.phoneNumber ||
        "";
      const country = user.countryCode || user.country_code || user.traits?.countryCode || "+966";
      const at =
        user.created_at_utc ||
        user.createdAt ||
        user.traits?.created_at_utc ||
        new Date().toISOString();
      incoming.push({
        phone: `${country}${phone}`,
        at,
        lastInboundAt: at,
        waAccountId: "majed",
        waAccountLabel: "ماجد",
      });
    }
    if (!pack.hasNext || !pack.users.length) break;
    offset += 100;
  }

  const imported = incoming.length
    ? importLeadsBackup({ leads: incoming })
    : { ok: true, imported: 0, updated: 0, total: 0, persistence: getPersistenceInfo(0) };
  const pack = getLeads({ day: "all", limit: 1 });

  return {
    ok: true,
    fetched,
    created: imported.imported || 0,
    updated: imported.updated || 0,
    saved: { ok: true },
    persistence: imported.persistence || pack.persistence,
    preferDay: pack.tabCounts?.today ? "today" : "all",
    hint: incoming.length
      ? "الأرقام رجعت من إنترأكت. الملاحظات و«وش صار» ما ترجع إلا من ملف بكب."
      : "ما لقينا أرقام في إنترأكت لهذه الفترة.",
    ...(debug ? { debugRaw: firstRaw } : {}),
  };
}

/**
 * تصفير السجل بعد كل نشر على Render (قرص مؤقت) — إن كان السجل فاضياً عند
 * الإقلاع ومفتاح إنترأكت موجود، نجلب كل التاريخ تلقائياً بالخلفية بدون
 * انتظار ضغطة زر من اللوحة.
 */
function autoRestoreOnBootIfEmpty({ delayMs = 5000 } = {}) {
  setTimeout(() => {
    try {
      if (!interakt.isConfigured()) return;
      const pack = getLeads({ day: "all", limit: 1 });
      if ((pack.total || 0) > 0) return;
      console.log("[interakt-sync] السجل فاضٍ بعد الإقلاع — جلب تلقائي من إنترأكت...");
      syncCustomersFromInterakt({ days: 3650 })
        .then((result) => {
          console.log(
            "[interakt-sync] تم الجلب التلقائي:",
            `جديد ${result.created} · محدّث ${result.updated} · الإجمالي ${result.persistence?.count ?? "?"}`
          );
        })
        .catch((err) => {
          console.warn("[interakt-sync] فشل الجلب التلقائي:", err.message);
        });
    } catch (err) {
      console.warn("[interakt-sync] تعذر فحص السجل عند الإقلاع:", err.message);
    }
  }, delayMs);
}

module.exports = {
  syncCustomersFromInterakt,
  autoRestoreOnBootIfEmpty,
};
