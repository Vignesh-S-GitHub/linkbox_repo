import { readFile, writeFile, rename, unlink, lstat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkQuota } from "./seedr-check.mjs";

export function renderWorkerVars(existing, token, quota) {
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 8192) throw new Error("Invalid token format.");
  if (!Number.isSafeInteger(quota.space_max) || !Number.isSafeInteger(quota.space_used) || quota.space_max <= 0 || quota.space_used < 0 || quota.space_used > quota.space_max) throw new Error("Invalid quota counts.");
  const config = [{ id: "seedr-a", label: "Seedr account", enabled: true, capacityBytes: quota.space_max, secretKeyReference: "SEEDR_ACCOUNT_A_TOKEN" }];
  const updates = {
    SEEDR_MODE: "live",
    SEEDR_ACCESS: "full",
    SEEDR_ACCOUNT_CONFIG: JSON.stringify(config),
    SEEDR_ACCOUNT_A_TOKEN: token,
  };
  // Preserve unrelated settings/secrets; replace every duplicate of our keys.
  const lines = existing.split(/\r?\n/).filter(line => !Object.keys(updates).some(key => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)));
  while (lines.length && lines.at(-1) === "") lines.pop();
  return [...lines, ...Object.entries(updates).map(([key, value]) => `${key}=${value}`), ""].join("\n");
}

async function saveWorkerConfig(token, quota) {
  // Fixed files inside this project; never accept a credential output path.
  const target = fileURLToPath(new URL("../apps/worker/.dev.vars", import.meta.url));
  const temporary = `${target}.${crypto.randomUUID()}.local-config.tmp`;
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  if (!/^\.dev\.vars\s*$/m.test(ignore) || !/^\*\.local-config\.tmp\s*$/m.test(ignore)) {
    throw new Error("Private configuration ignore rules are missing. Token was not saved.");
  }
  let existing = "";
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Private configuration must be a regular local file.");
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let temporaryExists = false;
  try {
    await writeFile(temporary, renderWorkerVars(existing, token, quota), { encoding: "utf8", mode: 0o600, flag: "wx" });
    temporaryExists = true;
    await rename(temporary, target);
    temporaryExists = false;
  } finally {
    if (temporaryExists) await unlink(temporary);
  }
}

async function main() {
  let token = "";
  try {
    for await (const chunk of process.stdin) {
      token += chunk.toString();
      if (token.length > 8194) throw new Error("Token input exceeded the size limit.");
    }
    token = token.trim();
    const result = await checkQuota(token, fetch, true);
    try { await saveWorkerConfig(token, result.storageCounts); }
    catch { throw new Error("Unable to save private Worker configuration. No token was printed; check local file permissions."); }
    console.log("Configured one real Seedr account for LinkBox V1 live operations.");
    console.log("Token saved only in ignored apps/worker/.dev.vars. Do not share that file.");
    console.log("Capacity and usage will come from your actual Seedr quota, not the demo pool.");
    console.log("Setup changed no Seedr files. The running app can add and deliver app-managed files; eligible cleanup and Cron can delete them.");
    console.log("Restart npm run dev, then refresh the website and open Storage.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Seedr configuration failed.");
    process.exitCode = 1;
  } finally { token = ""; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
