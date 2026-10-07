const assert = require("node:assert/strict");
const { selectAccount } = require("./logic-test-build/apps/worker/src/storage/account-selection.js");
const { validateMagnet, magnetIdentity } = require("./logic-test-build/apps/worker/src/utils/magnet.js");
const { MockDatabase } = require("./logic-test-build/apps/worker/src/database/mock-database.js");
const { deleteSharedItem, expireDueItems } = require("./logic-test-build/apps/worker/src/cleanup/cleanup-service.js");
const { MockSeedrAdapter } = require("./logic-test-build/apps/worker/src/seedr/mock-adapter.js");
const { LiveSeedrAdapter } = require("./logic-test-build/apps/worker/src/seedr/live-adapter.js");
const { SeedrTokenClient, parseQuota } = require("./logic-test-build/apps/worker/src/seedr/token-client.js");
const { parseRoute, routeUrl, screenNames, isFolderView } = require("./logic-test-build/apps/web/src/lib/routes.js");
const worker = require("./logic-test-build/apps/worker/src/index.js").default;
const {downloadKind,formatProgress}=require("./logic-test-build/packages/shared/src/file-kind.js");
const {canCopyDownloadLink,copyDownloadLink}=require("./logic-test-build/apps/web/src/lib/download-link.js");
const {isTransferring,isSizePending}=require("./logic-test-build/apps/web/src/lib/download-status.js");
const {itemFailure,metadataTimedOut,MISSING_TASK_GRACE_MS,METADATA_TIMEOUT_MS}=require("./logic-test-build/apps/worker/src/seedr/download-policy.js");

const gib = 1024 ** 3;
const accounts = () => [
  { id: "a", label: "A", enabled: true, capacityBytes: 5 * gib, usedBytes: 3 * gib, availableBytes: 2 * gib, lastSyncedAt: "", secretKeyReference: "A" },
  { id: "b", label: "B", enabled: true, capacityBytes: 4.5 * gib, usedBytes: 1.5 * gib, availableBytes: 3 * gib, lastSyncedAt: "", secretKeyReference: "B" },
];
const makeRow = (createdAt, publicId = "public") => ({
  id: crypto.randomUUID(), publicId, seedrAccountId: "a", seedrItemId: crypto.randomUUID(), magnetHash: crypto.randomUUID(), displayName: "Fixture", sizeBytes: gib,
  status: "ready", progress: 100, createdAt,
  cleanupAllowedAt: new Date(new Date(createdAt).getTime() + 3 * 3600000).toISOString(),
  expiresAt: new Date(new Date(createdAt).getTime() + 24 * 3600000).toISOString(),
  deletedAt: null, errorMessage: null, cleanupClaimedAt: null, playable: false,
});
const adapter = { deleteItem: async () => undefined };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("8 GB is rejected against a 5 GB account, never against combined 9.5 GB",()=>{
 const now=Date.now(),row=makeRow(new Date(now).toISOString());
 const item={sizeBytes:8*gib,status:"downloading",progress:1};
 assert.equal(itemFailure(row,item,10*gib,5*gib,now).remove,true);
 assert.equal(itemFailure(row,item,10*gib,4.5*gib,now).remove,true);
 assert.equal(itemFailure(row,{...item,sizeBytes:4*gib},10*gib,4.5*gib,now),null);
 assert.equal(itemFailure(row,{...item,sizeBytes:4*gib},3*gib,5*gib,now).remove,true);
});

test("missing task has an exact five-minute grace; unknown metadata expires at fifteen minutes",()=>{
 const now=Date.now(),row={...makeRow(new Date(now).toISOString()),status:"fetching_metadata",sizeBytes:0,progress:0};
 const item={sizeBytes:0,status:"fetching_metadata",progress:0,taskMissing:true};
 assert.equal(itemFailure(row,item,5*gib,5*gib,now+MISSING_TASK_GRACE_MS-1),null);
 const missing=itemFailure(row,item,5*gib,5*gib,now+MISSING_TASK_GRACE_MS);assert.equal(missing.remove,false);assert.match(missing.message,/did not confirm/);
 assert.equal(metadataTimedOut(row,now+METADATA_TIMEOUT_MS-1),false);
 const timeout=itemFailure(row,{...item,taskMissing:false},5*gib,5*gib,now+METADATA_TIMEOUT_MS);assert.equal(timeout.remove,false);assert.match(timeout.message,/15 minutes/);
});

test("resolved or progressing slow-peer transfers are not mistaken for unknown metadata",()=>{
 const now=Date.now(),row={...makeRow(new Date(now-3600000).toISOString()),status:"fetching_metadata",sizeBytes:0,progress:0};
 for(const item of [{sizeBytes:gib,status:"fetching_metadata",progress:0},{sizeBytes:0,status:"downloading",progress:1.6},{sizeBytes:gib,status:"downloading",progress:0}])assert.equal(itemFailure(row,item,5*gib,5*gib,now),null);
 for(const changes of [{sizeBytes:gib},{progress:1.6},{status:"downloading"}])assert.equal(metadataTimedOut({...row,...changes},now),false);
 assert.equal(itemFailure(row,{sizeBytes:100,status:"failed",progress:0},5*gib,5*gib,now).remove,false);
});

test("failed rows have no transfer spinner and unknown sizes are not measured zero-byte files",()=>{
 for(const status of ["failed","ready","deleted","expired","deleting"])assert.equal(isTransferring(status),false);
 for(const status of ["queued","fetching_metadata","downloading","processing"])assert.equal(isTransferring(status),true);
 assert.equal(isSizePending({sizeBytes:0,status:"fetching_metadata"}),true);
 assert.equal(isSizePending({sizeBytes:0,status:"failed"}),true);
 assert.equal(isSizePending({sizeBytes:0,status:"ready"}),false);
 assert.equal(isSizePending({sizeBytes:100,status:"failed"}),false);
});

test("direct link copying requires a ready unexpired individual file",()=>{
 const now=Date.now(),file={status:"ready",deletedAt:null,expiresAt:new Date(now+60000).toISOString(),kind:"video",displayName:"Demo.mp4"};
 assert.equal(canCopyDownloadLink(file,undefined,now),true);
 for(const status of ["downloading","processing","failed","deleted","expired"])assert.equal(canCopyDownloadLink({...file,status},undefined,now),false);
 assert.equal(canCopyDownloadLink({...file,deletedAt:new Date(now).toISOString()},undefined,now),false);
 assert.equal(canCopyDownloadLink({...file,expiresAt:new Date(now).toISOString()},undefined,now),false);
 assert.equal(canCopyDownloadLink({...file,expiresAt:"invalid"},undefined,now),false);
 assert.equal(canCopyDownloadLink({...file,kind:"folder"},undefined,now),false);
 assert.equal(canCopyDownloadLink({...file,kind:"folder"},{kind:"video"},now),true);
 assert.equal(canCopyDownloadLink({...file,displayName:"LICENSE",kind:"other"},undefined,now),true);
});
test("direct clipboard fallback copies the exact delivery URL rather than the app page",async()=>{
 const url="https://cdn.seedr.cc/direct/demo.mp4?temporary=fixture",writes=[];
 await copyDownloadLink(async()=>url,{writeText:async text=>{writes.push(text);}},undefined);
 assert.deepEqual(writes,[url]);
});
test("promise clipboard starts during the gesture before delivery resolves",async()=>{
 let finish,started=false,result;const url="https://cdn.seedr.cc/direct/demo.mp4?temporary=fixture";
 class Item{constructor(parts){this.parts=parts;}}
 const pending=copyDownloadLink(()=>new Promise(resolve=>{finish=resolve;}),{writeText:()=>assert.fail("must use promise clipboard"),write:async items=>{started=true;result=await(await items[0].parts["text/plain"]).text();}},Item);
 assert.equal(started,true);finish(url);await pending;assert.equal(result,url);
});
test("clipboard and expired delivery failures never report successful copying",async()=>{
 const failure=new Error("delivery unavailable");let writes=0;
 await assert.rejects(copyDownloadLink(async()=>{throw failure;},{writeText:async()=>{writes++;}},undefined),failure);assert.equal(writes,0);
 await assert.rejects(copyDownloadLink(()=>assert.fail("must not load without clipboard"),null,undefined));
 class Item{constructor(parts){this.parts=parts;}}
 await assert.rejects(copyDownloadLink(async()=>{throw failure;},{writeText:async()=>{},write:async()=>{throw new Error("permission denied");}},Item),/permission denied/);
});
test("file actions preserve original delivery and a single age-protected Delete",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const app=fs.readFileSync(path.join(__dirname,"../../web/src/App.tsx"),"utf8");
 const sheet=fs.readFileSync(path.join(__dirname,"../../web/src/components/ActionsSheet.tsx"),"utf8");
 assert.match(app,/copyDownloadLink\(\(\) => api\.delivery\(file\.id, "download", child\?\.id\)/);
 const action=fs.readFileSync(path.join(__dirname,"../../web/src/components/DeleteAction.tsx"),"utf8");
 assert.match(sheet,/Copy download link/);assert.match(sheet,/!entry&&<DeleteAction/);
 assert.equal((action.match(/onClick=\{onDelete\}/g)||[]).length,1);
 assert.ok(!sheet.includes("Not available")&&!sheet.includes("Delete my download")&&!app.includes("onUnavailable="));
 assert.match(action,/<Trash2 size=\{19\}\/>Delete/);assert.match(action,/if\(file.canDelete!==true&&now<unlock\)return/);assert.match(action,/Protected/);
});

test("Delete UI lets creators delete immediately and shows other browsers a countdown until three hours",()=>{
 const {readFileSync}=require("node:fs"),path=require("node:path"),{createRequire}=require("node:module"),vm=require("node:vm"),ts=require("typescript");
 const actionPath=path.join(__dirname,"../../web/src/components/DeleteAction.tsx"),webRequire=createRequire(actionPath);
 const react=webRequire("react"),{renderToStaticMarkup}=webRequire("react-dom/server");
 function load(file){
  const output=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(output,{module,exports:module.exports,Date,require:specifier=>specifier.startsWith(".")?load(path.resolve(path.dirname(file),specifier)+".ts"):webRequire(specifier)});
  return module.exports;
 }
 const {DeleteAction}=load(actionPath),now=Date.now();
 const render=file=>renderToStaticMarkup(react.createElement(DeleteAction,{file,onDelete:()=>{},fullWidth:true}));
 for(const hours of [0,2,2.999]){
  const markup=render({...makeRow(new Date(now-hours*3600000).toISOString()),canDelete:false});
  assert.match(markup,/Protected/);assert.match(markup,/Delete available in/);assert.ok(!markup.includes("<button"));
  const creator=render({...makeRow(new Date(now-hours*3600000).toISOString()),canDelete:true});
  assert.equal((creator.match(/<button/g)||[]).length,1);assert.match(creator,/>Delete<\/button>/);assert.ok(!creator.includes("Protected"));
 }
 for(const hours of [3,4]){
  const markup=render({...makeRow(new Date(now-hours*3600000).toISOString()),canDelete:false});
  assert.equal((markup.match(/<button/g)||[]).length,1);assert.match(markup,/unavailable-action full-width/);assert.match(markup,/>Delete<\/button>/);
 }
 assert.equal(render({...makeRow(new Date(now-4*3600000).toISOString()),deletedAt:new Date(now).toISOString()}),"");
 assert.match(render({...makeRow(new Date(now-4*3600000).toISOString()),status:"deleting"}),/disabled/);
 assert.ok(!render({...makeRow(new Date(now).toISOString()),cleanupAllowedAt:"invalid"}).includes("<button"));
});

test("authoritative type overrides names, including folders ending in media extensions",()=>{
 assert.equal(downloadKind({displayName:"Demo.2026 [5.1]",kind:"folder"}),"folder");
 assert.equal(downloadKind({displayName:"Folder.mp4",kind:"folder"}),"folder");
 assert.equal(downloadKind({displayName:"LICENSE",kind:"other"}),"other");
 assert.equal(downloadKind({displayName:"Sample.mp4",kind:null}),"video");
});
test("progress displays small decimal percentages without claiming premature completion",()=>{
 for(const [input,expected] of [[1.6,"1.6%"],[6.15,"6.15%"],[100,"100%"],[99.999,"99.99%"],[0,"0%"],[0.001,"<0.01%"],[NaN,"0%"],[-3,"0%"]])assert.equal(formatProgress(input),expected);
});
test("full lazy HLS build retains separate audio support with native controls only",()=>{
 const Hls=require("hls.js");assert.ok(Hls.DefaultConfig.audioStreamController);assert.ok(Hls.DefaultConfig.audioTrackController);
 const {readFileSync}=require("node:fs"),{join}=require("node:path");
 const source=readFileSync(join(__dirname,"../../web/src/components/StreamMedia.tsx"),"utf8");
 assert.ok(source.includes('import("hls.js")'));assert.ok(source.includes('controls: true'));
 for(const removed of ['hls.js/light','player-controls','Streaming quality','Audio track','Playback speed','Video fit','Add subtitle file','PictureInPicture2'])assert.ok(!source.includes(removed));
});

test("actual folder contents override dotted torrent-name preview routes", () => {
  assert.equal(isFolderView({screen:"preview",id:"public"},"folder"),true);
  assert.equal(isFolderView({screen:"preview",id:"public",entry:"file"},"folder"),false);
  assert.equal(isFolderView({screen:"preview",id:"public"},"pdf"),false);
  assert.equal(isFolderView({screen:"folder",id:"public"},"folder"),true);
  assert.equal(isFolderView({screen:"player",id:"public"},"folder"),false);
});
test("verified quota fields yield real counts, never guessed aliases", () => {
  assert.deepEqual(parseQuota({ space_used: gib, space_max: 5 * gib }), { capacityBytes: 5 * gib, usedBytes: gib, availableBytes: 4 * gib });
  for (const quota of [{}, { used_space: 1, space: 5 }, { space_used: "1", space_max: 5 }, { space_used: -1, space_max: 5 }, { space_used: 6, space_max: 5 }, { space_used: 1, space_max: 0 }, { space_used: NaN, space_max: 5 }, { space_used: 1.5, space_max: 5 }, { space_used: 1, space_max: Infinity }, { space_used: 0, space_max: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => parseQuota(quota), error => error.code === "seedr_invalid_quota");
  }
});

test("Seedr client calls fetch with the global receiver required by workerd", async () => {
  const client = new SeedrTokenClient("dummy", async function (url) {
    assert.equal(this, globalThis, "native Worker fetch must not receive the client as this");
    assert.equal(url, "https://www.seedr.cc/api/v0.1/p/me/quota");
    return Response.json({ space_used: 0, space_max: 5 * gib });
  });
  assert.equal((await client.quota()).capacityBytes, 5 * gib);
});

test("live storage uses PAT quota endpoint and skips disabled accounts", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://www.seedr.cc/api/v0.1/p/me/quota");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer private-test-token");
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ space_used: gib, space_max: 5 * gib, bandwidth_used: 0, bandwidth_max: 1, space_scope: "fixture", is_premium: false });
    };
    const result = await new LiveSeedrAdapter([{ ...accounts()[0], secretKeyReference: "SEEDR_ACCOUNT_A_TOKEN" }, { ...accounts()[1], enabled: false }], { SEEDR_ACCOUNT_A_TOKEN: "private-test-token" }).syncAccounts();
    assert.equal(calls, 1); assert.equal(result.length, 1);
    assert.equal(result[0].usedBytes, gib); assert.equal(result[0].availableBytes, 4 * gib);
    assert.ok(!JSON.stringify(result).includes("private-test-token"));
  } finally { globalThis.fetch = originalFetch; }
});

test("real capacity replaces configured demo estimates", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ space_used: 0, space_max: 2 * gib });
    assert.equal((await new LiveSeedrAdapter([{ ...accounts()[0], secretKeyReference: "A" }], { A: "dummy" }).syncAccounts())[0].capacityBytes, 2*gib);
  } finally { globalThis.fetch = originalFetch; }
});

test("missing and legacy Basic secrets fail without sending a request", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => assert.fail("must not contact Seedr");
    for (const secretKeyReference of ["MISSING", "SEEDR_ACCOUNT_A_BASIC_AUTH"]) {
      await assert.rejects(new LiveSeedrAdapter([{ ...accounts()[0], secretKeyReference }], { SEEDR_ACCOUNT_A_BASIC_AUTH: "dummy" }).syncAccounts(), error => error.code === "seedr_token_missing");
    }
    assert.throws(() => new SeedrTokenClient("Bearer dummy"), error => error.code === "seedr_token_missing");
  } finally { globalThis.fetch = originalFetch; }
});

test("Seedr quota redirects are rejected without following or forwarding credentials", async () => {
  let calls = 0;
  const client = new SeedrTokenClient("dummy", async (url, options) => {
    calls++; assert.equal(url, "https://www.seedr.cc/api/v0.1/p/me/quota");
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://untrusted.example/" } });
  });
  await assert.rejects(client.quota(), error => error.code === "seedr_redirect_rejected");
  assert.equal(calls, 1);
});

test("live API failures and malformed bodies never expose provider data", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(new SeedrTokenClient("dummy", async () => new Response("private provider error", { status })).quota(), error => {
      assert.ok(!error.message.includes("private provider error")); return error.status === 503;
    });
  }
  for (const response of [new Response("private HTML"), new Response("private invalid JSON", { headers: { "content-type": "application/json" } }), Response.json({ padding: "x".repeat(65536) })]) {
    await assert.rejects(new SeedrTokenClient("dummy", async () => response).quota(), error => error.code === "seedr_invalid_quota");
  }
  await assert.rejects(new SeedrTokenClient("dummy", async () => { throw new Error("private runtime detail"); }).quota(), error => error.code === "seedr_unavailable" && !error.message.includes("private runtime detail"));
});

test("live operations reject arbitrary IDs and unknown sizes are not guessed", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => assert.fail("unverified operations must not contact Seedr");
    const live = new LiveSeedrAdapter(accounts(), {});
    assert.deepEqual(await live.inspectMagnet(`magnet:?xt=urn:btih:${"a".repeat(40)}&xl=1`), {sizeBytes:null,displayName:null});
    await assert.rejects(live.addMagnet("a","invalid"), error=>error.code==="seedr_ownership");
    for (const action of ["getItem", "deleteItem", "contents", "playbackUrl", "downloadUrl"]) await assert.rejects(live[action]("a","123"),error=>error.code==="seedr_ownership");
  } finally { globalThis.fetch = originalFetch; }
});

test("best-fit account selection handles a third account", () => {
  const third = { id: "c", label: "C", enabled: true, capacityBytes: 6 * gib, usedBytes: gib, availableBytes: 5 * gib, lastSyncedAt: "", secretKeyReference: "C" };
  assert.equal(selectAccount([...accounts(), third], 2.5 * gib)?.id, "b");
});
test("fragmented capacity never combines accounts", () => assert.equal(selectAccount(accounts(), 4 * gib), null));
test("invalid magnet links are rejected", () => assert.throws(() => validateMagnet("https://example.com")));
test("malformed BitTorrent hashes and control characters are rejected", () => {
  for (const magnet of ["magnet:?xt=urn:btih:wrong", `magnet:?xt=urn:btih:${"g".repeat(40)}`, `magnet:?xt=urn:btih:${"a".repeat(40)}\n`]) assert.throws(() => validateMagnet(magnet));
});
test("magnet identity ignores names and trackers and normalizes base32", () => {
  assert.equal(magnetIdentity(`magnet:?xt=urn:btih:${"0".repeat(40)}&dn=A`), magnetIdentity(`magnet:?xt=urn:btih:${"A".repeat(32)}&dn=B&tr=https://example.com`));
});
test("automatic cleanup cannot claim any unexpired item, including after three hours", async () => {
  const db = new MockDatabase(); const now = new Date("2026-09-28T12:00:00Z");
  for (const hours of [0, 2, 3, 4, 23.999]) {
    const id = `age-${hours}`; await db.create(makeRow(new Date(now - hours * 3600000).toISOString(), id));
    assert.equal(await db.claimForCleanup(id, now.toISOString()), null);
  }
});
test("non-creators are protected until exactly three hours, then anyone can delete", async () => {
  const db = new MockDatabase(); const now = new Date("2026-09-28T12:00:00Z"), owner = "a".repeat(64);
  for (const hours of [0, 2, 3-1/3600000, 3, 4, 23]) {
    const id = `owned-${hours}`; await db.create({...makeRow(new Date(now - hours * 3600000).toISOString(), id), ownerSessionHash: owner});
    if(hours<3){
      assert.equal(await db.claimForCleanup(id,now.toISOString(),"manual"),null);
      await assert.rejects(deleteSharedItem(db,adapter,id,now.toISOString()),error=>error.code==="file_protected");
    }else assert.equal((await deleteSharedItem(db,adapter,id,now.toISOString())).status,"deleted");
  }
});
test("only a matching creator digest bypasses the manual lock, never the automatic expiry deadline",async()=>{
 const db=new MockDatabase(),now="2026-09-28T12:00:00.000Z",owner="a".repeat(64);
 for(const status of ["queued","fetching_metadata","downloading","processing","ready","failed"]){
  const id=`creator-${status}`;await db.create({...makeRow(now,id),status,ownerSessionHash:owner});
  assert.equal(await db.claimForCleanup(id,now,"manual","b".repeat(64)),null);
  assert.equal(await db.claimForCleanup(id,now,"expired",owner),null);
  await assert.rejects(deleteSharedItem(db,adapter,id,now,"b".repeat(64)),e=>e.code==="file_protected");
  assert.equal((await deleteSharedItem(db,adapter,id,now,owner)).status,"deleted");
  assert.equal((await deleteSharedItem(db,adapter,id,now,owner)).status,"deleted");
 }
 await db.create(makeRow(now,"legacy"));
 assert.equal(await db.claimForCleanup("legacy",now,"manual",owner),null);
 await assert.rejects(deleteSharedItem(db,adapter,"legacy",now,owner),e=>e.code==="file_protected");
});
test("one cleanup claim wins a concurrent race", async () => {
  const db = new MockDatabase(); const now = new Date("2026-09-28T12:00:00Z"); await db.create(makeRow(new Date(now - 24 * 3600000).toISOString()));
  const results = await Promise.all([db.claimForCleanup("public", now.toISOString()), db.claimForCleanup("public", now.toISOString())]);
  assert.equal(results.filter(Boolean).length, 1);
});
test("24-hour-old files are selected for automatic expiration", async () => {
  const db = new MockDatabase(); const now = new Date("2026-09-28T12:00:00Z"); await db.create(makeRow(new Date(now - 25 * 3600000).toISOString()));
  assert.equal(await expireDueItems(db, adapter, now.toISOString()), 1);
});

test("remote deletion failure preserves metadata and releases the claim for retry", async () => {
  const db = new MockDatabase(); const now = new Date("2026-09-28T12:00:00Z");
  const owner = "a".repeat(64);
  await db.create({...makeRow(new Date(now - 4 * 3600000).toISOString()), ownerSessionHash: owner});
  await assert.rejects(deleteSharedItem(db, { deleteItem: async () => { throw new Error("offline"); } }, "public", now.toISOString()));
  const row = await db.findByPublicId("public");
  assert.equal(row.deletedAt, null); assert.equal(row.cleanupClaimedAt, null); assert.equal(row.status, "ready");
  assert.equal((await deleteSharedItem(db, adapter, "public", now.toISOString())).status, "deleted");
});
test("artifact screens and file-entry deep links round-trip", () => {
  for (const screen of screenNames) assert.equal(parseRoute(routeUrl(screen)).screen, screen);
  const url = new URL(routeUrl("preview", "safe-public-id", "document"), "https://example.com");
  assert.deepEqual(parseRoute(url.pathname, url.search), { screen: "preview", id: "safe-public-id", entry: "document", section: undefined });
  assert.equal(parseRoute("/unknown").screen, "unavailable");
});
test("mock fixtures all exist in storage, deletion frees capacity, third account starts empty", async () => {
  const storageAdapter = new MockSeedrAdapter([...accounts().map(account => ({ ...account, id: account.id === "a" ? "seedr-a" : "seedr-b" })), { id: "c", label: "C", enabled: true, capacityBytes: 6 * gib, secretKeyReference: "C" }]);
  const db = new MockDatabase();
  for (const row of await db.listActive()) assert.equal((await storageAdapter.getItem(row.seedrAccountId, row.seedrItemId)).sizeBytes, row.sizeBytes);
  const before = (await storageAdapter.syncAccounts()).find(account => account.id === "seedr-a").availableBytes;
  await storageAdapter.deleteItem("seedr-a", "mock-fixture-2");
  await storageAdapter.deleteItem("seedr-a", "mock-fixture-2");
  assert.equal((await storageAdapter.syncAccounts()).find(account => account.id === "seedr-a").availableBytes, before + Math.round(2.8 * gib));
  assert.equal((await storageAdapter.syncAccounts()).find(account => account.id === "c").usedBytes, 0);
});

const env = { SEEDR_MODE: "mock", ALLOWED_ORIGIN: "http://localhost:5173", SUBMISSION_COOLDOWN_SECONDS: "0" };
const fetchApi = (path, init = {}) => worker.fetch(new Request(`http://localhost:8787${path}`, { ...init, headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json", "x-session-id": "12345678-1234-4234-8234-123456789012", ...init.headers } }), env);
const fixtureId = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const storageOnlyEnv = {
  SEEDR_MODE: "live", SEEDR_ACCESS: "storage-only", ALLOWED_ORIGIN: "http://localhost:5173", SEEDR_ACCOUNT_A_TOKEN: "private-test-token",
  SEEDR_ACCOUNT_CONFIG: JSON.stringify([{ ...accounts()[0], secretKeyReference: "SEEDR_ACCOUNT_A_TOKEN" }]),
};
const fetchStorageOnly = (path, init = {}, config = storageOnlyEnv) => worker.fetch(new Request(`http://localhost:8787${path}`, { ...init, headers: { origin: config.ALLOWED_ORIGIN, ...init.headers } }), config);

test("storage-only Worker shows actual single-account quota without database or demo pool", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://www.seedr.cc/api/v0.1/p/me/quota"); assert.equal(options.method, "GET");
      return Response.json({ space_used: 0.75 * gib, space_max: 2 * gib });
    };
    const response = await fetchStorageOnly("/api/storage");
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const storage = await response.json();
    assert.equal(storage.capacityBytes, 2 * gib); assert.equal(storage.usedBytes, 0.75 * gib); assert.equal(storage.availableBytes, 1.25 * gib);
    assert.ok(!JSON.stringify(storage).includes("private-test-token"));
    assert.ok(!JSON.stringify(storage).includes("seedrAccount"));
  } finally { globalThis.fetch = originalFetch; }
});

test("storage-only list is empty and every file mutation is blocked without external calls", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => assert.fail("no Seedr file or database access allowed");
    assert.deepEqual(await (await fetchStorageOnly("/api/downloads")).json(), []);
    for (const path of ["/api/downloads", `/api/downloads/${fixtureId(2)}/cleanup`, `/api/downloads/${fixtureId(2)}/delete`]) {
      const response = await fetchStorageOnly(path, { method: "POST" });
      assert.equal(response.status, 409); assert.equal((await response.json()).code, "storage_only");
    }
    assert.equal((await fetchStorageOnly(`/api/downloads/${fixtureId(2)}/download`)).status, 409);
    worker.scheduled({}, storageOnlyEnv, { waitUntil: () => assert.fail("cron must not run in storage-only mode") });
  } finally { globalThis.fetch = originalFetch; }
});

test("storage-only never falls back to fake quota on missing token or malformed accounts", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => assert.fail("invalid setup must not issue requests");
    assert.equal((await fetchStorageOnly("/api/storage", {}, { ...storageOnlyEnv, SEEDR_ACCOUNT_A_TOKEN: undefined })).status, 503);
    assert.equal((await fetchStorageOnly("/api/storage", {}, { ...storageOnlyEnv, SEEDR_ACCOUNT_CONFIG: JSON.stringify(accounts()) })).status, 503);
    assert.equal((await fetchStorageOnly("/api/storage", { headers: { origin: "https://unapproved.example" } })).status, 403);
    assert.equal((await fetchStorageOnly("/api/unknown")).status, 404);
  } finally { globalThis.fetch = originalFetch; }
});
test("Worker exposes only public metadata and correct 9.5 GB logical storage", async () => {
  const storage = await (await fetchApi("/api/storage")).json();
  assert.equal(storage.capacityBytes, 9.5 * gib); assert.equal(storage.usedBytes, 6.2 * gib);
  const files = await (await fetchApi("/api/downloads")).json();
  assert.equal(files.length, 5);
  assert.ok(files.every(file => !JSON.stringify(file).includes("seedrAccount") && !JSON.stringify(file).includes("seedrItem")));
  assert.ok(files.every(file => Date.parse(file.cleanupAllowedAt)===Date.parse(file.createdAt)+10800000));
});
test("removed community cleanup returns 404 and not-ready playback remains blocked", async () => {
  for (const id of [fixtureId(1), fixtureId(2), fixtureId(3)]) {
    for (const method of ["POST", "GET"]) assert.equal((await fetchApi(`/api/downloads/${id}/cleanup`, { method })).status, 404);
  }
  assert.equal((await fetchApi(`/api/downloads/${fixtureId(1)}/play?format=json`)).status, 409);
});
test("Worker folder entries and previews are safe public capabilities", async () => {
  const realNow = Date.now;
  try { Date.now = () => realNow() + 120000; await fetchApi("/api/downloads"); } finally { Date.now = realNow; }
  const folder = await (await fetchApi(`/api/downloads/${fixtureId(2)}/contents`)).json();
  assert.equal(folder.kind, "folder"); assert.equal(folder.entries.length, 7);
  assert.equal(folder.entries.find(entry => entry.id === "document").preview, "guide");
  assert.equal((await fetchApi(`/api/downloads/${fixtureId(2)}/play?entry=video&format=json`)).status, 200);
  assert.equal((await fetchApi(`/api/downloads/${fixtureId(2)}/download?entry=missing&format=json`)).status, 404);
  assert.equal((await fetchApi(`/api/downloads/${fixtureId(3)}/contents`)).status, 200);
});
test("storage-full reports contiguous space without offering other users' files for deletion", async () => {
  const magnet = `magnet:?xt=urn:btih:${"a".repeat(40)}&dn=Test%20Archive.zip&xl=${4 * gib}`;
  const rejected = await fetchApi("/api/downloads", { method: "POST", body: JSON.stringify({ magnet }) });
  assert.equal(rejected.status, 409);
  const details = (await rejected.json()).details;
  assert.equal(details.availableBytes, 1.9 * gib);
  assert.deepEqual(Object.keys(details).sort(), ["availableBytes", "requestedBytes"]);
  assert.equal((await fetchApi(`/api/downloads/${fixtureId(2)}/cleanup`, { method: "POST" })).status, 404);
  assert.equal((await fetchApi(`/api/downloads/${fixtureId(5)}/delete`, { method: "POST" })).status, 403);
  assert.equal((await fetchApi("/api/downloads", { method: "POST", body: JSON.stringify({ magnet: magnet.replace(String(4 * gib), "1024") }) })).status, 201);
});
test("the same torrent with different display parameters is still a duplicate", async () => {
  const response = await fetchApi("/api/downloads", { method: "POST", body: JSON.stringify({ magnet: `magnet:?xt=urn:btih:${"a".repeat(40)}&dn=Different%20name&xl=1` }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, "duplicate_magnet");
});
test("oversized and malformed JSON submissions get safe client errors", async () => {
  assert.equal((await fetchApi("/api/downloads", { method: "POST", body: "{" })).status, 400);
  assert.equal((await fetchApi("/api/downloads", { method: "POST", body: JSON.stringify({ magnet: "x".repeat(13000) }) })).status, 413);
});
test("unapproved browser origins cannot mutate shared storage", async () => {
  assert.equal((await fetchApi(`/api/downloads/${fixtureId(3)}/cleanup`, { method: "POST", headers: { origin: "https://unapproved.example" } })).status, 403);
});

test("Worker locks non-creators for three hours then allows shared idempotent deletion",async()=>{
 const owner="12345678-1234-4234-8234-123456789012",other="87654321-4321-4321-8321-210987654321";
 const magnet=`magnet:?xt=urn:btih:${"c".repeat(40)}&dn=Wrong%20link%20test.zip&xl=1024`;
 const created=await fetchApi("/api/downloads",{method:"POST",body:JSON.stringify({magnet})});assert.equal(created.status,201);
 const file=await created.json();assert.equal(file.canDelete,true);
 const raw=JSON.stringify(file);assert.ok(!raw.includes(owner));assert.ok(!raw.includes("ownerSessionHash"));
 const endpoint=`/api/downloads/${file.id}/delete`;
 assert.equal((await (await fetchApi(`/api/downloads/${file.id}`)).json()).canDelete,true);
 assert.equal((await (await fetchApi(`/api/downloads/${file.id}`,{headers:{"x-session-id":other}})).json()).canDelete,false);
 assert.equal((await fetchApi("/api/downloads",{method:"POST",headers:{"x-session-id":other},body:JSON.stringify({magnet})})).status,409);
 assert.equal((await (await fetchApi(`/api/downloads/${file.id}`)).json()).canDelete,true);
 assert.equal((await fetchApi(endpoint,{method:"POST",headers:{"x-session-id":other}})).status,403);
 assert.equal((await fetchApi(endpoint,{method:"POST",headers:{"x-session-id":""}})).status,403);
 assert.equal((await fetchApi(endpoint,{method:"GET"})).status,405);
 assert.equal((await fetchApi(endpoint,{method:"POST",headers:{origin:"https://unapproved.example"}})).status,403);
 assert.equal((await fetchApi(`/api/downloads/${file.id}/cleanup`,{method:"POST"})).status,404);
 const OriginalDate=Date;let clock=Date.parse(file.cleanupAllowedAt)-1;
 global.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 try{
   assert.equal((await fetchApi(endpoint,{method:"POST",headers:{"x-session-id":other}})).status,403);
   clock++;
   assert.equal((await (await fetchApi(`/api/downloads/${file.id}`,{headers:{"x-session-id":other}})).json()).canDelete,true);
   assert.equal((await fetchApi(endpoint,{method:"POST",headers:{"x-session-id":""}})).status,400);
   const deleted=await fetchApi(endpoint,{method:"POST",headers:{"x-session-id":other}});assert.equal(deleted.status,200);assert.equal((await deleted.json()).status,"deleted");
   assert.equal((await fetchApi(endpoint,{method:"POST"})).status,200);
   assert.equal((await fetchApi(endpoint,{method:"POST",headers:{"x-session-id":other}})).status,200);
 }finally{global.Date=OriginalDate;}
});
test("Worker creator can immediately delete a mistaken submission; forged owner fields grant no bypass",async()=>{
 const other=crypto.randomUUID(),magnet=`magnet:?xt=urn:btih:${"d".repeat(40)}&dn=Mistaken%20link.zip&xl=1024`;
 const created=await fetchApi("/api/downloads",{method:"POST",body:JSON.stringify({magnet})});assert.equal(created.status,201);
 const file=await created.json();assert.equal(file.canDelete,true);
 const endpoint=`/api/downloads/${file.id}/delete`;
 const forged=await fetchApi(endpoint,{method:"POST",headers:{"x-session-id":other},body:JSON.stringify({canDelete:true,isOwner:true,ownerSessionHash:"a".repeat(64)})});
 assert.equal(forged.status,403);assert.equal((await forged.json()).code,"file_protected");
 const deleted=await fetchApi(endpoint,{method:"POST"});assert.equal(deleted.status,200);assert.equal((await deleted.json()).status,"deleted");
 assert.equal((await fetchApi(endpoint,{method:"POST"})).status,200);
});
test("owner capability requires a private random UUID rather than an easily guessed session",async()=>{
 const {requestOwnerHash}=require("./logic-test-build/apps/worker/src/utils/owner.js");
 assert.equal(await requestOwnerHash(new Request("http://localhost",{headers:{"x-session-id":"test-session"}})),null);
 const value=await requestOwnerHash(new Request("http://localhost",{headers:{"x-session-id":"12345678-1234-4234-8234-123456789012"}}));assert.match(value,/^[0-9a-f]{64}$/);
});

(async () => { for (const [name, fn] of tests) { await fn(); console.log(`✓ ${name}`); } console.log(`${tests.length} logic tests passed`); })().catch((error) => { console.error(error); process.exitCode = 1; });
