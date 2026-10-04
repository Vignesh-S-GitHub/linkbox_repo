import type { FileContents } from "@temporary-share/shared";
import type { AccountConfig, AccountState, Env, SeedrItem } from "../types";
import type { SeedrAdapter } from "./adapter";
import { ApiProblem } from "../utils/magnet";
import { SeedrTokenClient } from "./token-client";

/** Verified PAT storage reads. Unverified transfer capabilities fail closed. */
export class LiveSeedrAdapter implements SeedrAdapter {
  constructor(private readonly config: AccountConfig[], private readonly env: Env) {}

  async syncAccounts(): Promise<AccountState[]> {
    return Promise.all(this.config.filter(account => account.enabled).map(async account => {
      const secret = this.env[account.secretKeyReference];
      if (typeof secret !== "string" || account.secretKeyReference.endsWith("_BASIC_AUTH")) {
        throw new ApiProblem(503, "seedr_token_missing", "Configure a private Seedr Personal Access Token, not legacy Basic authentication.");
      }
      const quota = await new SeedrTokenClient(secret).quota();
      if (this.env.SEEDR_ACCESS !== "storage-only" && quota.capacityBytes !== account.capacityBytes) {
        throw new ApiProblem(503, "seedr_capacity_mismatch", "Configured capacity does not match Seedr. Verify the real account capacity and quota units before enabling live mode.");
      }
      return { ...account, ...quota, lastSyncedAt: new Date().toISOString() };
    }));
  }

  async inspectMagnet(): Promise<{ sizeBytes: number | null; displayName: string | null }> { throw pendingTransfer(); }
  async addMagnet(): Promise<SeedrItem> { throw pendingTransfer(); }
  async getItem(): Promise<SeedrItem> { throw pendingTransfer(); }
  async deleteItem(): Promise<void> { throw pendingTransfer(); }
  async contents(): Promise<FileContents | null> { return null; }
  async playbackUrl(): Promise<string | null> { return null; }
  async downloadUrl(): Promise<string | null> { return null; }
}

function pendingTransfer(): ApiProblem {
  return new ApiProblem(409, "seedr_transfer_not_enabled", "Real downloads and cleanup are not enabled until metadata and completed-file mappings are verified.");
}
