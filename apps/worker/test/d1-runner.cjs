const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { D1MetadataDatabase } = require("./logic-test-build/apps/worker/src/database/d1-database.js");
const { databaseFor } = require("./logic-test-build/apps/worker/src/database/factory.js");
const worker = require("./logic-test-build/apps/worker/src/index.js").default;
const { deleteCommunityItem, deleteOwnedItem, expireDueItems } = require("./logic-test-build/apps/worker/src/cleanup/cleanup-service.js");

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
    deletedAt: null, errorMessage: null, cleanupClaimedAt: null, playable: false, kind: null, fileCount: null, ownerSessionHash:null, ...extra };
}
function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readFileSync(join(__dirname, "../migrations/0001_metadata.sql"), "utf8"));
  sqlite.exec(readFileSync(join(__dirname, "../migrations/0002_live_guards.sql"), "utf8"));
  sqlite.exec(readFileSync(join(__dirname, "../migrations/0003_content_type.sql"), "utf8"));
  sqlite.exec(readFileSync(join(__dirname, "../migrations/0004_download_owner.sql"), "utf8"));
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

test("owner-only D1 deletion bypasses protection atomically, not for strangers or legacy items",async()=>{
 const {sqlite,db}=setup();try{await db.syncAccounts([account]);const owner="a".repeat(64),other="b".repeat(64);
 const row=await db.create(fixture(1,{ownerSessionHash:owner,status:"downloading"}));
 assert.equal(await db.claimForCleanup(row.publicId,now),null);assert.equal(await db.claimForCleanup(row.publicId,now,other),null);
 let calls=0;const adapter={async deleteItem(){calls++;}};
 await assert.rejects(deleteOwnedItem(db,adapter,row.publicId,now,other),e=>e.code==="not_download_owner");assert.equal(calls,0);
 const outcomes=await Promise.all([deleteOwnedItem(db,adapter,row.publicId,now,owner),deleteOwnedItem(db,adapter,row.publicId,now,owner)]);
 assert.equal(calls,1);assert.ok(outcomes.filter(Boolean).length>=1);assert.ok(outcomes.filter(Boolean).every(row=>row.status==="deleted"));assert.equal((await db.findByPublicId(row.publicId)).status,"deleted");
 assert.equal((await deleteOwnedItem(db,adapter,row.publicId,now,owner)).status,"deleted");assert.equal(calls,1);
 await assert.rejects(deleteOwnedItem(db,adapter,row.publicId,now,other),e=>e.code==="not_download_owner");
 const old=await db.create(fixture(1));assert.equal(await db.claimForCleanup(old.publicId,now,owner),null);
 await assert.rejects(deleteOwnedItem(db,adapter,old.publicId,now,owner),e=>e.code==="not_download_owner");
 }finally{sqlite.close();}
});
test("D1 owner digest is immutable and deletion failure keeps a retryable original status",async()=>{
 const {sqlite,db}=setup();try{await db.syncAccounts([account]);const owner="a".repeat(64);
 const row=await db.create(fixture(1,{ownerSessionHash:owner,status:"downloading"}));
 assert.equal((await db.update({...row,ownerSessionHash:"b".repeat(64)})).ownerSessionHash,owner);
 await assert.rejects(deleteOwnedItem(db,{async deleteItem(){throw Error("outage");}},row.publicId,now,owner));
 const retry=await db.findByPublicId(row.publicId);assert.equal(retry.deletedAt,null);assert.equal(retry.cleanupClaimedAt,null);assert.equal(retry.status,"downloading");
 assert.equal((await deleteOwnedItem(db,{async deleteItem(){}},row.publicId,now,owner)).status,"deleted");
 await assert.rejects(db.create(fixture(1,{ownerSessionHash:"invalid"})),e=>e.code==="database_unavailable");
 }finally{sqlite.close();}
});
test("Worker owner deletion waits for submission checkpoint lock without contacting Seedr",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;
 try{await db.syncAccounts([account]);const session="12345678-1234-4234-8234-123456789012";
 const {requestOwnerHash}=require("./logic-test-build/apps/worker/src/utils/owner.js");const hash=await requestOwnerHash(new Request("http://localhost",{headers:{"x-session-id":session}}));
 const row=await db.create(fixture(1,{ownerSessionHash:hash}));const lock=await db.acquireLease("submission",Date.now(),120000);
 globalThis.fetch=()=>assert.fail("no Seedr calls while admission is locked");
 const env={DB:binding,SEEDR_MODE:"live",SEEDR_ACCESS:"full",SEEDR_ACCOUNT_CONFIG:JSON.stringify([{id:account.id,label:"Test",capacityBytes:5000,secretKeyReference:"SEEDR_ACCOUNT_A_TOKEN"}])};
 const response=await worker.fetch(new Request(`http://localhost/api/downloads/${row.publicId}/delete`,{method:"POST",headers:{"x-session-id":session}}),env);
 assert.equal(response.status,409);assert.equal((await response.json()).code,"submission_busy");assert.equal((await db.findByPublicId(row.publicId)).deletedAt,null);
 await db.releaseLease("submission",lock);
 }finally{globalThis.fetch=original;sqlite.close();}
});

test("D1 preserves fractional progress and authoritative dotted-folder metadata", async () => {
 const {sqlite,db}=setup();
 try {await db.syncAccounts([account]); const row=await db.create(fixture(1,{status:"downloading",progress:1.6,displayName:"Sample.2026 [5.1]",kind:"folder",fileCount:4}));
 assert.equal(row.progress,1.6);assert.equal(row.kind,"folder");assert.equal(row.fileCount,4);
 assert.equal((await db.update({...row,progress:6.15})).progress,6.15);
 await assert.rejects(db.update({...row,kind:"not-a-kind"}),e=>e.code==="database_unavailable");
 await assert.rejects(db.update({...row,fileCount:1001}),e=>e.code==="database_unavailable");
 }finally{sqlite.close();}
});

test("existing ready items backfill owned folder type once without task writes or lifetime resets",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch; let reads=0;
 const publicId="12345678-1234-4234-8234-123456789012";
 try {await db.syncAccounts([account]); const timestamp=Date.now();const stored=await db.create(fixture(1,{publicId,seedrItemId:`linkbox:${publicId}:10:20`,displayName:"Demo.2026 [5.1]",createdAt:new Date(timestamp-3600000).toISOString(),cleanupAllowedAt:new Date(timestamp+2*3600000).toISOString(),expiresAt:new Date(timestamp+23*3600000).toISOString()}));
 globalThis.fetch=async(url,options)=>{reads++;assert.equal(options.method,"GET");assert.ok(url.endsWith("/fs/folder/10/contents"));return Response.json({id:10,path:`LinkBox-${publicId}`,parent:0,folders:[],files:[
 {id:30,name:"Sample.mp4",folder_id:10,size:99,is_video:true},{id:31,name:"English.srt",folder_id:10,size:1}]});};
 const env={DB:binding,SEEDR_MODE:"live",SEEDR_ACCESS:"full",SEEDR_ACCOUNT_A_TOKEN:"fixture-secret",SEEDR_ACCOUNT_CONFIG:JSON.stringify([{id:account.id,label:"Test",enabled:true,capacityBytes:5000,secretKeyReference:"SEEDR_ACCOUNT_A_TOKEN"}])};
 const response=await worker.fetch(new Request("http://localhost/api/downloads"),env);assert.equal(response.status,200);
 const [value]=await response.json();assert.equal(value.kind,"folder");assert.equal(value.fileCount,2);assert.equal(value.createdAt,stored.createdAt);assert.equal(value.expiresAt,stored.expiresAt);
 assert.equal(reads,1);assert.equal(JSON.stringify(value).includes("fixture-secret"),false);assert.equal(value.seedrItemId,undefined);
 await worker.fetch(new Request("http://localhost/api/downloads"),env);assert.equal(reads,1);
 }finally{globalThis.fetch=original;sqlite.close();}
});

test("D1 submission lease and session/IP cooldown are shared across isolates", async () => {
 const {sqlite,db,binding}=setup(); const other=new D1MetadataDatabase(binding);
 try {const token=await db.acquireLease("submission",1000,120000);assert.ok(token);
 assert.equal(await other.acquireLease("submission",1001,120000),null);
 await other.releaseLease("submission","not-the-owner");assert.equal(await other.acquireLease("submission",1002,120000),null);
 await db.releaseLease("submission",token);assert.ok(await other.acquireLease("submission",1003,120000));
 assert.ok(await db.acquireLease("session:hashed",1000,30000));assert.equal(await other.acquireLease("session:hashed",29999,30000),null);
 assert.ok(await other.acquireLease("session:hashed",31000,30000));await db.pruneGuards(200000);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM request_guards").get().n,0);
 }finally{sqlite.close();}
});
test("D1 stale cleanup claim is recovered with CAS and cannot be stolen early",async()=>{
 const {sqlite,db}=setup();try{await db.syncAccounts([account]);const row=await db.create(fixture(25));
 const claimed=await db.claimForCleanup(row.publicId,now);assert.equal(await db.claimForCleanup(row.publicId,new Date(Date.parse(now)+299999).toISOString()),null);
 const recovered=await db.claimForCleanup(row.publicId,new Date(Date.parse(now)+300000).toISOString());assert.ok(recovered);
 assert.equal((await db.update({...claimed,status:"deleted",deletedAt:now})).status,"deleting");
 await db.update({...recovered,status:"expired",deletedAt:recovered.cleanupClaimedAt});assert.equal((await db.listActive()).length,0);
 }finally{sqlite.close();}
});
test("expiration retries one outage without skipping other due items",async()=>{
 const {sqlite,db}=setup();try{await db.syncAccounts([account]);const failed=await db.create(fixture(25));const good=await db.create(fixture(24));
 assert.equal(await expireDueItems(db,{async deleteItem(_account,item){if(item===failed.seedrItemId)throw Error("outage");}},now),1);
 assert.equal((await db.findByPublicId(failed.publicId)).deletedAt,null);assert.equal((await db.findByPublicId(good.publicId)).status,"expired");
 }finally{sqlite.close();}
});

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
