const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { D1MetadataDatabase } = require("./logic-test-build/apps/worker/src/database/d1-database.js");
const { databaseFor } = require("./logic-test-build/apps/worker/src/database/factory.js");
const { deleteCommunityItem, expireDueItems } = require("./logic-test-build/apps/worker/src/cleanup/cleanup-service.js");

// Real SQLite executes the SAME migration/statements behind a small D1 binding
// facade. No remote account, secrets, media or helper subprocesses are involved.
// This validates SQL/business behavior, not Cloudflare's runtime implementation.
const now = "2026-10-04T12:00:00.000Z";
const account = { id: "test-account", label: "Test account", enabled: true,
  capacityBytes: 5000, usedBytes: 1000, availableBytes: 4000,
  secretKeyReference: "TEST_TOKEN_REFERENCE", lastSyncedAt: now };
function fixture(hours, extra = {}) {
  const created = new Date(Date.parse(now) - hours * 3600000);
  return { id: crypto.randomUUID(), publicId: crypto.randomUUID(), seedrAccountId: account.id,
    seedrItemId: crypto.randomUUID(), magnetHash: crypto.randomUUID(), displayName: "Test file",
    sizeBytes: 1000, status: "ready", progress: 100, createdAt: created.toISOString(),
    cleanupAllowedAt: new Date(+created + 3 * 3600000).toISOString(),
    expiresAt: new Date(+created + 24 * 3600000).toISOString(),
    deletedAt: null, errorMessage: null, cleanupClaimedAt: null, playable: false, ...extra };
}
function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readFileSync(join(__dirname, "../migrations/0001_metadata.sql"), "utf8"));
  const binding = {
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
        async run() { return { success: true, meta: sqlite.prepare(sql).run(...values) }; } };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT"); return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, db: new D1MetadataDatabase(binding), binding };
}
const tests = [];
const test = (name, run) => tests.push([name, run]);

test("live database requires D1 and never falls back to demo metadata", async () => {
  assert.throws(() => databaseFor({ SEEDR_MODE: "live" }), e => e.code === "database_unavailable");
  const { sqlite, binding } = setup();
  try { assert.ok(databaseFor({ SEEDR_MODE: "live", DB: binding }) instanceof D1MetadataDatabase); }
  finally { sqlite.close(); }
});
test("D1 accounts upsert, extend to three accounts, disable removed accounts", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account, { ...account, id: "b" }, { ...account, id: "c" }]);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM seedr_accounts WHERE enabled=1").get().n, 3);
    await db.syncAccounts([{ ...account, usedBytes: 2000, availableBytes: 3000 }]);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM seedr_accounts WHERE enabled=1").get().n, 1);
    assert.equal(sqlite.prepare("SELECT used_bytes FROM seedr_accounts WHERE id=?").get(account.id).used_bytes, 2000);
    assert.equal(sqlite.prepare("SELECT secret_key_reference FROM seedr_accounts WHERE id=?").get(account.id).secret_key_reference, "TEST_TOKEN_REFERENCE");
  } finally { sqlite.close(); }
});
test("D1 records round-trip and parameter binding handles quotes safely", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]);
    const row = fixture(4, { displayName: "Test'; DROP TABLE downloads; --", playable: true });
    assert.deepEqual(await db.create(row), row);
    assert.deepEqual(await db.findByPublicId(row.publicId), row);
    assert.deepEqual(await db.findActiveByHash(row.magnetHash), row);
    assert.equal((await db.listActive()).length, 1);
    assert.equal(await db.findByPublicId("' OR 1=1 --"), null);
  } finally { sqlite.close(); }
});
test("D1 enforces active magnet uniqueness and lifecycle/FK constraints", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); const row = await db.create(fixture(4));
    await assert.rejects(db.create(fixture(4, { magnetHash: row.magnetHash })), e => e.code === "duplicate_magnet");
    for (const changes of [{ cleanupAllowedAt: now }, { expiresAt: now }, { sizeBytes: -1 },
      { progress: 101 }, { seedrAccountId: "missing" }, { status: "deleted" }]) {
      await assert.rejects(db.create(fixture(4, changes)), e => e.code === "database_unavailable");
    }
    assert.equal((await db.listActive()).length, 1);
  } finally { sqlite.close(); }
});
test("D1 protection lasts exactly 3h; expiry selects exactly 24h", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); const protectedRow = await db.create(fixture(2));
    assert.equal(await db.claimForCleanup(protectedRow.publicId, now), null);
    const boundary = await db.create(fixture(3));
    assert.equal((await db.claimForCleanup(boundary.publicId, now)).status, "deleting");
    await db.create(fixture(23.999)); const expired = await db.create(fixture(24));
    assert.deepEqual((await db.listExpired(now)).map(row => row.id), [expired.id]);
  } finally { sqlite.close(); }
});
test("D1 concurrent cleanup calls delete remotely once", async () => {
  const { sqlite, db, binding } = setup();
  try {
    await db.syncAccounts([account]); const row = await db.create(fixture(4)); let calls = 0;
    const adapter = { async deleteItem() { calls++; } };
    const results = await Promise.all([deleteCommunityItem(db, adapter, row.publicId, now),
      deleteCommunityItem(new D1MetadataDatabase(binding), adapter, row.publicId, now)]);
    assert.equal(calls, 1); assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await db.findByPublicId(row.publicId)).status, "deleted");
    assert.equal(await deleteCommunityItem(db, adapter, row.publicId, now), null);
  } finally { sqlite.close(); }
});
test("D1 stale progress cannot undo a cleanup claim or resurrect deletion", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); const stale = await db.create(fixture(4));
    const claimed = await db.claimForCleanup(stale.publicId, now);
    assert.equal((await db.update({ ...stale, progress: 50 })).status, "deleting");
    await db.update({ ...claimed, status: "deleted", deletedAt: now });
    assert.equal((await db.update(stale)).status, "deleted");
    assert.equal((await db.listActive()).length, 0);
    await db.create(fixture(4, { magnetHash: stale.magnetHash })); // duplicate allowed after deletion
  } finally { sqlite.close(); }
});
test("D1 remote cleanup failure releases only its own claim for retry", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); const row = await db.create(fixture(4));
    await assert.rejects(deleteCommunityItem(db, { async deleteItem() { throw new Error("outage"); } }, row.publicId, now));
    const restored = await db.findByPublicId(row.publicId);
    assert.equal(restored.status, "ready"); assert.equal(restored.cleanupClaimedAt, null);
    assert.equal((await deleteCommunityItem(db, { async deleteItem() {} }, row.publicId, now)).status, "deleted");
  } finally { sqlite.close(); }
});
test("D1 repeated expiration is idempotent and preserves protected files", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); await db.create(fixture(24)); const protectedRow = await db.create(fixture(2));
    let calls = 0; const adapter = { async deleteItem() { calls++; } };
    assert.equal(await expireDueItems(db, adapter, now), 1);
    assert.equal(await expireDueItems(db, adapter, now), 0); assert.equal(calls, 1);
    assert.equal((await db.findByPublicId(protectedRow.publicId)).status, "ready");
  } finally { sqlite.close(); }
});
test("D1 raw provider errors never appear in public database errors", async () => {
  const db = new D1MetadataDatabase({ prepare() { throw new Error("private SQL and internal identifier"); } });
  await assert.rejects(db.listActive(), e => e.code === "database_unavailable" && !e.message.includes("private"));
});
(async () => { for (const [name, run] of tests) { await run(); console.log(`✓ ${name}`); }
  console.log(`${tests.length} D1 SQL/integration tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
