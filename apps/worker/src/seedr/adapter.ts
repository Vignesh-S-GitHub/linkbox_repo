import type { AccountState, SeedrItem } from "../types";
import type { FileContents } from "@temporary-share/shared";
export interface SeedrAdapter {
  syncAccounts(): Promise<AccountState[]>;
  inspectMagnet(magnet: string): Promise<{sizeBytes: number | null; displayName: string | null}>;
  addMagnet(accountId: string, magnet: string, context?: { publicId: string; checkpoint: (itemId: string) => Promise<void> }): Promise<SeedrItem>;
  getItem(accountId: string, itemId: string): Promise<SeedrItem>;
  deleteItem(accountId: string, itemId: string): Promise<void>;
  contents(accountId: string, itemId: string): Promise<FileContents | null>;
  playbackUrl(accountId: string, itemId: string, entryId?: string): Promise<string | null>;
  downloadUrl(accountId: string, itemId: string, entryId?: string): Promise<string | null>;
}
