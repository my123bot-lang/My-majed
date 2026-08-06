/**
 * روابط بوابة خارجية — لوحة مخصصة لكل جوال (عبدالرحمن / ماجد / رايد)
 * data/portal-links.json
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pickBestLanIp, formatHostWithPort } = require("./lan-host");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "portal-links.json");
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PORTAL_PERMISSIONS = [
  "stats:read",
  "settings:read",
  "settings:write",
];

const ADMIN_PORTAL_PERMISSIONS = [
  "stats:read",
  "settings:read",
  "settings:write",
  "users:manage",
  "whatsapp:manage",
];

/** @type {Map<string, { portal: object, expiresAt: number }>} */
const portalSessions = new Map();

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function defaultPortals() {
  return [
    {
      slug: "raied",
      label: "رائد — مدير",
      waAccountId: null,
      fullAccess: true,
      token: newToken(),
    },
    {
      slug: "abdulrahman",
      label: "عبدالرحمن",
      waAccountId: "wa_1780305984859",
      fullAccess: false,
      token: newToken(),
    },
    {
      slug: "majed",
      label: "ماجد",
      waAccountId: "majed",
      fullAccess: false,
      token: newToken(),
    },
  ];
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      if (Array.isArray(raw.portals) && raw.portals.length) {
        return raw;
      }
    }
  } catch (err) {
    console.warn("تعذر قراءة portal-links.json:", err.message);
  }
  const store = {
    updatedAt: new Date().toISOString(),
    portals: defaultPortals(),
  };
  saveStore(store);
  console.log("[بوابة] تم إنشاء روابط جديدة في data/portal-links.json");
  return store;
}

function saveStore(store) {
  store.updatedAt = new Date().toISOString();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function findPortal(slug, key) {
  const s = String(slug || "").trim().toLowerCase();
  const k = String(key || "").trim();
  if (!s || !k) return null;
  const store = loadStore();
  const portal = store.portals.find((p) => p.slug === s && p.token === k);
  return portal || null;
}

function buildPortalUser(portal) {
  const perms = portal.fullAccess
    ? ADMIN_PORTAL_PERMISSIONS
    : PORTAL_PERMISSIONS;
  return {
    id: `portal-${portal.slug}`,
    username: `portal_${portal.slug}`,
    displayName: portal.label,
    role: portal.fullAccess ? "admin" : "editor",
    active: true,
    createdAt: null,
    lastLoginAt: null,
    permissions: null,
    usesCustomPermissions: true,
    effectivePermissions: perms,
    portalScope: {
      slug: portal.slug,
      label: portal.label,
      waAccountId: portal.waAccountId || null,
      fullAccess: Boolean(portal.fullAccess),
    },
  };
}

function createPortalSession(portal) {
  const token = crypto.randomBytes(32).toString("hex");
  portalSessions.set(token, {
    portal,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return { token, user: buildPortalUser(portal) };
}

function getPortalSessionUser(token) {
  if (!token) return null;
  const sess = portalSessions.get(token);
  if (!sess) return null;
  if (sess.expiresAt < Date.now()) {
    portalSessions.delete(token);
    return null;
  }
  return buildPortalUser(sess.portal);
}

function logoutPortal(token) {
  if (token) portalSessions.delete(token);
}

function hasPortalPermission(user, perm) {
  if (!user?.portalScope) return false;
  return (user.effectivePermissions || []).includes(perm);
}

function resolvePublicHost(req) {
  const envHost = String(process.env.ADMIN_PUBLIC_HOST || "").trim();
  if (envHost) return envHost.replace(/^https?:\/\//i, "");

  const fromReq = req?.get?.("x-forwarded-host") || req?.get?.("host") || "";
  if (fromReq && !/127\.0\.0\.1|localhost/i.test(fromReq)) {
    return fromReq;
  }

  const port = Number(process.env.ADMIN_PORT) || 3000;
  const best = pickBestLanIp();
  if (best) return formatHostWithPort(best, port);

  if (fromReq && !/127\.0\.0\.1|localhost|169\.254\./i.test(fromReq)) {
    return fromReq;
  }

  return formatHostWithPort(null, port);
}

function buildPublicUrl(req, portal) {
  const proto =
    req?.get?.("x-forwarded-proto") || req?.protocol || "http";
  const host = resolvePublicHost(req);
  return `${proto}://${host}/p/${portal.slug}?k=${portal.token}`;
}

function listPortalUrlsForConsole() {
  const store = loadStore();
  const fakeReq = { get: () => null, protocol: "http" };
  return store.portals.map((p) => ({
    label: p.label,
    slug: p.slug,
    localUrl: `http://127.0.0.1:${Number(process.env.ADMIN_PORT) || 3000}/p/${p.slug}?k=${p.token}`,
    networkUrl: buildPublicUrl(fakeReq, p),
  }));
}

function listPortalsForAdmin(req) {
  const store = loadStore();
  const port = Number(process.env.ADMIN_PORT) || 3000;
  return store.portals.map((p) => ({
    slug: p.slug,
    label: p.label,
    waAccountId: p.waAccountId,
    fullAccess: Boolean(p.fullAccess),
    url: buildPublicUrl(req, p),
    networkUrl: buildPublicUrl(req, p),
    localUrl: `http://127.0.0.1:${port}/p/${p.slug}?k=${p.token}`,
  }));
}

function enforceWaScope(req, res, next) {
  const scope = req.user?.portalScope;
  if (!scope || scope.fullAccess || !scope.waAccountId) {
    return next();
  }
  const wa = scope.waAccountId;
  if (req.query && "waAccountId" in req.query) {
    req.query.waAccountId = wa;
  }
  if (req.body && typeof req.body === "object") {
    if ("waAccountId" in req.body) req.body.waAccountId = wa;
  }
  return next();
}

module.exports = {
  STORE_PATH,
  loadStore,
  findPortal,
  createPortalSession,
  getPortalSessionUser,
  logoutPortal,
  hasPortalPermission,
  buildPublicUrl,
  resolvePublicHost,
  listPortalsForAdmin,
  listPortalUrlsForConsole,
  enforceWaScope,
};
