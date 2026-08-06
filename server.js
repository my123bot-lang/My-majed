/**
 * لوحة تحكم خارجية — مستخدمون، إعدادات، إحصائية.
 * تشغيل: npm run admin
 */
const express = require("express");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const CONFIG = require("./config");
const { loadSettingsForAccount, saveSettingsForAccount, listSettingsAccounts } = require("./lib/settings-store");
const { getDashboardStats } = require("./lib/call-stats");
const {
  getLeads,
  deleteLeadById,
  queueElectronicFollowUp,
  setLeadOrderNumber,
  setLeadStatusNote,
  setLeadManualMark,
  resolveWaAccountForOpenChat,
} = require("./lib/customer-leads");
const { openWhatsAppChat } = require("./lib/open-wa-chat");
const adminAuth = require("./lib/admin-auth");
const portalAccess = require("./lib/portal-access");
const waAccounts = require("./lib/whatsapp-accounts-store");
const botStatus = require("./lib/bot-status");
const { collectShareableLanIps } = require("./lib/lan-host");

const PORT = Number(process.env.ADMIN_PORT) || 3000;
const HOST = process.env.ADMIN_HOST || "0.0.0.0";
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();

adminAuth.bootstrapFromEnv();

const app = express();
app.use(express.json());

function extractToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return String(req.headers["x-admin-token"] || "").trim();
}

function resolveUser(req) {
  const token = extractToken(req);
  const portalUser = portalAccess.getPortalSessionUser(token);
  if (portalUser) return portalUser;

  const sessionUser = adminAuth.getSessionUser(token);
  if (sessionUser) return sessionUser;

  const legacyPass =
    String(req.headers["x-admin-password"] || "").trim() ||
    (req.body && typeof req.body.password === "string" ? req.body.password.trim() : "");

  if (ADMIN_PASSWORD && legacyPass === ADMIN_PASSWORD) {
    return adminAuth.legacyAdminUser();
  }

  return null;
}

function requireAuth(req, res, next) {
  if (!adminAuth.hasUsers()) return next();

  const user = resolveUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, error: "يلزم تسجيل الدخول" });
  }
  req.user = user;
  return next();
}

function userHasPerm(user, perm) {
  if (user?.portalScope) {
    return portalAccess.hasPortalPermission(user, perm);
  }
  return adminAuth.hasPermission(user, perm);
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!adminAuth.hasUsers()) return next();
    const user = req.user || resolveUser(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: "يلزم تسجيل الدخول" });
    }
    req.user = user;
    if (!userHasPerm(user, perm)) {
      return res.status(403).json({ ok: false, error: "ليس لديك صلاحية لهذا الإجراء" });
    }
    return next();
  };
}

function attachUser(req, _res, next) {
  req.user = resolveUser(req);
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "whatsapp-bot-admin" });
});

app.get("/api/auth/status", attachUser, (req, res) => {
  res.json({
    hasUsers: adminAuth.hasUsers(),
    legacyPassword: Boolean(ADMIN_PASSWORD),
    user: req.user || null,
    roleLabels: adminAuth.ROLE_LABELS,
    roles: adminAuth.ROLES,
  });
});

app.post("/api/auth/setup", (req, res) => {
  try {
    if (adminAuth.hasUsers()) {
      return res.status(400).json({ ok: false, error: "تم الإعداد مسبقاً" });
    }
    const { username, password, displayName } = req.body || {};
    const user = adminAuth.setupFirstAdmin({ username, password, displayName });
    const loginResult = adminAuth.login(user.username, req.body.password);
    res.json({
      ok: true,
      user,
      token: loginResult.ok ? loginResult.token : null,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};

  if (adminAuth.hasUsers()) {
    const result = adminAuth.login(username, password);
    if (!result.ok) {
      return res.status(401).json(result);
    }
    return res.json(result);
  }

  if (ADMIN_PASSWORD && adminAuth.verifyLegacyPassword(password)) {
    return res.json({
      ok: true,
      token: null,
      legacy: true,
      user: adminAuth.legacyAdminUser(),
    });
  }

  return res.status(401).json({ ok: false, error: "أنشئ أول مستخدم من شاشة الإعداد" });
});

app.post("/api/auth/logout", (req, res) => {
  const token = extractToken(req);
  portalAccess.logoutPortal(token);
  adminAuth.logout(token);
  res.json({ ok: true });
});

app.get("/api/portal/auth", (req, res) => {
  const slug = req.query.slug || req.query.portal;
  const key = req.query.k || req.query.key || req.query.token;
  const portal = portalAccess.findPortal(slug, key);
  if (!portal) {
    return res.status(401).json({ ok: false, error: "رابط غير صالح أو منتهي" });
  }
  const session = portalAccess.createPortalSession(portal);
  res.json({
    ok: true,
    token: session.token,
    user: session.user,
    portal: {
      slug: portal.slug,
      label: portal.label,
      waAccountId: portal.waAccountId,
      fullAccess: Boolean(portal.fullAccess),
    },
  });
});

app.get(
  "/api/portal/links",
  requireAuth,
  requirePerm("users:manage"),
  (req, res) => {
    res.json({ ok: true, links: portalAccess.listPortalsForAdmin(req) });
  }
);

app.get("/p/:slug", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/", (req, res) => {
  const slug = req.query.portal || req.query.p;
  const key = req.query.k || req.query.key || req.query.token;
  if (slug && key) {
    return res.redirect(
      `/p/${encodeURIComponent(String(slug).trim().toLowerCase())}?k=${encodeURIComponent(String(key).trim())}`
    );
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/auth/me", attachUser, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: "غير مسجل" });
  }
  res.json({ ok: true, user: req.user });
});

app.get("/api/users", requireAuth, requirePerm("users:manage"), (_req, res) => {
  res.json({ ok: true, users: adminAuth.listUsers(), roleLabels: adminAuth.ROLE_LABELS });
});

app.get("/api/users/:id", requireAuth, requirePerm("users:manage"), (req, res) => {
  try {
    res.json({ ok: true, ...adminAuth.getUserDetail(req.params.id) });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

app.post("/api/users", requireAuth, requirePerm("users:manage"), (req, res) => {
  try {
    const user = adminAuth.createUser(req.body || {});
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.patch("/api/users/:id", requireAuth, requirePerm("users:manage"), (req, res) => {
  try {
    const user = adminAuth.updateUser(req.params.id, req.body || {}, req.user.id);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete("/api/users/:id", requireAuth, requirePerm("users:manage"), (req, res) => {
  try {
    adminAuth.deleteUser(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/users/:id/password", requireAuth, (req, res) => {
  try {
    const { password } = req.body || {};
    const targetId = req.params.id;
    const isSelf = targetId === req.user.id;
    const isAdmin = userHasPerm(req.user, "users:manage");

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ ok: false, error: "غير مصرح" });
    }

    adminAuth.setUserPassword(targetId, password, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get(
  "/api/settings",
  requireAuth,
  requirePerm("settings:read"),
  portalAccess.enforceWaScope,
  (req, res) => {
    const waAccountId = String(req.query.waAccountId || "majed").trim();
    res.json({
      waAccountId,
      accounts: listSettingsAccounts(),
      ...loadSettingsForAccount(waAccountId),
    });
  }
);

app.post(
  "/api/settings",
  requireAuth,
  requirePerm("settings:write"),
  portalAccess.enforceWaScope,
  (req, res) => {
  try {
    const body = req.body || {};
    const waAccountId = String(
      body.waAccountId || req.query.waAccountId || "majed"
    ).trim();
    const {
      password: _pw,
      ok: _ok,
      waAccountId: _wa,
      accounts: _accounts,
      ...fields
    } = body;
    const saved = saveSettingsForAccount(waAccountId, fields);
    res.json({ ok: true, waAccountId, settings: saved });
  } catch (err) {
    console.error("[settings] فشل الحفظ:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
  }
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "whatsapp-bot-admin",
    features: { deleteLead: true },
  });
});

app.get(
  "/api/stats",
  requireAuth,
  requirePerm("stats:read"),
  portalAccess.enforceWaScope,
  (req, res) => {
    const waAccountId = req.query.waAccountId || null;
    res.json(getDashboardStats({ waAccountId }));
  }
);

app.get(
  "/api/leads",
  requireAuth,
  requirePerm("stats:read"),
  portalAccess.enforceWaScope,
  (req, res) => {
  try {
    const {
      status,
      limit,
      page,
      waAccountId,
      applicationMethod,
      phoneSearch,
      orderNumberSearch,
      manualMark,
    } = req.query || {};
    res.json(
      getLeads({
        status,
        limit,
        page,
        waAccountId,
        applicationMethod,
        phoneSearch,
        orderNumberSearch,
        manualMark,
      })
    );
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "خطأ في سجل العملاء" });
  }
  }
);

app.post(
  "/api/leads/open-chat",
  requireAuth,
  requirePerm("stats:read"),
  portalAccess.enforceWaScope,
  async (req, res) => {
  try {
    const phone = req.body?.phone;
    if (!phone) {
      return res.status(400).json({
        ok: false,
        error: "رقم العميل مطلوب",
      });
    }
    const { waAccountId } = resolveWaAccountForOpenChat(phone, {
      waAccountId: req.body?.waAccountId,
      waAccountLabel: req.body?.waAccountLabel,
    });
    if (!waAccountId) {
      return res.status(400).json({
        ok: false,
        error:
          "لم يُحدد جوال البوت — اختر حساب ماجد، أو سجّل العميل من نافذة البوت",
      });
    }
    const result = await openWhatsAppChat(waAccountId, phone);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "تعذّر فتح المحادثة" });
  }
  }
);

app.get("/api/leads/followup-template", requireAuth, requirePerm("settings:read"), (_req, res) => {
  res.json({
    ok: true,
    message: CONFIG.followUp?.electronicMessage || "",
  });
});

app.patch(
  "/api/leads/:id/order-number",
  requireAuth,
  requirePerm("settings:write"),
  (req, res) => {
    try {
      const lead = setLeadOrderNumber(req.params.id, req.body?.orderNumber);
      res.json({ ok: true, lead });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

app.patch(
  "/api/leads/:id/status-note",
  requireAuth,
  requirePerm("settings:write"),
  (req, res) => {
    try {
      const lead = setLeadStatusNote(req.params.id, req.body?.note);
      res.json({ ok: true, lead });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

app.patch(
  "/api/leads/:id/manual-mark",
  requireAuth,
  requirePerm("settings:write"),
  (req, res) => {
    try {
      const lead = setLeadManualMark(req.params.id, req.body?.mark);
      res.json({ ok: true, lead });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

function deleteLeadHandler(req, res) {
  try {
    const result = deleteLeadById(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
}

app.delete(
  "/api/leads/:id",
  requireAuth,
  requirePerm("settings:write"),
  deleteLeadHandler
);

app.post(
  "/api/leads/:id/delete",
  requireAuth,
  requirePerm("settings:write"),
  deleteLeadHandler
);

app.post(
  "/api/leads/send-followup",
  requireAuth,
  requirePerm("settings:write"),
  portalAccess.enforceWaScope,
  (req, res) => {
  try {
    const body = req.body || {};
    const message = String(body.message || "").trim();
    const waAccountId = body.waAccountId ? String(body.waAccountId).trim() : "";
    const leadId = body.leadId ? String(body.leadId).trim() : "";
    const onlyUnsent = body.onlyUnsent !== false;
    const dryRun = Boolean(body.dryRun);

    if (!message) {
      return res.status(400).json({ ok: false, error: "نص الرسالة مطلوب" });
    }

    const result = queueElectronicFollowUp({
      message,
      waAccountId: waAccountId || undefined,
      leadId: leadId || undefined,
      onlyUnsent,
      dryRun,
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "تعذّر إضافة الرسائل للطابور" });
  }
  }
);

app.get("/api/whatsapp/accounts", requireAuth, requirePerm("whatsapp:manage"), (_req, res) => {
  res.json({ ok: true, ...waAccounts.listAccounts() });
});

app.get("/api/whatsapp/status", requireAuth, requirePerm("whatsapp:manage"), (_req, res) => {
  res.json({ ok: true, ...botStatus.getStatusForDashboard(), ...waAccounts.listAccounts() });
});

app.post("/api/whatsapp/accounts", requireAuth, requirePerm("whatsapp:manage"), (req, res) => {
  try {
    const account = waAccounts.addAccount(req.body || {});
    res.json({ ok: true, account, needsBotRestart: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post(
  "/api/whatsapp/accounts/:id/activate",
  requireAuth,
  requirePerm("whatsapp:manage"),
  (req, res) => {
    try {
      const account = waAccounts.setActiveAccount(req.params.id);
      botStatus.writeStatusForAccount(account.id, {
        label: account.label,
        status: "pending_restart",
        qr: null,
        phone: null,
      });
      res.json({
        ok: true,
        account,
        needsBotRestart: true,
        message:
          `تم تفعيل ${account.label}. شغّل: start-bot.bat أو start-majed.bat`,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

app.delete(
  "/api/whatsapp/accounts/:id",
  requireAuth,
  requirePerm("whatsapp:manage"),
  (req, res) => {
    try {
      waAccounts.deleteAccount(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

/** توافق قديم */
app.get("/api/auth-required", (_req, res) => {
  res.json({ required: adminAuth.hasUsers() || Boolean(ADMIN_PASSWORD) });
});

app.use((req, res, next) => {
  if (/\.(html|js|css)$/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));

function getLanAddresses() {
  return collectShareableLanIps();
}

const LOCAL_URL = `http://127.0.0.1:${PORT}`;

function openBrowser(url) {
  if (process.env.ADMIN_NO_OPEN === "1") return;

  let cmd;
  if (process.platform === "win32") {
    cmd = `start "" "${url}"`;
  } else if (process.platform === "darwin") {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.log("  افتح المتصفح يدوياً:", url);
    }
  });
}

function printStartupBanner() {
  const ips = getLanAddresses();
  console.log("============================================");
  console.log("  لوحة تحكم بوت واتساب");
  console.log("============================================");
  console.log(`  محلي:    ${LOCAL_URL}`);
  if (ips.length) {
    ips.forEach((ip) => console.log(`  شبكة:    http://${ip}:${PORT}`));
  }
  if (adminAuth.hasUsers()) {
    console.log("  الدخول:  مستخدمون في data/admin-users.json");
  } else if (ADMIN_PASSWORD) {
    console.log("  الدخول:  ADMIN_PASSWORD (أو أنشئ مستخدمين من اللوحة)");
  } else {
    console.log("  الدخول:  إعداد أول مستخدم من اللوحة");
  }
  console.log("  (لإيقاف اللوحة: Ctrl+C في هذه النافذة)");
  console.log("  روابط البوابة (للموظفين):");
  try {
    for (const row of portalAccess.listPortalUrlsForConsole()) {
      console.log(`    ${row.label}:`);
      console.log(`      محلي:   ${row.localUrl}`);
      console.log(`      شبكة:   ${row.networkUrl}`);
    }
  } catch (err) {
    console.warn("  تعذر قراءة روابط البوابة:", err.message);
  }
  console.log("============================================\n");
}

const server = app.listen(PORT, HOST, () => {
  printStartupBanner();
  setTimeout(() => openBrowser(LOCAL_URL), 400);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("============================================");
    console.error(`  المنفذ ${PORT} مستخدم مسبقاً`);
    console.error("============================================");
    console.error("  اللوحة قد تكون شغّالة بالفعل. جرّب فتح:");
    console.error(`  ${LOCAL_URL}`);
    console.error("");
    console.error("  لإيقاف النسخة القديمة (PowerShell كمسؤول):");
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error("  taskkill /PID <رقم_العملية> /F");
    console.error("");
    console.error("  أو شغّل على منفذ آخر:");
    console.error("  set ADMIN_PORT=3001 && npm run admin");
    console.error("============================================\n");
    openBrowser(LOCAL_URL);
    process.exit(1);
  }
  throw err;
});
