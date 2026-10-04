import type { FileContents } from "@temporary-share/shared";
import { fileKind } from "../../../../packages/shared/src/file-kind";
import type { AccountConfig, AccountState, SeedrItem } from "../types";
import type { SeedrAdapter } from "./adapter";
import { mockRows, projectEntries } from "./mock-fixtures";

interface MockItem extends SeedrItem { accountId: string; startedAt: number; initialProgress: number; }
export class MockSeedrAdapter implements SeedrAdapter {
  private readonly accounts: AccountState[];
  private readonly items = new Map<string, MockItem>();
  constructor(config: AccountConfig[]) {
    this.accounts = config.map((account, index) => {
      const usedBytes = Math.min(account.capacityBytes, (index === 0 ? 3.6 : index === 1 ? 2.6 : 0) * 1024 ** 3);
      return { ...account, usedBytes, availableBytes: account.capacityBytes - usedBytes, lastSyncedAt: new Date().toISOString() };
    });
    for (const row of mockRows()) {
      this.items.set(row.seedrItemId, { itemId: row.seedrItemId, accountId: row.seedrAccountId,
        displayName: row.displayName, sizeBytes: row.sizeBytes, status: row.status,
        progress: row.progress, playable: row.playable, kind: row.kind, fileCount: row.fileCount, startedAt: Date.now(), initialProgress: row.progress });
    }
  }
  async syncAccounts() { this.tick(); return structuredClone(this.accounts); }
  async inspectMagnet(magnet: string) {
    const url = new URL(magnet);
    const rawSize = url.searchParams.get("xl");
    const sizeBytes = rawSize && /^\d+$/.test(rawSize) ? Number(rawSize) : Math.round(1.4 * 1024 ** 3);
    return { sizeBytes, displayName: url.searchParams.get("dn")?.slice(0, 120) ?? "New shared file.mp4" };
  }
  async addMagnet(accountId: string, magnet: string) {
    const info = await this.inspectMagnet(magnet);
    const account = this.accounts.find(value => value.id === accountId);
    if (!account || !info.sizeBytes || account.availableBytes < info.sizeBytes) throw new Error("Not enough space");
    const item: MockItem = { ...info, itemId: `mock-${crypto.randomUUID()}`, accountId,
      status: "fetching_metadata", progress: 0, initialProgress: 0, startedAt: Date.now(),
      playable: ["video", "audio"].includes(fileKind(info.displayName)), kind: fileKind(info.displayName) };
    this.items.set(item.itemId, item);
    account.usedBytes += item.sizeBytes;
    account.availableBytes -= item.sizeBytes;
    return structuredClone(item);
  }
  async getItem(accountId: string, itemId: string) {
    this.tick();
    const item = this.items.get(itemId);
    if (!item || item.accountId !== accountId) throw new Error("File unavailable");
    return structuredClone(item);
  }
  async deleteItem(accountId: string, itemId: string) {
    const item = this.items.get(itemId);
    if (!item) return;
    if (item.accountId !== accountId) throw new Error("File unavailable");
    const account = this.accounts.find(value => value.id === accountId);
    if (account) { account.usedBytes = Math.max(0, account.usedBytes - item.sizeBytes); account.availableBytes = account.capacityBytes - account.usedBytes; }
    this.items.delete(itemId);
  }
  async contents(accountId: string, itemId: string): Promise<FileContents> {
    const item = await this.getItem(accountId, itemId);
    const entries = item.displayName === "Project Files" ? projectEntries : [];
    return { kind: fileKind(item.displayName), entries: structuredClone(entries), preview: item.displayName === "User Guide.pdf" ? "guide" : null };
  }
  async playbackUrl(accountId: string, itemId: string, entryId?: string) {
    const item = await this.getItem(accountId, itemId);
    const entry = entryId ? (await this.contents(accountId, itemId)).entries.find(entry => entry.id === entryId) : null;
    if (item.status !== "ready" || (entryId ? !entry?.playable : !item.playable)) return null;
    // Small externally hosted CC0 sample, never stored on application infrastructure.
    return "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
  }
  async downloadUrl(accountId: string, itemId: string, entryId?: string) {
    const item = await this.getItem(accountId, itemId);
    if (entryId && !(await this.contents(accountId, itemId)).entries.some(entry => entry.id === entryId)) return null;
    return item.status === "ready" ? "mock://download" : null;
  }
  private tick() {
    for (const item of this.items.values()) {
      if (!["fetching_metadata", "downloading", "processing"].includes(item.status)) continue;
      const elapsed = (Date.now() - item.startedAt) / 1000;
      item.progress = Math.min(100, Math.floor(item.initialProgress + elapsed * 1.5));
      item.status = elapsed < 5 ? item.status : item.progress < 100 ? "downloading" : elapsed < (100 - item.initialProgress) / 1.5 + 5 ? "processing" : "ready";
    }
  }
}
