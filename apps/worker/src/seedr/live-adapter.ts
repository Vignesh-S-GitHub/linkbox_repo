import type { FileContents, FileEntry } from "@temporary-share/shared";
import { fileKind } from "../../../../packages/shared/src/file-kind";
import type { AccountConfig, AccountState, Env, SeedrItem } from "../types";
import type { SeedrAdapter } from "./adapter";
import { ApiProblem, sha256, validateMagnet } from "../utils/magnet";
import { SeedrTokenClient } from "./token-client";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as ObjectValue;
}
function numeric(value: unknown): number {
  const result = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) throw invalid();
  return result;
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw invalid();
  return [...value].filter(character=>character.charCodeAt(0)>=32 && character.charCodeAt(0)!==127).join("").slice(0, 255) || "Shared file";
}
function array(value: unknown): ObjectValue[] { if (!Array.isArray(value) || value.length > 1000) throw invalid(); return value.map(object); }
function invalid() { return new ApiProblem(502, "seedr_invalid_response", "Seedr returned unexpected file information."); }
function ownership() { return new ApiProblem(409, "seedr_ownership", "This file is not managed by LinkBox. No personal files were changed."); }
type Identity = { publicId: string; folderId: number; taskId: number };
function identity(itemId: string): Identity {
  const match = /^linkbox:([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}):(\d+):(\d+)$/.exec(itemId);
  if (!match) throw ownership();
  return { publicId: match[1], folderId: numeric(match[2]), taskId: numeric(match[3]) };
}
function key(id: Identity): string { return `linkbox:${id.publicId}:${id.folderId}:${id.taskId}`; }
function directUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw invalid();
  let url: URL; try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)*seedr\.cc$/i.test(url.hostname) || url.username || url.password || url.port || url.pathname.startsWith("/api/")) throw invalid();
  return url.href;
}
type RemoteFile = { remoteId: number; entry: FileEntry };

/** Official PAT endpoint forms and app-owned sample verified 2026-10-04.
 * No account-wide imports, arbitrary remote IDs, credentials or media proxy. */
export class LiveSeedrAdapter implements SeedrAdapter {
  private requests = 0;
  constructor(private readonly config: AccountConfig[], private readonly env: Env) {}
  private client(accountId: string): SeedrTokenClient {
    const account = this.config.find(value => value.id === accountId);
    if (!account) throw new ApiProblem(503, "seedr_token_missing", "Configure a private Seedr Personal Access Token.");
    return this.secretClient(account.secretKeyReference);
  }
  private secretClient(reference: string): SeedrTokenClient {
    const secret = this.env[reference];
    if (typeof secret !== "string" || !secret || reference.endsWith("_BASIC_AUTH")) throw new ApiProblem(503, "seedr_token_missing", "Configure a private Seedr Personal Access Token.");
    return new SeedrTokenClient(secret, fetch, () => {
      // One adapter per invocation. Leave room for optional Turnstile and stay
      // below the free Worker's 50 external-subrequest limit, even on recovery.
      if (this.requests >= 48) throw new ApiProblem(503, "seedr_request_budget", "This operation will retry in the next cleanup or progress cycle.");
      this.requests++;
    });
  }
  async verifyAccount(reference: string) { return this.secretClient(reference).quota(); }
  async syncAccounts(): Promise<AccountState[]> {
    return Promise.all(this.config.filter(account => account.enabled).map(async account => ({
      ...account, ...await this.client(account.id).quota(), lastSyncedAt: new Date().toISOString(),
    })));
  }
  async inspectMagnet(magnet: string) {
    validateMagnet(magnet);
    // No documented size-only preflight. xl/dn are untrusted user hints.
    return { sizeBytes: null, displayName: null };
  }
  private async ownedFolder(client: SeedrTokenClient, id: Identity): Promise<ObjectValue | null> {
    if (!id.folderId) {
      const root = object(await client.request("/fs/root/contents"));
      const found = array(root.folders).filter(folder => folder.path === `LinkBox-${id.publicId}`);
      if (found.length > 1) throw ownership();
      if (!found.length) return null;
      id.folderId = numeric(found[0].id);
    }
    const value = await client.request(`/fs/folder/${id.folderId}/contents`, "GET", undefined, true);
    if (!value) return null;
    const folder = object(value);
    if (numeric(folder.id) !== id.folderId || folder.path !== `LinkBox-${id.publicId}`) throw ownership();
    return folder;
  }
  async addMagnet(accountId: string, magnet: string, context?: { publicId: string; checkpoint: (itemId: string) => Promise<void> }): Promise<SeedrItem> {
    if (!context) throw ownership();
    const id = identity(`linkbox:${context.publicId}:0:0`), client = this.client(accountId);
    const folder = object(await client.request("/fs/folder", "POST", { name: `LinkBox-${id.publicId}`, parent_id: 0 }));
    id.folderId = numeric(folder.id); if (!id.folderId) throw invalid();
    // Persist ownership BEFORE starting the torrent; response-loss is recoverable.
    await context.checkpoint(key(id));
    const added = object(await client.request("/tasks", "POST", { torrent_magnet: validateMagnet(magnet), folder_id: id.folderId }));
    id.taskId = numeric(added.user_torrent_id); if (!id.taskId) throw invalid();
    // A provider-side duplicate must not silently attach a personal task.
    const task = object(object(await client.request(`/tasks/${id.taskId}`)).task);
    if (numeric(task.folder_id) !== id.folderId) throw ownership();
    await context.checkpoint(key(id));
    return { itemId: key(id), displayName: name(added.title), sizeBytes: 0, status: "fetching_metadata", progress: 0, playable: false };
  }
  private async task(client: SeedrTokenClient, id: Identity): Promise<ObjectValue | null> {
    if (!id.taskId) {
      const result = object(await client.request("/tasks"));
      const match = array(result.tasks).filter(task => numeric(task.folder_id) === id.folderId);
      if (match.length > 1) throw ownership();
      if (!match.length) return null;
      id.taskId = numeric(match[0].id);
    }
    const result = await client.request(`/tasks/${id.taskId}`, "GET", undefined, true);
    if (!result) return null;
    const task = object(object(result).task);
    if (numeric(task.folder_id) !== id.folderId || numeric(task.id) !== id.taskId) throw ownership();
    return task;
  }
  async getItem(accountId: string, itemId: string): Promise<SeedrItem> {
    const id = identity(itemId), client = this.client(accountId);
    const folder = await this.ownedFolder(client, id);
    if (!folder) return { itemId, displayName: "File unavailable", sizeBytes: 0, status: "failed", progress: 0, playable: false };
    const task = await this.task(client, id);
    const size = task ? numeric(task.size) : numeric(folder.size);
    if (task && (typeof task.progress !== "number" || !Number.isFinite(task.progress))) throw invalid();
    const progress = task ? Math.min(100, Math.max(0, Number(task.progress))) : 0;
    const finished = task ? task.state === "finished" : numeric(folder.size) > 0;
    const failed = task && (task.error || ["failed", "error", "cancelled"].includes(String(task.state)));
    const files = finished ? await this.files(client, id, folder) : [];
    const displayName = files.length === 1 ? files[0].entry.displayName : task ? name(task.name) : "Shared files";
    return { itemId: key(id), displayName, sizeBytes: size,
      status: failed ? "failed" : finished && files.length ? "ready" : progress >= 100 ? "processing" : progress > 0 ? "downloading" : "fetching_metadata",
      progress: finished ? 100 : progress, playable: files.length === 1 && files[0].entry.playable,
      kind: finished && files.length ? files.length === 1 ? files[0].entry.kind : "folder" : null,
      fileCount: finished ? files.length : null };
  }
  private async files(client: SeedrTokenClient, id: Identity, root: ObjectValue): Promise<RemoteFile[]> {
    const result: RemoteFile[] = [], pending = [root]; let visited = 0;
    while (pending.length) {
      if (++visited > 8) throw new ApiProblem(409, "folder_limit", "This folder is too deeply nested for V1 browsing.");
      const folder = pending.shift()!;
      for (const value of array(folder.files)) {
        if (numeric(value.folder_id) !== numeric(folder.id)) throw ownership();
        const remoteId = numeric(value.id), displayName = name(value.name), inferred = fileKind(displayName);
        // The provider lists actual files here. An extensionless filename is
        // not a folder, regardless of the fixture name heuristic.
        const kind = inferred === "folder" ? "other" : inferred;
        result.push({ remoteId, entry: { id: (await sha256(`${id.publicId}:${remoteId}`)).slice(0, 40), displayName, sizeBytes: numeric(value.size), kind,
          playable: value.is_video === true || value.is_audio === true, preview: null } });
        if (result.length > 1000) throw invalid();
      }
      for (const child of array(folder.folders)) {
        if (visited + pending.length >= 8) throw new ApiProblem(409, "folder_limit", "This folder has too many subfolders for V1 browsing. No files were changed.");
        if (typeof child.path !== "string" || !child.path.startsWith(`LinkBox-${id.publicId}/`)) throw ownership();
        const value = object(await client.request(`/fs/folder/${numeric(child.id)}/contents`));
        if (numeric(value.parent) !== numeric(folder.id) || numeric(value.id) !== numeric(child.id) || value.path !== child.path) throw ownership();
        pending.push(value);
      }
    }
    return result;
  }
  private async resolve(accountId: string, itemId: string) {
    const id = identity(itemId), client = this.client(accountId), folder = await this.ownedFolder(client, id);
    if (!folder) throw new ApiProblem(410, "file_unavailable", "This file is no longer available.");
    return { client, files: await this.files(client, id, folder) };
  }
  async contents(accountId: string, itemId: string): Promise<FileContents> {
    const { files } = await this.resolve(accountId, itemId);
    return { kind: files.length === 1 ? files[0].entry.kind : "folder", entries: files.map(file => file.entry), preview: null };
  }
  async downloadUrl(accountId: string, itemId: string, entryId?: string): Promise<string | null> {
    const { client, files } = await this.resolve(accountId, itemId);
    const file = entryId ? files.find(value => value.entry.id === entryId) : files.length === 1 ? files[0] : undefined;
    if (!file) return null; // Individual delivery; archive-init body is undocumented.
    const url = directUrl(object(await client.request(`/download/file/${file.remoteId}/url`)).url);
    // Seedr can list sidecar files and issue URLs whose CDN response is 404.
    // HEAD was verified on real delivery URLs: metadata only, no media proxy,
    // no account authorization header, no redirects and no signed URL logging.
    let response: Response;
    try { response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10000) }); }
    catch { throw new ApiProblem(503, "seedr_delivery_unavailable", "Seedr file delivery is temporarily unavailable. Please try again later."); }
    await response.body?.cancel();
    if (!response.ok) throw new ApiProblem(503, "seedr_delivery_unavailable", "Seedr listed this file, but its download is currently unavailable. Please try again later.");
    return url;
  }
  async playbackUrl(accountId: string, itemId: string, entryId?: string): Promise<string | null> {
    const { client, files } = await this.resolve(accountId, itemId);
    const file = entryId ? files.find(value => value.entry.id === entryId) : files.length === 1 ? files[0] : undefined;
    if (!file?.entry.playable) return null;
    const type = file.entry.kind === "audio" ? "audio" : "video";
    // Documented /url endpoint verified; modern video route returned 400.
    return directUrl(object(await client.request(`/presentation/fs/item/${file.remoteId}/${type}/url`)).url);
  }
  async deleteItem(accountId: string, itemId: string): Promise<void> {
    const id = identity(itemId), client = this.client(accountId);
    const folder = await this.ownedFolder(client, id);
    if (id.folderId) {
      const task = await this.task(client, id);
      if (task) await client.request(`/tasks/${id.taskId}`, "DELETE", undefined, true);
    }
    if (folder) await client.request(`/fs/folder/${id.folderId}`, "DELETE", undefined, true);
  }
}
