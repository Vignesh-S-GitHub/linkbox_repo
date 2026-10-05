import assert from "node:assert/strict";
import { test } from "node:test";
import { adminDigest, renderAdminVars } from "./admin-setup.mjs";
test("admin keys require a long header-safe secret and never occur in errors",()=>{
  for(const key of ["short"," ".repeat(32),"x".repeat(129),"x".repeat(32)+"\n", "☁".repeat(32)])assert.throws(()=>adminDigest(key),error=>!error.message.includes(key));
  assert.equal(adminDigest("x".repeat(32)),"c62e4615bd39e222572f3a1bf7c2132ea1e65b17ec805047bd6b2842c593493f");
});
test("local setup stores only a digest and preserves existing private configuration",()=>{
  const key="private-fixture-admin-key-"+"x".repeat(32),digest=adminDigest(key);
  const previous="SEEDR_MODE=live\r\nSEEDR_ACCOUNT_A_TOKEN=fixture\r\nLINKBOX_ADMIN_KEY_SHA256=old\r\nexport LINKBOX_ADMIN_KEY_SHA256=duplicate\r\n";
  const result=renderAdminVars(previous,digest);
  assert.ok(result.includes("SEEDR_ACCOUNT_A_TOKEN=fixture"));assert.ok(result.includes(`LINKBOX_ADMIN_KEY_SHA256=${digest}`));
  assert.equal(result.split("LINKBOX_ADMIN_KEY_SHA256").length,2);assert.ok(!result.includes(key));
  assert.throws(()=>renderAdminVars(previous,"raw-secret"));
});
