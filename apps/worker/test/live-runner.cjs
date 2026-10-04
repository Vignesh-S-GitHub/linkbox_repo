const assert = require("node:assert/strict");
const { LiveSeedrAdapter } = require("./logic-test-build/apps/worker/src/seedr/live-adapter.js");
const { SeedrTokenClient } = require("./logic-test-build/apps/worker/src/seedr/token-client.js");
const id = "12345678-1234-4234-8234-123456789012";
const item = `linkbox:${id}:10:20`;
const tests = [];
const test = (name,fn)=>tests.push([name,fn]);
function fixture() {
  const calls=[]; let deleted=false,taskDeleted=false;
  const fetcher=async (url,options)=>{
    const path=new URL(url).pathname.replace("/api/v0.1/p", "");calls.push({path,method:options.method,body:options.body});
    if(path==="/fs/folder" && options.method==="POST")return Response.json({success:true,id:"10",path:`LinkBox-${id}`});
    if(path==="/tasks" && options.method==="POST")return Response.json({success:true,user_torrent_id:20,title:"Sample",torrent_hash:"a".repeat(40)});
    if(path==="/tasks/20") {
      if(taskDeleted)return new Response(null,{status:404});
      if(options.method==="DELETE"){taskDeleted=true;return Response.json({success:true});}
      return Response.json({success:true,task:{id:20,folder_id:10,name:"Sample",size:100,state:"finished",progress:100,error:null}});
    }
    if(path==="/fs/folder/10" && options.method==="DELETE"){deleted=true;return Response.json({success:true});}
    if(path==="/fs/folder/10/contents")return deleted ? new Response(null,{status:404}) : Response.json({id:10,path:`LinkBox-${id}`,size:100,parent:0,folders:[{id:11,path:`LinkBox-${id}/Sample`,size:100}],files:[]});
    if(path==="/fs/folder/11/contents")return Response.json({id:11,path:`LinkBox-${id}/Sample`,parent:10,size:100,folders:[],files:[{id:30,name:"Sample.mp4",size:100,folder_id:11,is_video:true,is_audio:false}]});
    if(path==="/download/file/30/url" || path==="/presentation/fs/item/30/video/url")return Response.json({url:"https://nw34.seedr.cc/file?temporary=fixture"});
    assert.fail(`Unexpected test endpoint ${path}`);
  };
  const adapter=new LiveSeedrAdapter([{id:"a",label:"A",enabled:true,capacityBytes:5000,secretKeyReference:"A_TOKEN"}],{A_TOKEN:"fixture-secret"});
  return {adapter,fetcher,calls};
}
test("live submit checkpoints owned folder before documented task POST",async()=>{
  const {adapter,fetcher,calls}=fixture();const original=globalThis.fetch;
  try {globalThis.fetch=fetcher;const checkpoints=[];
    const result=await adapter.addMagnet("a",`magnet:?xt=urn:btih:${"a".repeat(40)}`,{publicId:id,checkpoint:async key=>{checkpoints.push(key);assert.equal(calls.length,checkpoints.length===1?1:3);}});
    assert.deepEqual(checkpoints,[`linkbox:${id}:10:0`,item]);assert.equal(result.itemId,item);
    const body=JSON.parse(calls[1].body);assert.equal(body.folder_id,10);assert.ok(body.torrent_magnet.startsWith("magnet:"));assert.equal(body.url,undefined);
  }finally{globalThis.fetch=original;}
});
test("finished torrent maps to owned files with opaque public entry IDs",async()=>{
 const {adapter,fetcher}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=fetcher;const value=await adapter.getItem("a",item);assert.equal(value.status,"ready");assert.equal(value.displayName,"Sample.mp4");assert.equal(value.playable,true);
   const contents=await adapter.contents("a",item);assert.equal(contents.kind,"video");assert.match(contents.entries[0].id,/^[a-f0-9]{40}$/);assert.ok(!JSON.stringify(contents).includes("fixture-secret"));
 }finally{globalThis.fetch=original;}
});
test("delivery resolves membership, returns only temporary HTTPS Seedr URLs",async()=>{
 const {adapter,fetcher,calls}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=fetcher;const entry=(await adapter.contents("a",item)).entries[0].id;
 assert.match(await adapter.playbackUrl("a",item,entry),/^https:\/\/nw34.seedr.cc\//);assert.match(await adapter.downloadUrl("a",item,entry),/^https:/);
 assert.equal(await adapter.downloadUrl("a",item,"30"),null);assert.ok(!calls.some(call=>call.path==="/download/file/30"));
 }finally{globalThis.fetch=original;}
});
test("cleanup deletes its associated task and folder, repeats safely on 404",async()=>{
 const {adapter,fetcher,calls}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=fetcher;await adapter.deleteItem("a",item);await adapter.deleteItem("a",item);
 assert.deepEqual(calls.filter(call=>call.method==="DELETE").map(call=>call.path),["/tasks/20","/fs/folder/10"]);
 }finally{globalThis.fetch=original;}
});
test("renamed/personal folder prevents both delivery and deletion",async()=>{
 const {adapter,fetcher,calls}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>url.endsWith("/fs/folder/10/contents")?Response.json({id:10,path:"Personal folder",files:[],folders:[]}):fetcher(url,options);
 for(const method of ["getItem","deleteItem","contents","downloadUrl"])await assert.rejects(adapter[method]("a",item),error=>error.code==="seedr_ownership");
 assert.equal(calls.length,0);
 }finally{globalThis.fetch=original;}
});
test("mismatched task association never deletes another task",async()=>{
 const {adapter,fetcher,calls}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>url.endsWith("/tasks/20")?Response.json({task:{id:20,folder_id:99}}):fetcher(url,options);
 await assert.rejects(adapter.deleteItem("a",item),error=>error.code==="seedr_ownership");assert.ok(!calls.some(call=>call.method==="DELETE"));
 }finally{globalThis.fetch=original;}
});
test("unsafe delivery URL and provider error content are never exposed",async()=>{
 const {adapter,fetcher}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>url.includes("/download/")?Response.json({url:"https://evil.example/secret"}):fetcher(url,options);
 await assert.rejects(adapter.downloadUrl("a",item),error=>error.code==="seedr_invalid_response");
 const client=new SeedrTokenClient("fixture-secret",async()=>new Response("private detail",{status:403}));
 await assert.rejects(client.request("/tasks"),error=>error.code==="seedr_token_rejected"&&!error.message.includes("private detail"));
 }finally{globalThis.fetch=original;}
});
test("large folder trees are bounded before extra provider requests",async()=>{
 const {adapter,fetcher,calls}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>url.endsWith("/fs/folder/10/contents")?Response.json({id:10,path:`LinkBox-${id}`,files:[],folders:Array.from({length:20},()=>({id:11,path:`LinkBox-${id}/Sample`}))}):fetcher(url,options);
 await assert.rejects(adapter.contents("a",item),error=>error.code==="folder_limit");assert.equal(calls.length,7);
 }finally{globalThis.fetch=original;}
});
test("per-invocation provider budget stays below the free Worker limit",async()=>{
 const {adapter}=fixture(),original=globalThis.fetch;let calls=0;
 try {globalThis.fetch=async()=>{calls++;return Response.json({space_used:0,space_max:5000});};
 for(let i=0;i<48;i++)await adapter.syncAccounts();
 await assert.rejects(adapter.syncAccounts(),error=>error.code==="seedr_request_budget");assert.equal(calls,48);
 }finally{globalThis.fetch=original;}
});
(async()=>{for(const [name,fn] of tests){await fn();console.log(`✓ ${name}`);}console.log(`${tests.length} live adapter tests passed`);})().catch(error=>{console.error(error);process.exitCode=1;});
