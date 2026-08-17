/**
 * اللوحة المفتوحة بدون كلمة مرور على السحابة
 */
const assert = require("assert");
const auth = require("../lib/admin-auth");

const prevOpen = process.env.ADMIN_OPEN;
const prevCloud = process.env.CLOUD;

function restore() {
  if (prevOpen == null) delete process.env.ADMIN_OPEN;
  else process.env.ADMIN_OPEN = prevOpen;
  if (prevCloud == null) delete process.env.CLOUD;
  else process.env.CLOUD = prevCloud;
}

try {
  process.env.ADMIN_OPEN = "1";
  delete process.env.CLOUD;
  assert.ok(auth.isAdminOpen(), "ADMIN_OPEN=1");
  assert.equal(auth.openAdminUser().role, "admin");

  process.env.ADMIN_OPEN = "0";
  process.env.CLOUD = "1";
  assert.ok(!auth.isAdminOpen(), "ADMIN_OPEN=0 يقفل حتى مع CLOUD");

  delete process.env.ADMIN_OPEN;
  process.env.CLOUD = "1";
  assert.ok(auth.isAdminOpen(), "CLOUD=1 يفتح اللوحة");

  delete process.env.ADMIN_OPEN;
  delete process.env.CLOUD;
  assert.ok(!auth.isAdminOpen(), "محلي بدون CLOUD يبقى بقفل");

  console.log("smoke-admin-open: OK");
} finally {
  restore();
}
