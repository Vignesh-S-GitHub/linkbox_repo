const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { D1MetadataDatabase } = require("./logic-test-build/apps/worker/src/database/d1-database.js");
const { databaseFor } = require("./logic-test-build/apps/worker/src/database/factory.js");
const worker = require("./logic-test-build/apps/worker/src/index.js").default;
const { deleteOwnedItem, expireDueItems } = require("./logic-test-build/apps/worker/src/cleanup/cleanup-service.js");

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
  sqlite.exec(readFileSync(join(__dirname, "../migrations/0005_account_configuration.sql"), "utf8"));
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

test("owner-only D1 deletion is immediate and atomic, not for strangers or legacy items",async()=>{
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
test("D1 automatic claims and expiry begin exactly at 24h, not 3h", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]);
    for (const hours of [0, 2, 3, 4, 23.999]) {
      const row = await db.create(fixture(hours));
      assert.equal(await db.claimForCleanup(row.publicId, now), null);
    }
    const expired = await db.create(fixture(24));
    assert.deepEqual((await db.listExpired(now)).map(row => row.id), [expired.id]);
    assert.equal((await db.claimForCleanup(expired.publicId, now)).status, "deleting");
  } finally { sqlite.close(); }
});
test("D1 concurrent cleanup calls delete remotely once", async () => {
  const { sqlite, db, binding } = setup();
  try {
    await db.syncAccounts([account]); const row = await db.create(fixture(24)); let calls = 0;
    const adapter = { async deleteItem() { calls++; } };
    const results = await Promise.all([expireDueItems(db, adapter, now),
      expireDueItems(new D1MetadataDatabase(binding), adapter, now)]);
    assert.equal(calls, 1); assert.equal(results.reduce((sum, count) => sum + count, 0), 1);
    assert.equal((await db.findByPublicId(row.publicId)).status, "expired");
    assert.equal(await expireDueItems(db, adapter, now), 0);
  } finally { sqlite.close(); }
});
test("D1 stale progress cannot undo a cleanup claim or resurrect deletion", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); const stale = await db.create(fixture(24));
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
    await db.syncAccounts([account]); const row = await db.create(fixture(4, {ownerSessionHash:"a".repeat(64)}));
    await assert.rejects(deleteOwnedItem(db, { async deleteItem() { throw new Error("outage"); } }, row.publicId, now, row.ownerSessionHash));
    const restored = await db.findByPublicId(row.publicId);
    assert.equal(restored.status, "ready"); assert.equal(restored.cleanupClaimedAt, null);
    assert.equal((await deleteOwnedItem(db, { async deleteItem() {} }, row.publicId, now, row.ownerSessionHash)).status, "deleted");
  } finally { sqlite.close(); }
});
test("D1 repeated expiration is idempotent and preserves all unexpired files", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); await db.create(fixture(24)); const unexpired = [];
    for (const hours of [2, 3, 4, 23.999]) unexpired.push(await db.create(fixture(hours)));
    let calls = 0; const adapter = { async deleteItem() { calls++; } };
    assert.equal(await expireDueItems(db, adapter, now), 1);
    assert.equal(await expireDueItems(db, adapter, now), 0); assert.equal(calls, 1);
    for (const row of unexpired) assert.equal((await db.findByPublicId(row.publicId)).status, "ready");
  } finally { sqlite.close(); }
});
const adminKey="fixture-private-admin-key-"+"x".repeat(32);
const adminHash=require("node:crypto").createHash("sha256").update(adminKey).digest("hex");
const configA={id:"admin-a",label:"Private account A",enabled:true,capacityBytes:5000,secretKeyReference:"SEEDR_ACCOUNT_A_TOKEN"};
function adminEnv(binding,extra={}) {return {DB:binding,SEEDR_MODE:"live",SEEDR_ACCESS:"full",ALLOWED_ORIGIN:"https://app.example",LINKBOX_ADMIN_KEY_SHA256:adminHash,SEEDR_ACCOUNT_CONFIG:JSON.stringify([configA]),SEEDR_ACCOUNT_A_TOKEN:"fixture-A",SEEDR_ACCOUNT_B_TOKEN:"fixture-B",SEEDR_ACCOUNT_C_TOKEN:"fixture-C",...extra};}
function adminRequest(path="",body,key=adminKey,origin="https://app.example") {return new Request(`https://worker.example/api/admin/accounts${path}`,{method:body?"POST":"GET",headers:{authorization:`Bearer ${key}`,origin,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});}
const addB={label:"Private account B",secretKeyReference:"SEEDR_ACCOUNT_B_TOKEN",distinctAccount:true};
test("admin authentication fails closed with no Seedr calls; wrong-key retries are throttled",async()=>{
 const {sqlite,binding}=setup(),original=globalThis.fetch;try{
 globalThis.fetch=()=>assert.fail("unauthorized request must never reach Seedr");const env=adminEnv(binding);
 assert.equal((await worker.fetch(adminRequest("",undefined,"bad"),env)).status,401);
 assert.equal((await worker.fetch(adminRequest("",undefined,"bad"),env)).status,429);
 assert.equal((await worker.fetch(adminRequest(),adminEnv(binding,{LINKBOX_ADMIN_KEY_SHA256:undefined}))).status,503);
 assert.equal((await worker.fetch(adminRequest("",addB,adminKey,"https://evil.example"),env)).status,403);
 assert.equal((await worker.fetch(new Request("http://worker.example/api/admin/accounts",{headers:{authorization:`Bearer ${adminKey}`}}),env)).status,403);
 const preflight=await worker.fetch(new Request("https://worker.example/api/admin/accounts",{method:"OPTIONS",headers:{origin:"https://app.example"}}),env);
 assert.equal(preflight.status,204);assert.ok(preflight.headers.get("access-control-allow-headers").includes("authorization"));
 assert.equal((await worker.fetch(adminRequest("",addB),adminEnv(binding,{SEEDR_ACCESS:"storage-only"}))).status,409);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM account_configuration").get().n,0);
 }finally{globalThis.fetch=original;sqlite.close();}
});
test("admin additions persist verified quota and expose only combined storage to visitors",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;let calls=0;try{
 const env=adminEnv(binding);globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.method,"GET");assert.equal(url,"https://www.seedr.cc/api/v0.1/p/me/quota");return Response.json({space_max:options.headers.Authorization==="Bearer fixture-B"?7000:5000,space_used:1000});};
 const response=await worker.fetch(adminRequest("",addB),env);assert.equal(response.status,200);const value=await response.json();
 assert.equal(value.accounts.length,2);assert.equal(value.accounts[1].capacityBytes,7000);assert.equal(calls,1);
 for(const secret of [adminKey,adminHash,"fixture-A","fixture-B","secretKeyReference"])assert.ok(!JSON.stringify(value).includes(secret));
 assert.equal((await worker.fetch(adminRequest("",{...addB,label:"Again"}),env)).status,409);assert.equal(calls,1);
 assert.equal((await worker.fetch(adminRequest("",{...addB,secretKeyReference:"SEEDR_ACCOUNT_C_TOKEN",label:"Private account C"}),env)).status,200);
 assert.equal((await new D1MetadataDatabase(binding).accountConfigurations()).length,2);
 const storage=await worker.fetch(new Request("https://worker.example/api/storage"),env);assert.equal(storage.status,200);const publicValue=await storage.json();assert.equal(publicValue.capacityBytes,17000);
 assert.ok(!JSON.stringify(publicValue).includes("Private account"));assert.equal(publicValue.accounts,undefined);assert.equal(publicValue.secretKeyReference,undefined);
 const stored=(await db.accountConfigurations())[0];await assert.rejects(db.saveAccountConfiguration({...stored,secretKeyReference:"SEEDR_CHANGED_TOKEN"}),error=>error.code==="account_reference_immutable");
 }finally{globalThis.fetch=original;sqlite.close();}
});
test("bad admin additions reject tokens, duplicate tokens and provider failures without saving",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;try{
 const env=adminEnv(binding);let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({private:"provider secret"},{status:401});};
 for(const body of [{...addB,token:"never-store"},{...addB,distinctAccount:false},{...addB,label:"bad\nlabel"},{...addB,secretKeyReference:"SEEDR_MISSING_TOKEN"}])assert.ok((await worker.fetch(adminRequest("",body),env)).status>=400);
 assert.equal((await worker.fetch(adminRequest("",addB),adminEnv(binding,{SEEDR_ACCOUNT_B_TOKEN:"fixture-A"}))).status,409);assert.equal(calls,0);
 const failed=await worker.fetch(adminRequest("",addB),env);assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes("provider secret"));assert.equal(calls,1);assert.deepEqual(await db.accountConfigurations(),[]);
 const lock=await db.acquireLease("submission",Date.now(),120000);assert.equal((await worker.fetch(adminRequest("",addB),env)).status,409);assert.equal(calls,1);await db.releaseLease("submission",lock);
 }finally{globalThis.fetch=original;sqlite.close();}
});
test("disabling an account blocks admission only, keeps history and cannot disable the last account",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;try{
 const env=adminEnv(binding);globalThis.fetch=async()=>Response.json({space_max:5000,space_used:1000});
 assert.equal((await worker.fetch(adminRequest("",addB),env)).status,200);
 assert.equal((await worker.fetch(adminRequest("/admin-a",{enabled:false}),env)).status,200);
 const {configuredAccounts}=require("./logic-test-build/apps/worker/src/accounts/configuration.js");
 const configs=await configuredAccounts(env,db);assert.equal(configs.find(value=>value.id==="admin-a").enabled,false);
 const remaining=configs.find(value=>value.enabled);assert.equal((await worker.fetch(adminRequest(`/${remaining.id}`,{enabled:false}),env)).status,409);
 const {LiveSeedrAdapter}=require("./logic-test-build/apps/worker/src/seedr/live-adapter.js");const adapter=new LiveSeedrAdapter(configs,env);const publicId=crypto.randomUUID();let checked=false;
 globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,"Bearer fixture-A");checked=true;assert.ok(url.endsWith("/fs/folder/10/contents"));return Response.json({id:10,path:`LinkBox-${publicId}`,parent:0,files:[],folders:[]});};
 await adapter.contents("admin-a",`linkbox:${publicId}:10:0`);assert.ok(checked);
 globalThis.fetch=async()=>Response.json({space_max:5000,space_used:1000});assert.equal((await worker.fetch(adminRequest("/admin-a",{enabled:true}),env)).status,200);
 }finally{globalThis.fetch=original;sqlite.close();}
});
test("mock account verification stays offline and configuration changes retain existing items",async()=>{
 const {MockSeedrAdapter}=require("./logic-test-build/apps/worker/src/seedr/mock-adapter.js");const original=globalThis.fetch;
 try{globalThis.fetch=()=>assert.fail("mock must remain offline");const config={...configA,id:"seedr-a",capacityBytes:5*1024**3};const adapter=new MockSeedrAdapter([config]);
 const item=await adapter.addMagnet("seedr-a","magnet:?xt=urn:btih:"+"a".repeat(40)+"&xl=100&dn=Sample.mp4");
 adapter.configureAccounts([{...config,enabled:false},{...config,id:"b"}]);assert.equal((await adapter.syncAccounts()).length,1);assert.equal((await adapter.getItem("seedr-a",item.itemId)).sizeBytes,100);assert.equal((await adapter.verifyAccount("SEEDR_NEW_TOKEN")).capacityBytes,5*1024**3);
 await adapter.deleteItem("seedr-a",item.itemId);await assert.rejects(adapter.getItem("seedr-a",item.itemId));
 }finally{globalThis.fetch=original;}
});
test("account limits and concurrent changes fail safely before quota or metadata writes",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;try{
 const env=adminEnv(binding);const configs=Array.from({length:8},(_,index)=>({...configA,id:`a-${index}`,secretKeyReference:`SEEDR_ACCOUNT_${index}_TOKEN`}));
 globalThis.fetch=()=>assert.fail("account limit must reject before contacting Seedr");
 assert.equal((await worker.fetch(adminRequest("",addB),{...env,SEEDR_ACCOUNT_CONFIG:JSON.stringify(configs)})).status,409);assert.deepEqual(await db.accountConfigurations(),[]);
 let unblock;let calls=0;const waiting=new Promise(resolve=>{unblock=resolve;});globalThis.fetch=async()=>{calls++;await waiting;return Response.json({space_max:5000,space_used:0});};
 const first=worker.fetch(adminRequest("",addB),env);
 // Wait until the first request holds the admission lease, not for a wall-clock sleep.
 const start=Date.now();while(!calls&&Date.now()-start<5000)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 assert.equal((await worker.fetch(adminRequest("",addB),env)).status,409);unblock();assert.equal((await first).status,200);assert.equal(calls,1);assert.equal((await db.accountConfigurations()).length,1);
 }finally{globalThis.fetch=original;sqlite.close();}
});
test("Cron still expires app-owned downloads on a disabled account using its retained secret",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;const publicId=crypto.randomUUID();let pending;const deleted=[];
 try {
 const env=adminEnv(binding),timestamp=new Date(Date.now()-25*3600000).toISOString();
 await db.saveAccountConfiguration({...configA,enabled:false});await db.saveAccountConfiguration({...configA,id:"admin-b",secretKeyReference:"SEEDR_ACCOUNT_B_TOKEN"});
 await db.syncAccounts([{...configA,usedBytes:1000,availableBytes:4000,lastSyncedAt:new Date().toISOString()}]);
 const row=await db.create(fixture(25,{publicId,seedrAccountId:"admin-a",seedrItemId:`linkbox:${publicId}:10:20`,createdAt:timestamp,cleanupAllowedAt:new Date(Date.parse(timestamp)+3*3600000).toISOString(),expiresAt:new Date(Date.parse(timestamp)+24*3600000).toISOString()}));
 globalThis.fetch=async(url,options)=>{
 const path=new URL(url).pathname.replace("/api/v0.1/p","");
 if(path==="/me/quota"){assert.equal(options.headers.Authorization,"Bearer fixture-B");return Response.json({space_max:5000,space_used:0});}
 assert.equal(options.headers.Authorization,"Bearer fixture-A");
 if(options.method==="DELETE"){deleted.push(path);return Response.json({success:true});}
 if(path==="/fs/folder/10/contents")return Response.json({id:10,path:`LinkBox-${publicId}`,files:[],folders:[]});
 if(path==="/tasks/20")return Response.json({task:{id:20,folder_id:10}});
 assert.fail("Unexpected mock endpoint");
 };
 worker.scheduled({},env,{waitUntil(value){pending=value;}});await pending;
 assert.deepEqual(deleted,["/tasks/20","/fs/folder/10"]);assert.equal((await db.findByPublicId(row.publicId)).status,"expired");
 }finally{globalThis.fetch=original;sqlite.close();}
});
test("D1 raw provider errors never appear in public database errors", async () => {
  const db = new D1MetadataDatabase({ prepare() { throw new Error("private SQL and internal identifier"); } });
  await assert.rejects(db.listActive(), e => e.code === "database_unavailable" && !e.message.includes("private"));
});
(async () => { for (const [name, run] of tests) { await run(); console.log(`✓ ${name}`); }
  console.log(`${tests.length} D1 SQL/integration tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
