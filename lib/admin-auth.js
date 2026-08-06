/**
 * مستخدمو لوحة التحكم — data/admin-users.json + جلسات في الذاكرة
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_PATH = path.join(DATA_DIR, "admin-users.json");

const ROLES = ["admin", "editor", "viewer"];
const ROLE_LABELS = {
  admin: "مدير",
  editor: "محرر",
  viewer: "عرض فقط",
};

const ALL_PERMISSIONS = [
  "settings:read",
  "settings:write",
  "stats:read",
  "users:manage",
  "whatsapp:manage",
];

const PERM_LABELS = {
  "settings:read": "قراءة إعدادات البوت",
  "settings:write": "تعديل إعدادات البوت",
  "stats:read": "إحصائية المكالمات وسجل العملاء",
  "users:manage": "إدارة مستخدمي اللوحة",
  "whatsapp:manage": "الجوالات وربط واتساب",
};

const PERMISSIONS = {
  admin: [...ALL_PERMISSIONS],
  editor: ["settings:read", "settings:write", "stats:read"],
  viewer: ["stats:read"],
};

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, { userId: string, expiresAt: number }>} */
const sessions = new Map();

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(String(password), salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(test, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

function loadUsersFile() {
  try {
    if (fs.existsSync(USERS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
      if (Array.isArray(raw.users)) return raw.users;
    }
  } catch (err) {
    console.warn("تعذر قراءة admin-users.json:", err.message);
  }
  return [];
}

function saveUsersFile(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    USERS_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), users }, null, 2),
    "utf8"
  );
}

function validatePermissions(list) {
  if (!Array.isArray(list)) throw new Error("صلاحيات غير صالحة");
  const unique = [...new Set(list.map((p) => String(p).trim()))];
  const invalid = unique.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (invalid.length) throw new Error("صلاحية غير معروفة: " + invalid.join(", "));
  return unique;
}

function getEffectivePermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions) && user.permissions.length) {
    return user.permissions.filter((p) => ALL_PERMISSIONS.includes(p));
  }
  return PERMISSIONS[user.role] || [];
}

function permissionsMatchRole(role, permissions) {
  const rolePerms = PERMISSIONS[role] || [];
  const a = [...rolePerms].sort().join(",");
  const b = [...permissions].sort().join(",");
  return a === b;
}

function sanitizeUser(user) {
  const custom =
    Array.isArray(user.permissions) && user.permissions.length > 0;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: Boolean(user.active),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    permissions: custom ? getEffectivePermissions(user) : null,
    usesCustomPermissions: custom,
    effectivePermissions: getEffectivePermissions(user),
  };
}

function hasUsers() {
  return loadUsersFile().length > 0;
}

function findUserByUsername(username) {
  const norm = String(username || "").trim().toLowerCase();
  return loadUsersFile().find((u) => u.username === norm && u.active !== false) || null;
}

function findUserById(id) {
  return loadUsersFile().find((u) => u.id === id) || null;
}

function validateUsername(username) {
  const u = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(u)) {
    throw new Error("اسم المستخدم: 3–32 حرفاً (حروف إنجليزية، أرقام، _)");
  }
  return u;
}

function validatePassword(password) {
  const p = String(password || "");
  if (p.length < 6) throw new Error("كلمة المرور 6 أحرف على الأقل");
  return p;
}

function validateRole(role) {
  const r = String(role || "").trim();
  if (!ROLES.includes(r)) throw new Error("صلاحية غير صالحة");
  return r;
}

/**
 * أول تشغيل: إنشاء مدير من ADMIN_PASSWORD أو ADMIN_INIT_PASSWORD
 */
function bootstrapFromEnv() {
  if (hasUsers()) return null;

  const pass =
    String(process.env.ADMIN_INIT_PASSWORD || process.env.ADMIN_PASSWORD || "").trim() ||
    null;

  const password = pass || "admin123";
  const user = createUser({
    username: "admin",
    password,
    displayName: "مدير النظام",
    role: "admin",
  });

  if (!pass) {
    console.warn("============================================");
    console.warn("  تم إنشاء مستخدم افتراضي للوحة:");
    console.warn("  المستخدم: admin");
    console.warn("  كلمة المرور: admin123");
    console.warn("  غيّرها فوراً من: المستخدمون → تعديل");
    console.warn("============================================");
  }

  return user;
}

function createUser({ username, password, displayName, role }) {
  const users = loadUsersFile();
  const u = validateUsername(username);
  if (users.some((x) => x.username === u)) {
    throw new Error("اسم المستخدم مستخدم مسبقاً");
  }

  const { salt, hash } = hashPassword(validatePassword(password));
  const user = {
    id: newId(),
    username: u,
    displayName: String(displayName || u).trim() || u,
    role: validateRole(role || "viewer"),
    active: true,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };

  users.push(user);
  saveUsersFile(users);
  return sanitizeUser(user);
}

function setupFirstAdmin({ username, password, displayName }) {
  if (hasUsers()) throw new Error("تم إعداد المستخدمين مسبقاً");
  return createUser({
    username: username || "admin",
    password,
    displayName: displayName || "مدير النظام",
    role: "admin",
  });
}

function login(username, password) {
  const user = findUserByUsername(username);
  if (!user || user.active === false) {
    return { ok: false, error: "بيانات الدخول غير صحيحة" };
  }
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return { ok: false, error: "بيانات الدخول غير صحيحة" };
  }

  const users = loadUsersFile();
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx >= 0) {
    users[idx].lastLoginAt = new Date().toISOString();
    saveUsersFile(users);
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  return { ok: true, token, user: sanitizeUser(user) };
}

function logout(token) {
  if (token) sessions.delete(token);
}

function getSessionUser(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = findUserById(session.userId);
  if (!user || user.active === false) return null;
  return sanitizeUser(user);
}

function hasPermission(user, perm) {
  if (!user) return false;
  const full = findUserById(user.id) || user;
  return getEffectivePermissions(full).includes(perm);
}

function getUserDetail(id) {
  const user = findUserById(id);
  if (!user) throw new Error("المستخدم غير موجود");
  const safe = sanitizeUser(user);
  return {
    user: safe,
    permissionOptions: ALL_PERMISSIONS.map((key) => ({
      key,
      label: PERM_LABELS[key] || key,
    })),
    rolePresets: ROLES.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      permissions: PERMISSIONS[role] || [],
    })),
  };
}

function listUsers() {
  return loadUsersFile().map(sanitizeUser);
}

function updateUser(id, fields, actorId) {
  const users = loadUsersFile();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("المستخدم غير موجود");

  const admins = users.filter((u) => u.role === "admin" && u.active !== false);
  if (fields.active === false && users[idx].id === actorId) {
    throw new Error("لا يمكن تعطيل حسابك");
  }
  if (fields.role && fields.role !== "admin" && users[idx].role === "admin" && admins.length <= 1) {
    throw new Error("يجب بقاء مدير واحد على الأقل");
  }

  if (fields.displayName !== undefined) {
    users[idx].displayName = String(fields.displayName).trim() || users[idx].username;
  }
  if (fields.role !== undefined) {
    users[idx].role = validateRole(fields.role);
  }
  if (fields.active !== undefined) {
    users[idx].active = Boolean(fields.active);
  }
  if (fields.permissions !== undefined) {
    if (fields.permissions === null || fields.permissions === false) {
      delete users[idx].permissions;
    } else {
      users[idx].permissions = validatePermissions(fields.permissions);
      if (permissionsMatchRole(users[idx].role, users[idx].permissions)) {
        delete users[idx].permissions;
      }
    }
  }

  saveUsersFile(users);
  return sanitizeUser(users[idx]);
}

function deleteUser(id, actorId) {
  if (id === actorId) throw new Error("لا يمكن حذف حسابك");
  const users = loadUsersFile();
  const target = users.find((u) => u.id === id);
  if (!target) throw new Error("المستخدم غير موجود");

  const admins = users.filter((u) => u.role === "admin" && u.active !== false);
  if (target.role === "admin" && admins.length <= 1) {
    throw new Error("لا يمكن حذف آخر مدير");
  }

  const next = users.filter((u) => u.id !== id);
  saveUsersFile(next);
  for (const [token, sess] of sessions.entries()) {
    if (sess.userId === id) sessions.delete(token);
  }
  return { ok: true };
}

function setUserPassword(id, newPassword, actorId) {
  const users = loadUsersFile();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("المستخدم غير موجود");

  const actor = findUserById(actorId);
  const isSelf = id === actorId;
  if (!isSelf && actor?.role !== "admin") {
    throw new Error("غير مصرح");
  }

  const { salt, hash } = hashPassword(validatePassword(newPassword));
  users[idx].passwordSalt = salt;
  users[idx].passwordHash = hash;
  saveUsersFile(users);
  return { ok: true };
}

function verifyLegacyPassword(password) {
  const legacy = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!legacy) return false;
  return String(password || "").trim() === legacy;
}

function legacyAdminUser() {
  return {
    id: "legacy",
    username: "admin",
    displayName: "مدير (ADMIN_PASSWORD)",
    role: "admin",
    active: true,
  };
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  ALL_PERMISSIONS,
  PERM_LABELS,
  USERS_PATH,
  bootstrapFromEnv,
  hasUsers,
  setupFirstAdmin,
  createUser,
  login,
  logout,
  getSessionUser,
  hasPermission,
  listUsers,
  getUserDetail,
  getEffectivePermissions,
  updateUser,
  deleteUser,
  setUserPassword,
  verifyLegacyPassword,
  legacyAdminUser,
  sanitizeUser,
};
