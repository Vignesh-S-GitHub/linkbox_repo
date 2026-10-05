import type { AdminAccount } from "@temporary-share/shared";
import type { Database } from "../database/database";
import type { AccountConfig, AccountState, Env } from "../types";
import { accountsFromEnv } from "../config";
import { ApiProblem, sha256 } from "../utils/magnet";
import { equalDigests } from "../utils/owner";
import { readJsonBody } from "../utils/request-body";
import type { SeedrAdapter } from "../seedr/adapter";
import { configuredAccounts } from "./configuration";

export async function requireAdmin(request: Request, env: Env, database: Database) {
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !["localhost","127.0.0.1","[::1]"].includes(url.hostname)) throw new ApiProblem(403,"admin_https_required","Admin access requires HTTPS.");
  const expected = env.LINKBOX_ADMIN_KEY_SHA256;
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) throw new ApiProblem(503,"admin_not_configured","Private admin access is not configured. Run npm run admin:setup:production in your local terminal.");
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7) : "";
  const valid = /^[A-Za-z0-9._~-]{32,128}$/.test(key) && equalDigests(await sha256(key),expected);
  if (!valid) {
    const identity = await sha256(request.headers.get("cf-connecting-ip") ?? "local");
    const allowed = await database.acquireLease(`admin-failed:${identity}`,Date.now(),15000);
    throw new ApiProblem(allowed ? 401 : 429,"admin_unauthorized",allowed ? "Enter your private admin access key." : "Please wait before trying the admin key again.");
  }
  if (request.method !== "GET" && request.headers.get("origin") !== (env.ALLOWED_ORIGIN ?? "http://localhost:5173")) throw new ApiProblem(403,"origin_not_allowed","This origin is not allowed.");
}

export async function adminAccounts(env: Env, database: Database): Promise<AdminAccount[]> {
  const accounts = await configuredAccounts(env,database), cached = await database.cachedAccounts(true);
  return accounts.map(account => {
    const state = cached.find(value => value.id === account.id);
    return {id:account.id,label:account.label,enabled:account.enabled,capacityBytes:state?.capacityBytes ?? account.capacityBytes,
      usedBytes:state?.usedBytes ?? null,availableBytes:state?.availableBytes ?? null,lastSyncedAt:state?.lastSyncedAt ?? null,
      secretConfigured: typeof env[account.secretKeyReference] === "string" && !!env[account.secretKeyReference]};
  });
}

export async function changeAccount(request: Request, env: Env, database: Database, adapter: SeedrAdapter, accountId?: string) {
  const body = await readJsonBody(request);
  // Shared lock serializes changes with submissions and owner deletion. Never remove a token or account FK.
  const lock = await database.acquireLease("submission",Date.now(),120000);
  if (!lock) throw new ApiProblem(409,"submission_busy","A download or account change is in progress. Please retry shortly.");
  try {
    const accounts = await configuredAccounts(env,database);
    if (accountId) {
      if (typeof body.enabled !== "boolean" || Object.keys(body).some(key => key !== "enabled")) throw new ApiProblem(400,"invalid_account","Choose whether this account accepts new downloads.");
      const account = accounts.find(value => value.id === accountId);
      if (!account) throw new ApiProblem(404,"account_not_found","This account is not configured.");
      if (!body.enabled && !accounts.some(value => value.id !== accountId && value.enabled)) throw new ApiProblem(409,"last_account","Keep at least one account enabled.");
      if (body.enabled && typeof env[account.secretKeyReference] !== "string") throw new ApiProblem(409,"account_secret_missing","Save this account's token in Worker Secrets before enabling it.");
      if (body.enabled) await adapter.verifyAccount(account.secretKeyReference);
      await database.saveAccountConfiguration({...account,enabled:body.enabled});
      // Disabled accounts keep their identity/secret reference for polling, delivery and expiration.
      await database.syncAccounts((await database.cachedAccounts()).filter(value => value.id !== accountId || body.enabled));
      return;
    }
    if (accounts.length >= 8) throw new ApiProblem(409,"account_limit","Up to eight accounts can be configured, including disabled accounts.");
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const reference = body.secretKeyReference;
    if (!label || label.length > 128 || [...label].some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127) || typeof reference !== "string" || !/^SEEDR_[A-Z0-9_]+_TOKEN$/.test(reference) || reference.length > 128 || body.distinctAccount !== true || Object.keys(body).some(key => !["label","secretKeyReference","distinctAccount"].includes(key))) {
      throw new ApiProblem(400,"invalid_account","Enter a label and Worker secret name, and confirm this is a different Seedr account. Never enter a token here.");
    }
    if (accounts.some(value => value.secretKeyReference === reference)) throw new ApiProblem(409,"duplicate_account","This Worker secret is already connected.");
    const token = env[reference];
    if (typeof token !== "string" || !token) throw new ApiProblem(409,"account_secret_missing","Save the token under that name in Cloudflare Worker Secrets first.");
    const digest = await sha256(token);
    for (const account of accounts) {
      const existing = env[account.secretKeyReference];
      if (typeof existing === "string" && equalDigests(await sha256(existing),digest)) throw new ApiProblem(409,"duplicate_account","This token is already connected under another secret name.");
    }
    // The same verified official quota GET used by normal storage refresh. No remote files change.
    const quota = await adapter.verifyAccount(reference);
    const account: AccountConfig = {id:`account-${crypto.randomUUID()}`,label,enabled:true,capacityBytes:quota.capacityBytes,secretKeyReference:reference};
    accountsFromEnv({...env,SEEDR_ACCOUNT_CONFIG:JSON.stringify([...accounts,account])});
    await database.saveAccountConfiguration(account);
    const state: AccountState = {...account,...quota,lastSyncedAt:new Date().toISOString()};
    await database.syncAccounts([...await database.cachedAccounts(),state]);
  } finally { await database.releaseLease("submission",lock); }
}
