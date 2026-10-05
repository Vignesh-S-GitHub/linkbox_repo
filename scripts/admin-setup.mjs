import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export function adminDigest(key) {
  if (!/^[A-Za-z0-9._~-]{32,128}$/.test(key)) throw new Error("Use a unique 32-128 character admin key containing only letters, numbers, . _ ~ -.");
  return createHash("sha256").update(key,"utf8").digest("hex");
}
export function renderAdminVars(existing,digest) {
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid admin digest.");
  const lines=existing.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?LINKBOX_ADMIN_KEY_SHA256\s*=/.test(line));
  while(lines.at(-1)==="")lines.pop();
  return [...lines,`LINKBOX_ADMIN_KEY_SHA256=${digest}`,""].join("\n");
}
async function saveLocal(digest) {
  const target=fileURLToPath(new URL("../apps/worker/.dev.vars",import.meta.url));
  const temporary=`${target}.${randomUUID()}.local-config.tmp`;
  const ignore=await readFile(new URL("../.gitignore",import.meta.url),"utf8");
  if (!/^\.dev\.vars\s*$/m.test(ignore)||!/^\*\.local-config\.tmp\s*$/m.test(ignore))throw new Error("Private configuration ignore rules are missing.");
  let existing="";
  try {const info=await lstat(target);if(!info.isFile()||info.isSymbolicLink())throw new Error("Private configuration must be a regular local file.");existing=await readFile(target,"utf8");}
  catch(error){if(error.code!=="ENOENT")throw error;}
  let pending=false;
  try {await writeFile(temporary,renderAdminVars(existing,digest),{encoding:"utf8",mode:0o600,flag:"wx"});pending=true;await rename(temporary,target);pending=false;}
  finally {if(pending)await unlink(temporary);}
}
async function saveProduction(digest) {
  const require=createRequire(new URL("../apps/worker/package.json",import.meta.url));
  const cli=require.resolve("wrangler/bin/wrangler.js");
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,"secret","put","LINKBOX_ADMIN_KEY_SHA256","--env","production"],{cwd:fileURLToPath(new URL("../apps/worker",import.meta.url)),stdio:["pipe","inherit","inherit"],windowsHide:true});
    child.on("error",reject);child.stdin.on("error",reject);
    child.on("exit",code=>code===0?resolve():reject(new Error("Private admin secret setup failed. Check Wrangler authentication.")));
    child.stdin.end(`${digest}\n`);
  });
}
async function main() {
  let key="";
  try {
    for await(const chunk of process.stdin){key+=chunk.toString();if(key.length>130)throw new Error("Admin key input is too long.");}
    key=key.replace(/\r?\n$/,"");const digest=adminDigest(key);key="";
    if(process.argv.includes("--production"))await saveProduction(digest);else await saveLocal(digest);
    console.log("Admin access configured using a SHA-256 digest only. No raw key was saved.");
    console.log(process.argv.includes("--production")?"Open Settings → Accounts on your deployed site and unlock privately.":"Restart the local Worker, then open Settings → Accounts.");
  } catch {console.error("Admin setup failed safely. Check key format, file permissions and Wrangler login. No key was printed.");process.exitCode=1;}
  finally {key="";}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
