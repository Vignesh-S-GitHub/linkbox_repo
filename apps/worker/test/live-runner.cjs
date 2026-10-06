const assert = require("node:assert/strict");
const { LiveSeedrAdapter } = require("./logic-test-build/apps/worker/src/seedr/live-adapter.js");
const { SeedrTokenClient } = require("./logic-test-build/apps/worker/src/seedr/token-client.js");
const id = "12345678-1234-4234-8234-123456789012";
const item = `linkbox:${id}:10:20`;
const tests = [];
const test = (name,fn)=>tests.push([name,fn]);

test("empty owned folder with no task is distinguished from real metadata wait",async()=>{
 const {adapter}=fixture(),original=globalThis.fetch;
 try{globalThis.fetch=async(url,options)=>{
 assert.equal(options.method,"GET");
 if(url.endsWith("/fs/folder/10/contents"))return Response.json({id:10,path:`LinkBox-${id}`,size:0,files:[],folders:[]});
 if(url.endsWith("/tasks"))return Response.json({tasks:[]});
 if(url.endsWith("/tasks/20"))return new Response(null,{status:404});
 assert.fail("Unexpected test endpoint");
 };
 for(const key of [`linkbox:${id}:10:0`,item]){
 const value=await adapter.getItem("a",key);assert.equal(value.taskMissing,true);assert.equal(value.sizeBytes,0);
 }
 globalThis.fetch=async url=>url.endsWith("/tasks/20")?Response.json({task:{id:20,folder_id:10,name:"Metadata pending",size:null,state:"queued",progress:0,error:null}}):Response.json({id:10,path:`LinkBox-${id}`,size:0,files:[],folders:[]});
 const pending=await adapter.getItem("a",item);assert.equal(pending.taskMissing,false);assert.equal(pending.sizeBytes,0);assert.equal(pending.status,"fetching_metadata");
 }finally{globalThis.fetch=original;}
});

test("JSON-level rejection is terminal and redacted; null/false error flags do not reject",async()=>{
 for(const payload of [{success:false,error:"private provider details"},{error:"private provider details"}]){
 const client=new SeedrTokenClient("fixture-secret",async()=>Response.json(payload));
 await assert.rejects(client.request("/tasks","POST",{}),error=>error.status===409&&error.code==="seedr_rejected"&&!error.message.includes("private provider details"));
 }
 for(const error of [null,false,""]){const client=new SeedrTokenClient("fixture-secret",async()=>Response.json({success:true,error,tasks:[]}));assert.deepEqual(await client.request("/tasks"),{success:true,error,tasks:[]});}
});

test("provider decimal progress is not rounded down and invalid progress fails safely", async()=>{
 const {adapter,fetcher}=fixture(),original=globalThis.fetch;
 try {for(const progress of [1.6,6.15,99.999]){
 globalThis.fetch=async(url,options)=>url.endsWith("/tasks/20")?Response.json({task:{id:20,folder_id:10,name:"New shared download",size:100,state:"downloading",progress,error:null}}):fetcher(url,options);
 const result=await adapter.getItem("a",item);assert.equal(result.progress,progress);assert.equal(result.status,"downloading");assert.equal(result.kind,null);
 }
 globalThis.fetch=async(url,options)=>url.endsWith("/tasks/20")?Response.json({task:{id:20,folder_id:10,size:100,progress:"wrong"}}):fetcher(url,options);
 await assert.rejects(adapter.getItem("a",item),e=>e.code==="seedr_invalid_response");
 }finally{globalThis.fetch=original;}
});
test("multi-file torrent is a folder regardless of dots in its title",async()=>{
 const {adapter,fetcher}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>{
 if(url.endsWith("/tasks/20"))return Response.json({task:{id:20,folder_id:10,name:"Demo.2026 [5.1]",size:100,state:"finished",progress:100,error:null}});
 if(url.endsWith("/fs/folder/11/contents"))return Response.json({id:11,path:`LinkBox-${id}/Sample`,parent:10,size:100,folders:[],files:[
 {id:30,name:"Sample.mp4",size:97,folder_id:11,is_video:true},
 {id:31,name:"Poster.jpg",size:1,folder_id:11}, {id:32,name:"Notes.txt",size:1,folder_id:11}, {id:33,name:"English.srt",size:1,folder_id:11}]});
 return fetcher(url,options);
 };
 const value=await adapter.getItem("a",item);assert.equal(value.kind,"folder");assert.equal(value.fileCount,4);assert.equal(value.playable,false);
 const contents=await adapter.contents("a",item);assert.deepEqual(contents.entries.map(e=>e.kind),["video","image","text","subtitle"]);
 }finally{globalThis.fetch=original;}
});
function fixture() {
  const calls=[]; let deleted=false,taskDeleted=false;
  const fetcher=async (url,options)=>{
    if (new URL(url).hostname === "nw34.seedr.cc") {
      assert.equal(options.method,"HEAD");assert.equal(options.redirect,"manual");assert.equal(options.headers,undefined);
      return new Response(null,{status:200});
    }
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
test("extensionless provider files are downloadable files, not folders",async()=>{
 const {adapter,fetcher}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>url.endsWith("/fs/folder/11/contents")?Response.json({id:11,path:`LinkBox-${id}/Sample`,parent:10,size:100,folders:[],files:[{id:30,name:"LICENSE",size:100,folder_id:11,is_video:false,is_audio:false}]}):fetcher(url,options);
 const contents=await adapter.contents("a",item);assert.equal(contents.kind,"other");assert.equal(contents.entries[0].kind,"other");assert.ok(await adapter.downloadUrl("a",item,contents.entries[0].id));
 }finally{globalThis.fetch=original;}
});
test("unavailable direct files produce safe errors before browser navigation",async()=>{
 const {adapter,fetcher}=fixture(),original=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>new URL(url).hostname==="nw34.seedr.cc"?new Response(null,{status:404}):fetcher(url,options);
 await assert.rejects(adapter.downloadUrl("a",item),error=>error.code==="seedr_delivery_unavailable"&&!error.message.includes("temporary=fixture"));
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
