import type { ApiError, StorageFullFile, StorageSummary } from "@temporary-share/shared";
import { accountsFromEnv, maxActiveDownloads, maxFileBytes } from "./config";
import { databaseFor } from "./database/factory";
import type { Database } from "./database/database";
import { deleteCommunityItem, expireDueItems } from "./cleanup/cleanup-service";
import { LiveSeedrAdapter } from "./seedr/live-adapter";
import { MockSeedrAdapter } from "./seedr/mock-adapter";
import type { SeedrAdapter } from "./seedr/adapter";
import { selectAccount } from "./storage/account-selection";
import type { AccountState, DownloadRow, Env } from "./types";
import { publicDownload } from "./types";
import { ApiProblem, magnetIdentity, sha256, validateMagnet } from "./utils/magnet";
import { readJsonBody } from "./utils/request-body";

// Only synthetic local demo state lives in memory. Live coordination lives in D1.
let mockAdapter: MockSeedrAdapter | undefined;
function adapterFor(env: Env): SeedrAdapter {
  const accounts = accountsFromEnv(env);
  if (env.SEEDR_MODE === "mock") { mockAdapter ??= new MockSeedrAdapter(accounts); return mockAdapter; }
  return new LiveSeedrAdapter(accounts, env);
}
function cors(env: Env, request: Request) {
  const origin = request.headers.get("origin"), allowed = env.ALLOWED_ORIGIN ?? "http://localhost:5173";
  return { "access-control-allow-origin": origin === allowed ? origin : allowed,
    "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, x-session-id",
    "vary": "Origin", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
}
function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}
function toStorage(accounts: AccountState[]): StorageSummary {
  const enabled = accounts.filter(account => account.enabled);
  const capacityBytes = enabled.reduce((total, account) => total + account.capacityBytes, 0);
  const usedBytes = enabled.reduce((total, account) => total + account.usedBytes, 0);
  return { capacityBytes, usedBytes, availableBytes: Math.max(0, capacityBytes - usedBytes),
    refreshedAt: enabled.map(account => account.lastSyncedAt).sort()[0] ?? new Date().toISOString() };
}
async function storageSnapshot(database: Database, adapter: SeedrAdapter, env: Env) {
  const cached = await database.cachedAccounts(), configured = accountsFromEnv(env).filter(account => account.enabled);
  if (cached.length === configured.length && cached.every(account => configured.some(value => value.id === account.id) && Date.now() - Date.parse(account.lastSyncedAt) < 60000)) return toStorage(cached);
  const accounts = await adapter.syncAccounts(); await database.syncAccounts(accounts); return toStorage(accounts);
}
function eligibleFiles(rows: DownloadRow[], now: string): StorageFullFile[] {
  return rows.filter(row => !row.deletedAt && row.status !== "deleting").map(row => ({ id: row.publicId, displayName: row.displayName, sizeBytes: row.sizeBytes,
    createdAt: row.createdAt, cleanupAllowedAt: row.cleanupAllowedAt, protected: row.cleanupAllowedAt > now }));
}
async function refreshRows(database: Database, adapter: SeedrAdapter, env: Env) {
  const rows = await database.listActive();
  const result: DownloadRow[] = []; let refreshed = 0;
  // Sequential bounded work avoids exhausting the free Worker's subrequest limit.
  for (const row of rows) {
    const reconcile = row.status === "ready" && !row.kind;
    if ((!reconcile && ["ready", "failed", "deleted", "expired", "deleting"].includes(row.status)) || row.expiresAt <= new Date().toISOString() ||
        refreshed >= 2 || !await database.acquireLease(`poll:${row.publicId}`, Date.now(), reconcile ? 300000 : 15000)) { result.push(row); continue; }
    refreshed++;
    try {
      if (reconcile) {
        // Read-only backfill for existing ready items. Do not replay tasks,
        // reset lifetimes or delete anything during type reconciliation.
        const contents = await adapter.contents(row.seedrAccountId, row.seedrItemId);
        result.push(contents ? await database.update({ ...row, kind: contents.kind, fileCount: contents.entries.length }) : row);
        continue;
      }
      const item = await adapter.getItem(row.seedrAccountId, row.seedrItemId);
      if (item.sizeBytes > maxFileBytes(env)) {
        // Provider resolves size after acceptance. Policy rejects oversized owned
        // content; community protection does not authorize retaining an unsafe task.
        await adapter.deleteItem(row.seedrAccountId, item.itemId);
        result.push(await database.update({ ...row, seedrItemId: item.itemId, sizeBytes: item.sizeBytes, status: "failed", playable: false,
          errorMessage: "This file exceeds the supported size limit and was removed." }));
      } else result.push(await database.update({ ...row, seedrItemId: item.itemId, displayName: item.displayName, sizeBytes: item.sizeBytes,
        status: item.status, progress: item.progress, playable: item.playable, kind: item.kind ?? null, fileCount: item.fileCount ?? null,
        errorMessage: item.status === "failed" ? "Download failed or was removed from Seedr." : null }));
    } catch {
      // A transient outage must not permanently fail the task or lose ownership.
      result.push(reconcile ? row : await database.update({ ...row, errorMessage: "Seedr is temporarily unavailable. Progress will retry automatically." }));
    }
  }
  return result;
}
async function rateLimit(database: Database, request: Request, env: Env, action: string) {
  const session = request.headers.get("x-session-id");
  if (!session || !/^[a-z0-9-]{8,128}$/i.test(session)) throw new ApiProblem(400, "invalid_session", "A browser session is required.");
  const period = action === "submit" ? Math.max(0, Number(env.SUBMISSION_COOLDOWN_SECONDS ?? 30)) * 1000 : 1000;
  const ip = request.headers.get("cf-connecting-ip");
  const identities = [`session:${await sha256(session)}`];
  if (ip) identities.push(`ip:${await sha256(`${new Date().toISOString().slice(0, 10)}:${ip}`)}`);
  for (const identity of identities) if (!await database.acquireLease(`${action}:${identity}`, Date.now(), period)) {
    throw new ApiProblem(429, "submission_cooldown", "Please wait a moment before trying again.");
  }
}
async function verifyTurnstile(token: unknown, env: Env) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (typeof token !== "string" || token.length > 2048) throw new ApiProblem(403, "verification_required", "Complete the security verification before adding a file.");
  let response: Response;
  try { response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }), signal: AbortSignal.timeout(10000) }); }
  catch { throw new ApiProblem(503, "verification_unavailable", "Security verification is temporarily unavailable."); }
  const value = await response.json() as { success?: boolean; hostname?: string };
  if (!value.success || value.hostname !== new URL(env.ALLOWED_ORIGIN ?? "http://localhost:5173").hostname) throw new ApiProblem(403, "verification_failed", "Security verification failed. Please try again.");
}
async function createDownload(request: Request, env: Env) {
  const body = await readJsonBody(request), magnet = validateMagnet(body.magnet), database = databaseFor(env), adapter = adapterFor(env);
  await verifyTurnstile(body.turnstileToken, env);
  const hash = await sha256(magnetIdentity(magnet));
  const lock = await database.acquireLease("submission", Date.now(), 120000);
  if (!lock) throw new ApiProblem(429, "submission_busy", "Another download is being added. Please try again shortly.");
  try {
    if (await database.findActiveByHash(hash)) throw new ApiProblem(409, "duplicate_magnet", "That download is already active.");
    const [inspection, accounts, active] = await Promise.all([adapter.inspectMagnet(magnet), adapter.syncAccounts(), database.listActive()]);
    await database.syncAccounts(accounts);
    if (active.length >= maxActiveDownloads(env)) throw new ApiProblem(429, "active_limit", "Shared storage has reached its active download limit.");
    const requested = inspection.sizeBytes;
    if (requested !== null && requested > maxFileBytes(env)) throw new ApiProblem(413, "file_too_large", "This file exceeds the supported temporary storage limit.");
    // Unknown sizes are never treated as zero, and only one transferring item
    // can occupy an account at once. Seedr enforces the final resolved fit.
    const candidates = accounts.filter(account => !active.some(row => row.seedrAccountId === account.id && ["queued", "fetching_metadata", "downloading", "processing"].includes(row.status)));
    const account = requested === null ? candidates.filter(value => value.availableBytes > 0).sort((a, b) => b.availableBytes - a.availableBytes)[0] : selectAccount(candidates, requested);
    if (!account) {
      const files = eligibleFiles(active, new Date().toISOString());
      throw new ApiProblem(409, "storage_full", candidates.length ? "Not enough space in one account." : "A transfer is already using the available account. Wait for it to finish before adding another.", {
        requestedBytes: requested ?? undefined, availableBytes: Math.max(0, ...candidates.map(value => value.availableBytes)),
        eligibleFiles: files.filter(file => !file.protected), protectedFiles: files.filter(file => file.protected),
      });
    }
    await rateLimit(database, request, env, "submit");
    const created = new Date(), publicId = crypto.randomUUID();
    let row: DownloadRow = { id: crypto.randomUUID(), publicId, seedrAccountId: account.id, seedrItemId: `linkbox:${publicId}:0:0`, magnetHash: hash,
      displayName: "New shared download", sizeBytes: requested ?? 0, status: "queued", progress: 0, createdAt: created.toISOString(),
      cleanupAllowedAt: new Date(+created + 10800000).toISOString(), expiresAt: new Date(+created + 86400000).toISOString(),
      deletedAt: null, errorMessage: null, cleanupClaimedAt: null, playable: false };
    row = await database.create(row); // Admission / uniqueness BEFORE Seedr writes.
    try {
      const item = await adapter.addMagnet(account.id, magnet, { publicId, checkpoint: async itemId => {
        row = await database.update({ ...row, seedrItemId: itemId, status: "fetching_metadata" });
      } });
      row = await database.update({ ...row, seedrItemId: item.itemId, displayName: item.displayName, sizeBytes: item.sizeBytes,
        status: item.status, progress: item.progress, playable: item.playable, kind: item.kind ?? null, fileCount: item.fileCount ?? null });
    } catch (error) {
      // Persist uncertain acceptance instead of blindly replaying POST. Polling
      // recovers by the exact app folder; Cron can clean abandoned reservations.
      const rejected = error instanceof ApiProblem && error.status === 409;
      row = await database.update({ ...row, status: rejected ? "failed" : "fetching_metadata", errorMessage: rejected ? "Seedr could not accept this download. Check available storage and account restrictions." : "Submission confirmation is delayed. Progress will retry automatically." });
    }
    return publicDownload(row);
  } finally { await database.releaseLease("submission", lock); }
}
function storageOnly(env: Env) { return env.SEEDR_MODE === "live" && env.SEEDR_ACCESS === "storage-only"; }
async function appFetch(request: Request, env: Env): Promise<Response> {
  const headers = cors(env, request);
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== (env.ALLOWED_ORIGIN ?? "http://localhost:5173")) throw new ApiProblem(403, "origin_not_allowed", "This origin is not allowed.");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith("/api/") || (storageOnly(env) && !path.startsWith("/api/downloads") && path !== "/api/storage")) throw new ApiProblem(404, "not_found", "Not found.");
    if (storageOnly(env)) {
      if (path === "/api/storage" && request.method === "GET") {
        const accounts = accountsFromEnv(env).filter(value => value.enabled);
        if (accounts.length !== 1) throw new ApiProblem(503, "seedr_account_configuration", "Configure one account for read-only mode.");
        return json(toStorage(await new LiveSeedrAdapter(accounts, env).syncAccounts()), 200, headers);
      }
      if (path === "/api/downloads" && request.method === "GET") return json([], 200, headers);
      throw new ApiProblem(409, "storage_only", "File actions are disabled in read-only mode.");
    }
    const database = databaseFor(env), adapter = adapterFor(env);
    if (path === "/api/storage" && request.method === "GET") return json(await storageSnapshot(database, adapter, env), 200, headers);
    if (path === "/api/downloads" && request.method === "GET") return json((await refreshRows(database, adapter, env)).map(publicDownload), 200, headers);
    if (path === "/api/downloads" && request.method === "POST") return json(await createDownload(request, env), 201, headers);
    const match = /^\/api\/downloads\/([0-9a-f-]+)(?:\/(cleanup|play|download|contents))?$/i.exec(path);
    if (!match) throw new ApiProblem(404, "not_found", "This download does not exist.");
    const [, publicId, action] = match, row = await database.findByPublicId(publicId);
    if (!row) throw new ApiProblem(404, "not_found", "This download does not exist.");
    if (!action && request.method === "GET") return json(publicDownload(row), 200, headers);
    if (action === "cleanup" && request.method === "POST") {
      if (row.deletedAt) return json(publicDownload(row), 200, headers);
      if (row.cleanupAllowedAt > new Date().toISOString()) throw new ApiProblem(409, "cleanup_protected", "This file is protected from cleanup for its first 3 hours.");
      await rateLimit(database, request, env, `cleanup:${publicId}`);
      const updated = await deleteCommunityItem(database, adapter, publicId, new Date().toISOString());
      if (!updated) throw new ApiProblem(409, "cleanup_protected", "This file is protected from cleanup or is already being deleted.");
      await database.syncAccounts(await adapter.syncAccounts());
      return json(publicDownload(updated), 200, headers);
    }
    if (request.method !== "GET") throw new ApiProblem(405, "method_not_allowed", "Method not allowed.");
    if (row.deletedAt || row.expiresAt <= new Date().toISOString()) throw new ApiProblem(410, "file_unavailable", "This file is no longer available in LinkBox.");
    if (row.status !== "ready") throw new ApiProblem(409, "not_ready", "This file is not ready yet.");
    if (action === "contents") return json(await adapter.contents(row.seedrAccountId, row.seedrItemId), 200, headers);
    const entryId = url.searchParams.get("entry") ?? undefined;
    if (entryId && (entryId.length > 80 || !/^[a-z0-9-]+$/i.test(entryId))) throw new ApiProblem(400, "invalid_entry", "Invalid file entry.");
    // The adapter resolves only members under the owned folder. Never client IDs.
    const target = action === "play" ? await adapter.playbackUrl(row.seedrAccountId, row.seedrItemId, entryId) : await adapter.downloadUrl(row.seedrAccountId, row.seedrItemId, entryId);
    if (!target) throw new ApiProblem(entryId ? 404 : 409, entryId ? "not_found" : "unsupported", "Open the folder and select a supported file to play or download.");
    if (url.searchParams.get("format") === "json") return json({ url: target === "mock://download" ? `${url.origin}${url.pathname}${entryId ? `?entry=${encodeURIComponent(entryId)}` : ""}` : target }, 200, headers);
    if (target === "mock://download") return new Response("LinkBox synthetic mock download. Media remains on Seedr.", { headers: { ...headers, "content-type": "text/plain", "content-disposition": "attachment; filename=linkbox-mock-download.txt" } });
    return new Response(null, { status: 302, headers: { ...headers, location: target } });
  } catch (error) {
    if (error instanceof ApiProblem) { const value: ApiError = { error: error.message, code: error.code, details: error.details }; return json(value, error.status, headers); }
    console.warn("Request failed safely");
    return json({ error: "The service is temporarily unavailable. Please try again.", code: "service_unavailable" }, 503, headers);
  }
}
export default { fetch: appFetch, scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  if (storageOnly(env)) return;
  ctx.waitUntil((async () => { try {
    const database = databaseFor(env), adapter = adapterFor(env);
    await expireDueItems(database, adapter, new Date().toISOString());
    await database.syncAccounts(await adapter.syncAccounts());
  } catch { console.warn("Scheduled cleanup will retry next cycle"); } })());
} } satisfies ExportedHandler<Env>;
