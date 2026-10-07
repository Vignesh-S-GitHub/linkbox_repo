const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { D1MetadataDatabase } = require("./logic-test-build/apps/worker/src/database/d1-database.js");
const { databaseFor } = require("./logic-test-build/apps/worker/src/database/factory.js");
const worker = require("./logic-test-build/apps/worker/src/index.js").default;
const { deleteSharedItem, expireDueItems } = require("./logic-test-build/apps/worker/src/cleanup/cleanup-service.js");

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

async function pendingFixture(minutes,changes={},envChanges={}) {
 const state=setup(),created=Date.now()-minutes*60000,publicId=crypto.randomUUID();
 const configured={...account,enabled:true,capacityBytes:5*1024**3,secretKeyReference:"SEEDR_ACCOUNT_A_TOKEN"};
 await state.db.syncAccounts([{...configured,usedBytes:0,availableBytes:configured.capacityBytes,lastSyncedAt:new Date().toISOString()}]);
 const row=await state.db.create(fixture(1,{publicId,seedrItemId:`linkbox:${publicId}:10:0`,status:"fetching_metadata",sizeBytes:0,progress:0,
 createdAt:new Date(created).toISOString(),cleanupAllowedAt:new Date(created+3*3600000).toISOString(),expiresAt:new Date(created+24*3600000).toISOString(),...changes}));
 const env={DB:state.binding,SEEDR_MODE:"live",SEEDR_ACCESS:"full",SEEDR_ACCOUNT_CONFIG:JSON.stringify([configured]),SEEDR_ACCOUNT_A_TOKEN:"fixture-secret",...envChanges};
 return {...state,row,env,publicId};
}

test("missing task becomes a durable failed record after grace, without provider deletion or repeated polls",async()=>{
 const state=await pendingFixture(6),original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.method,"GET");
 return url.endsWith("/tasks")?Response.json({tasks:[]}):Response.json({id:10,path:`LinkBox-${state.publicId}`,size:0,files:[],folders:[]});};
 const response=await worker.fetch(new Request("http://localhost/api/downloads"),state.env);assert.equal(response.status,200);
 const [file]=await response.json();assert.equal(file.status,"failed");assert.match(file.errorMessage,/did not confirm/);assert.equal(file.displayName,"Test file");
 assert.equal(file.createdAt,state.row.createdAt);assert.equal(file.expiresAt,state.row.expiresAt);assert.equal(file.taskMissing,undefined);assert.equal(file.seedrItemId,undefined);
 await worker.fetch(new Request("http://localhost/api/downloads"),state.env);assert.equal(calls,2);
 assert.equal((await state.db.findByPublicId(state.publicId)).deletedAt,null);
 }finally{globalThis.fetch=original;state.sqlite.close();}
});

test("brief missing-task reconciliation remains pending; actual slow transfers survive metadata timeout",async()=>{
 const original=globalThis.fetch;
 for(const [minutes,task] of [[1,null],[20,{size:1024,progress:0,state:"queued"}],[20,{size:1024,progress:1.6,state:"downloading"}]]){
 const state=await pendingFixture(minutes);
 try{globalThis.fetch=async(url,options)=>{assert.equal(options.method,"GET");
 if(url.endsWith("/tasks"))return Response.json({tasks:task?[{id:20,folder_id:10}]:[]});
 if(url.endsWith("/tasks/20"))return Response.json({task:{id:20,folder_id:10,name:"Slow sample",error:null,...task}});
 return Response.json({id:10,path:`LinkBox-${state.publicId}`,size:0,files:[],folders:[]});};
 const [file]=await(await worker.fetch(new Request("http://localhost/api/downloads"),state.env)).json();assert.notEqual(file.status,"failed");assert.equal(file.progress,task?.progress??0);
 }finally{globalThis.fetch=original;state.sqlite.close();}
 }
});

test("metadata timeout bounds existing zero-size task and repeated outages, without deleting source content",async()=>{
 const original=globalThis.fetch;
 for(const outage of [false,true]){const state=await pendingFixture(16);
 try{globalThis.fetch=async(url,options)=>{assert.equal(options.method,"GET");if(outage)return new Response(null,{status:503});
 if(url.endsWith("/tasks"))return Response.json({tasks:[{id:20,folder_id:10}]});
 if(url.endsWith("/tasks/20"))return Response.json({task:{id:20,folder_id:10,name:"Waiting sample",size:0,state:"queued",progress:0,error:null}});
 return Response.json({id:10,path:`LinkBox-${state.publicId}`,size:0,files:[],folders:[]});};
 const [file]=await(await worker.fetch(new Request("http://localhost/api/downloads"),state.env)).json();assert.equal(file.status,"failed");assert.match(file.errorMessage,/15 minutes/);assert.equal(file.deletedAt,null);
 }finally{globalThis.fetch=original;state.sqlite.close();}}
});

test("resolved 8 GB item is stopped on 5 GB account even when app maximum is 10 GB",async()=>{
 const state=await pendingFixture(1,{}, {MAX_FILE_SIZE_BYTES:String(10*1024**3)}),original=globalThis.fetch,deleted=[];
 try{await state.db.syncAccounts([{...account,capacityBytes:5*1024**3,usedBytes:0,availableBytes:5*1024**3,lastSyncedAt:new Date().toISOString()},
 {...account,id:"b",capacityBytes:4.5*1024**3,usedBytes:0,availableBytes:4.5*1024**3,lastSyncedAt:new Date().toISOString()}]);
 globalThis.fetch=async(url,options)=>{
 const path=new URL(url).pathname.replace("/api/v0.1/p","");
 if(options.method==="DELETE"){deleted.push(path);return Response.json({success:true});}
 if(path==="/tasks")return Response.json({tasks:[{id:20,folder_id:10}]});
 if(path==="/tasks/20")return Response.json({task:{id:20,folder_id:10,name:"Large authorized archive",size:8*1024**3,state:"downloading",progress:1.6,error:null}});
 return Response.json({id:10,path:`LinkBox-${state.publicId}`,size:0,files:[],folders:[]});};
 const [file]=await(await worker.fetch(new Request("http://localhost/api/downloads"),state.env)).json();assert.equal(file.status,"failed");assert.equal(file.sizeBytes,8*1024**3);assert.match(file.errorMessage,/too large.*storage account/);assert.match(file.errorMessage,/removed/);
 assert.deepEqual(deleted,["/tasks/20","/fs/folder/10"]);assert.equal((await state.db.findByPublicId(state.publicId)).cleanupClaimedAt,null);
 await worker.fetch(new Request("http://localhost/api/downloads"),state.env);assert.equal(deleted.length,2);
 }finally{globalThis.fetch=original;state.sqlite.close();}
});

test("failed oversized removal remains visible and owner/Cron retryable",async()=>{
 const state=await pendingFixture(1),original=globalThis.fetch;
 try{globalThis.fetch=async(url,options)=>{
 if(options.method==="DELETE")return new Response(null,{status:503});
 if(url.endsWith("/tasks"))return Response.json({tasks:[{id:20,folder_id:10}]});
 if(url.endsWith("/tasks/20"))return Response.json({task:{id:20,folder_id:10,name:"Large archive",size:8*1024**3,state:"downloading",progress:1,error:null}});
 return Response.json({id:10,path:`LinkBox-${state.publicId}`,size:0,files:[],folders:[]});};
 const [file]=await(await worker.fetch(new Request("http://localhost/api/downloads"),state.env)).json();assert.equal(file.status,"failed");assert.match(file.errorMessage,/Removal could not finish/);
 const stored=await state.db.findByPublicId(state.publicId);assert.equal(stored.cleanupClaimedAt,null);assert.equal(stored.deletedAt,null);assert.match(stored.seedrItemId,/:10:20$/);
 assert.ok(await state.db.claimForCleanup(state.publicId,stored.expiresAt));
 }finally{globalThis.fetch=original;state.sqlite.close();}
});

test("policy removal claim is atomic against duplicate polls, owner deletion, Cron and stale item IDs",async()=>{
 const state=await pendingFixture(1,{ownerSessionHash:"a".repeat(64)}),second=new D1MetadataDatabase(state.binding);
 try{const timestamp=new Date().toISOString();assert.equal(await state.db.claimForFailure(state.publicId,timestamp,"stale-item-id"),null);
 const outcomes=await Promise.all([state.db.claimForFailure(state.publicId,timestamp,state.row.seedrItemId),second.claimForFailure(state.publicId,timestamp,state.row.seedrItemId)]);
 assert.equal(outcomes.filter(Boolean).length,1);const claimed=outcomes.find(Boolean);
 assert.equal(await second.claimForCleanup(state.publicId,timestamp,"manual"),null);
 assert.equal((await state.db.update({...state.row,status:"downloading"})).status,"deleting");
 await state.db.update({...claimed,status:"failed",cleanupClaimedAt:null,errorMessage:"Size limit exceeded"},claimed.cleanupClaimedAt);
 assert.equal(await second.claimForCleanup(state.publicId,timestamp,"manual"),null);
 assert.ok(await second.claimForCleanup(state.publicId,state.row.cleanupAllowedAt,"manual"));
 }finally{state.sqlite.close();}
});

test("JSON-rejected submission is terminal immediately rather than uncertain metadata",async()=>{
 const {sqlite,binding}=setup(),original=globalThis.fetch;
 try{const env=adminEnv(binding),session="12345678-1234-4234-8234-123456789012";
 globalThis.fetch=async(url,options)=>{
 if(url.endsWith("/me/quota"))return Response.json({space_max:5*1024**3,space_used:0});
 if(url.endsWith("/fs/folder"))return Response.json({id:10,success:true});
 assert.ok(url.endsWith("/tasks"));assert.equal(options.method,"POST");return Response.json({success:false,error:"private quota details"});};
 const response=await worker.fetch(new Request("https://worker.example/api/downloads",{method:"POST",headers:{origin:"https://app.example","x-session-id":session,"content-type":"application/json"},body:JSON.stringify({magnet:"magnet:?xt=urn:btih:"+"a".repeat(40)})}),env);
 assert.equal(response.status,201);const file=await response.json();assert.equal(file.status,"failed");assert.match(file.errorMessage,/could not accept/);assert.ok(!JSON.stringify(file).includes("private quota details"));assert.equal(file.canDelete,true);
 }finally{globalThis.fetch=original;sqlite.close();}
});

test("D1 shared deletion enforces the exact three-hour boundary and is atomic for legacy items too",async()=>{
 const {sqlite,db,binding}=setup();try{await db.syncAccounts([account]);const owner="a".repeat(64);
 const row=await db.create(fixture(2,{ownerSessionHash:owner,status:"downloading"}));
 assert.equal(await db.claimForCleanup(row.publicId,now),null);assert.equal(await db.claimForCleanup(row.publicId,now,"manual"),null);
 let calls=0;const adapter={async deleteItem(){calls++;}};
 await assert.rejects(deleteSharedItem(db,adapter,row.publicId,now),e=>e.code==="file_protected");assert.equal(calls,0);
 const before=new Date(Date.parse(row.cleanupAllowedAt)-1).toISOString();
 assert.equal(await db.claimForCleanup(row.publicId,before,"manual"),null);
 const outcomes=await Promise.all([deleteSharedItem(db,adapter,row.publicId,row.cleanupAllowedAt),deleteSharedItem(new D1MetadataDatabase(binding),adapter,row.publicId,row.cleanupAllowedAt)]);
 assert.equal(calls,1);assert.ok(outcomes.filter(Boolean).length>=1);assert.ok(outcomes.filter(Boolean).every(row=>row.status==="deleted"));assert.equal((await db.findByPublicId(row.publicId)).status,"deleted");
 assert.equal((await deleteSharedItem(db,adapter,row.publicId,row.cleanupAllowedAt)).status,"deleted");assert.equal(calls,1);
 const old=await db.create(fixture(4));assert.equal((await deleteSharedItem(db,adapter,old.publicId,now)).status,"deleted");
 }finally{sqlite.close();}
});
test("D1 owner digest is immutable and deletion failure keeps a retryable original status",async()=>{
 const {sqlite,db}=setup();try{await db.syncAccounts([account]);const owner="a".repeat(64);
 const row=await db.create(fixture(4,{ownerSessionHash:owner,status:"downloading"}));
 assert.equal((await db.update({...row,ownerSessionHash:"b".repeat(64)})).ownerSessionHash,owner);
 await assert.rejects(deleteSharedItem(db,{async deleteItem(){throw Error("outage");}},row.publicId,now));
 const retry=await db.findByPublicId(row.publicId);assert.equal(retry.deletedAt,null);assert.equal(retry.cleanupClaimedAt,null);assert.equal(retry.status,"downloading");
 assert.equal((await deleteSharedItem(db,{async deleteItem(){}},row.publicId,now)).status,"deleted");
 await assert.rejects(db.create(fixture(1,{ownerSessionHash:"invalid"})),e=>e.code==="database_unavailable");
 }finally{sqlite.close();}
});
test("Worker shared deletion waits for submission checkpoint lock without contacting Seedr",async()=>{
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
test("D1 stale progress cannot revive terminal failure; eligible shared cleanup still works", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]);
    const stale = await db.create(fixture(4, {status:"fetching_metadata",sizeBytes:0,progress:0,ownerSessionHash:"a".repeat(64)}));
    await db.update({...stale,status:"failed",errorMessage:"Metadata unavailable"});
    for (const status of ["queued","fetching_metadata","downloading","processing","ready"]) {
      const current=await db.update({...stale,status,progress:20});
      assert.equal(current.status,"failed");assert.equal(current.errorMessage,"Metadata unavailable");
    }
    const deleted=await deleteSharedItem(db,{async deleteItem(){}},stale.publicId,now);
    assert.equal(deleted.status,"deleted");
  } finally { sqlite.close(); }
});

test("D1 remote cleanup failure releases only its own claim for retry", async () => {
  const { sqlite, db } = setup();
  try {
    await db.syncAccounts([account]); const row = await db.create(fixture(4, {ownerSessionHash:"a".repeat(64)}));
    await assert.rejects(deleteSharedItem(db, { async deleteItem() { throw new Error("outage"); } }, row.publicId, now));
    const restored = await db.findByPublicId(row.publicId);
    assert.equal(restored.status, "ready"); assert.equal(restored.cleanupClaimedAt, null);
    assert.equal((await deleteSharedItem(db, { async deleteItem() {} }, row.publicId, now)).status, "deleted");
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
test("progress candidates rotate fairly instead of starving the oldest transfers",async()=>{
 const {sqlite,db}=setup();try{
 await db.syncAccounts([account]);const clock=Date.now(), rows=[];
 for(let i=0;i<4;i++)rows.push(await db.create(fixture(0,{status:"downloading",kind:"folder",createdAt:new Date(clock+i).toISOString(),cleanupAllowedAt:new Date(clock+i+10800000).toISOString(),expiresAt:new Date(clock+i+86400000).toISOString()})));
 assert.deepEqual(await db.progressCandidates(clock+10),[rows[0].publicId,rows[1].publicId]);
 for(const row of rows.slice(0,2))assert.ok(await db.acquireLease(`poll:${row.publicId}`,clock+10,15000));
 // Newest-first list ordering cannot influence fair provider work selection.
 assert.equal((await db.listActive())[0].publicId,rows[3].publicId);
 assert.deepEqual(await db.progressCandidates(clock+16000),[rows[2].publicId,rows[3].publicId]);
 for(const row of rows.slice(2))await db.acquireLease(`poll:${row.publicId}`,clock+16000,15000);
 assert.deepEqual(await db.progressCandidates(clock+16001),[rows[0].publicId,rows[1].publicId]);
 await db.update({...rows[0],status:"failed"});assert.deepEqual(await db.progressCandidates(clock+16001),[rows[1].publicId]);
 }finally{sqlite.close();}
});
test("full-storage attempts are rate limited before repeating Seedr quota calls",async()=>{
 const {sqlite,binding}=setup(),original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(url,options)=>{calls++;assert.ok(url.endsWith("/me/quota"));assert.equal(options.method,"GET");return Response.json({space_max:5000,space_used:5000});};
 const request=hash=>new Request("https://worker.example/api/downloads",{method:"POST",headers:{origin:"https://app.example","x-session-id":crypto.randomUUID(),"cf-connecting-ip":"192.0.2.20","content-type":"application/json"},body:JSON.stringify({magnet:"magnet:?xt=urn:btih:"+hash.repeat(40)})});
 assert.equal((await worker.fetch(request("a"),adminEnv(binding))).status,409);assert.equal(calls,1);
 assert.equal((await worker.fetch(request("b"),adminEnv(binding))).status,429);assert.equal(calls,1);
 }finally{globalThis.fetch=original;sqlite.close();}
});

test("live submission uses the admin-added second account when the first has 4.8 of 5 GB occupied",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch,gib=1024**3;
 const first={...configA,capacityBytes:5*gib},second={...configA,id:"admin-added-b",label:"Second account",capacityBytes:4.5*gib,secretKeyReference:"SEEDR_ACCOUNT_B_TOKEN"};
 const env=adminEnv(binding,{SEEDR_ACCOUNT_CONFIG:JSON.stringify([first])});let publicId;const writes=[];
 try{
 await db.saveAccountConfiguration(second);
 globalThis.fetch=async(url,options)=>{
  const path=new URL(url).pathname.replace("/api/v0.1/p","");
  const isSecond=options.headers.Authorization==="Bearer fixture-B";
  if(path==="/me/quota")return Response.json({space_max:isSecond?4.5*gib:5*gib,space_used:isSecond?0:Math.floor(4.8*gib)});
  assert.ok(isSecond,"file operations must use only the second account token");
  if(options.method==="POST")writes.push(path);
  if(path==="/fs/folder"&&options.method==="POST"){
   const body=JSON.parse(options.body);publicId=body.name.slice("LinkBox-".length);return Response.json({id:101});
  }
  if(path==="/tasks"&&options.method==="POST"){
   assert.equal(JSON.parse(options.body).folder_id,101);return Response.json({user_torrent_id:201,title:"Authorized sample archive"});
  }
  if(path==="/tasks/201")return Response.json({task:{id:201,folder_id:101,name:"Authorized sample archive",size:2*gib,state:"downloading",progress:1.6,error:null}});
  if(path==="/fs/folder/101/contents")return Response.json({id:101,path:`LinkBox-${publicId}`,size:0,files:[],folders:[]});
  assert.fail("Unexpected fixture endpoint");
 };
 const response=await worker.fetch(new Request("https://worker.example/api/downloads",{method:"POST",headers:{origin:"https://app.example","x-session-id":crypto.randomUUID(),"content-type":"application/json"},body:JSON.stringify({magnet:"magnet:?xt=urn:btih:"+"e".repeat(40)+"&xl="+2*gib})}),env);
 assert.equal(response.status,201);const created=await response.json();
 assert.equal((await db.findByPublicId(created.id)).seedrAccountId,second.id);
 assert.deepEqual(writes,["/fs/folder","/tasks"]);
 const files=await(await worker.fetch(new Request("https://worker.example/api/downloads"),env)).json();
 assert.equal(files[0].status,"downloading");assert.equal(files[0].sizeBytes,2*gib);assert.equal(files[0].progress,1.6);assert.equal(files[0].errorMessage,undefined);
 assert.equal((await db.findByPublicId(created.id)).errorMessage,null);
 for(const privateValue of [first.id,second.id,"fixture-A","fixture-B","seedrAccountId"])assert.ok(!JSON.stringify(files).includes(privateValue));
 }finally{globalThis.fetch=original;sqlite.close();}
});
test("101-character account labels reject before contacting Seedr or writing D1",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;
 try{globalThis.fetch=()=>assert.fail("invalid label must fail before quota");
 assert.equal((await worker.fetch(adminRequest("",{...addB,label:"A".repeat(101)}),adminEnv(binding))).status,400);
 assert.deepEqual(await db.accountConfigurations(),[]);
 const {accountsFromEnv}=require("./logic-test-build/apps/worker/src/config.js");
 assert.throws(()=>accountsFromEnv({SEEDR_ACCOUNT_CONFIG:JSON.stringify([{...configA,label:"A".repeat(101)}])}));
 assert.equal(accountsFromEnv({SEEDR_ACCOUNT_CONFIG:JSON.stringify([{...configA,label:"A".repeat(100)}])})[0].label.length,100);
 }finally{globalThis.fetch=original;sqlite.close();}
});

test("confirmed task token rejection fails immediately without replaying or deleting the reservation",async()=>{
 const original=globalThis.fetch;
 for(const status of [401,403]){
  const {sqlite,db,binding}=setup();let taskPosts=0;
  try{
   globalThis.fetch=async(url,options)=>{
    const path=new URL(url).pathname.replace("/api/v0.1/p","");
    if(path==="/me/quota")return Response.json({space_max:5000,space_used:0});
    if(path==="/fs/folder"&&options.method==="POST")return Response.json({id:101});
    if(path==="/tasks"&&options.method==="POST"){taskPosts++;return new Response("private provider token body",{status});}
    assert.fail("A confirmed rejection must not retry, delete or keep polling");
   };
   const env=adminEnv(binding),request=new Request("https://worker.example/api/downloads",{method:"POST",headers:{origin:"https://app.example","x-session-id":crypto.randomUUID(),"content-type":"application/json"},body:JSON.stringify({magnet:"magnet:?xt=urn:btih:"+"f".repeat(40)})});
   const response=await worker.fetch(request,env);assert.equal(response.status,201);
   const created=await response.json();assert.equal(created.status,"failed");assert.match(created.errorMessage,/token permissions/);
   assert.ok(!JSON.stringify(created).includes("private provider"));assert.equal(taskPosts,1);
   const stored=await db.findByPublicId(created.id);assert.match(stored.seedrItemId,/:101:0$/);assert.equal(stored.deletedAt,null);assert.ok(stored.ownerSessionHash);
   const [file]=await(await worker.fetch(new Request("https://worker.example/api/downloads"),env)).json();assert.equal(file.status,"failed");assert.match(file.errorMessage,/token permissions/);assert.equal(taskPosts,1);
  }finally{globalThis.fetch=original;sqlite.close();}
 }
});
test("Worker protects all statuses from strangers and recognizes creators without exposing their private identity",async()=>{
 const {sqlite,db,binding}=setup(),original=globalThis.fetch;
 try{
  await db.syncAccounts([account]);globalThis.fetch=()=>assert.fail("protected deletes must not contact Seedr");
  const env={DB:binding,SEEDR_MODE:"live",SEEDR_ACCESS:"full",ALLOWED_ORIGIN:"http://localhost:5173",SEEDR_ACCOUNT_CONFIG:JSON.stringify([{...account,secretKeyReference:"SEEDR_ACCOUNT_A_TOKEN"}])};
  const session=crypto.randomUUID(),{requestOwnerHash}=require("./logic-test-build/apps/worker/src/utils/owner.js");
  const hash=await requestOwnerHash(new Request("http://localhost",{headers:{"x-session-id":session}}));
  for(const status of ["queued","fetching_metadata","downloading","processing","ready","failed"]){
   const created=Date.now()-2*3600000;
   const row=await db.create(fixture(2,{status,createdAt:new Date(created).toISOString(),cleanupAllowedAt:new Date(created+10800000).toISOString(),expiresAt:new Date(created+86400000).toISOString(),ownerSessionHash:status==="ready"?null:hash}));
   for(const identity of [crypto.randomUUID(),...(status==="ready"?[session]:[])]){
    const response=await worker.fetch(new Request(`http://localhost/api/downloads/${row.publicId}/delete`,{method:"POST",headers:{origin:env.ALLOWED_ORIGIN,"x-session-id":identity}}),env);
    assert.equal(response.status,403);assert.equal((await response.json()).code,"file_protected");
    const detail=await(await worker.fetch(new Request(`http://localhost/api/downloads/${row.publicId}`),env)).json();
    assert.equal(detail.canDelete,false);assert.equal(detail.cleanupAllowedAt,row.cleanupAllowedAt);
   }
   assert.equal((await db.findByPublicId(row.publicId)).cleanupClaimedAt,null);
   const creatorDetail=await(await worker.fetch(new Request(`http://localhost/api/downloads/${row.publicId}`,{headers:{"x-session-id":session}}),env)).json();
   assert.equal(creatorDetail.canDelete,status!=="ready");
   assert.ok(!JSON.stringify(creatorDetail).includes(hash)&&!JSON.stringify(creatorDetail).includes(session));
  }
 }finally{globalThis.fetch=original;sqlite.close();}
});

test("D1 creator bypass is atomic, works for every status and never permits premature Cron cleanup",async()=>{
 const {sqlite,db,binding}=setup(),owner="a".repeat(64),wrong="b".repeat(64);let calls=0;
 try{
  await db.syncAccounts([account]);
  const adapter={async deleteItem(){calls++;}};
  for(const status of ["queued","fetching_metadata","downloading","processing","ready","failed"]){
   const row=await db.create(fixture(0,{status,ownerSessionHash:owner}));
   assert.equal(await db.claimForCleanup(row.publicId,now,"expired",owner),null);
   assert.equal(await db.claimForCleanup(row.publicId,now,"manual",wrong),null);
   assert.equal(await db.claimForCleanup(row.publicId,now,"manual"),null);
   await assert.rejects(deleteSharedItem(db,adapter,row.publicId,now,wrong),e=>e.code==="file_protected");
   const before=calls;
   const result=await Promise.all([deleteSharedItem(db,adapter,row.publicId,now,owner),deleteSharedItem(new D1MetadataDatabase(binding),adapter,row.publicId,now,owner)]);
   assert.equal(result.filter(Boolean).length,1);assert.equal(calls,before+1);
   assert.equal((await deleteSharedItem(db,adapter,row.publicId,now,owner)).status,"deleted");assert.equal(calls,before+1);
  }
  const legacy=await db.create(fixture(0));assert.equal(await db.claimForCleanup(legacy.publicId,now,"manual",owner),null);
  const retry=await db.create(fixture(2,{ownerSessionHash:owner}));
  await assert.rejects(deleteSharedItem(db,{async deleteItem(){throw Error("offline");}},retry.publicId,now,owner));
  assert.equal((await db.findByPublicId(retry.publicId)).cleanupClaimedAt,null);
  assert.equal((await deleteSharedItem(db,adapter,retry.publicId,now,owner)).status,"deleted");
 }finally{sqlite.close();}
});

test("D1 eligible shared deletion and Cron racing at 24h delete remotely only once",async()=>{
 const {sqlite,db,binding}=setup();
 try{await db.syncAccounts([account]);const row=await db.create(fixture(24));let calls=0;
  const adapter={async deleteItem(){calls++;}};
  await Promise.all([deleteSharedItem(db,adapter,row.publicId,now),expireDueItems(new D1MetadataDatabase(binding),adapter,now)]);
  assert.equal(calls,1);assert.ok((await db.findByPublicId(row.publicId)).deletedAt);
 }finally{sqlite.close();}
});

test("D1 raw provider errors never appear in public database errors", async () => {
  const db = new D1MetadataDatabase({ prepare() { throw new Error("private SQL and internal identifier"); } });
  await assert.rejects(db.listActive(), e => e.code === "database_unavailable" && !e.message.includes("private"));
});
(async () => { for (const [name, run] of tests) { await run(); console.log(`✓ ${name}`); }
  console.log(`${tests.length} D1 SQL/integration tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
