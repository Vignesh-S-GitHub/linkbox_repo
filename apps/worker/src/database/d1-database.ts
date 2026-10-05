import type { Database } from "./database";
import type { AccountConfig, AccountState, DownloadRow } from "../types";
import { ApiProblem } from "../utils/magnet";

type StoredRow = {
  id: string; public_id: string; seedr_account_id: string; seedr_item_id: string;
  magnet_hash: string; display_name: string; size_bytes: number;
  status: DownloadRow["status"]; progress: number; created_at: string;
  cleanup_allowed_at: string; expires_at: string; deleted_at: string | null;
  error_message: string | null; cleanup_claimed_at: string | null; playable: number;
  kind: DownloadRow["kind"]; file_count: number | null;
  owner_session_hash: string | null;
};

const columns = "id, public_id, seedr_account_id, seedr_item_id, magnet_hash, display_name, size_bytes, status, progress, created_at, cleanup_allowed_at, expires_at, deleted_at, error_message, cleanup_claimed_at, playable, kind, file_count, owner_session_hash";
const mapRow = (row: StoredRow): DownloadRow => ({
  id: row.id, publicId: row.public_id, seedrAccountId: row.seedr_account_id,
  seedrItemId: row.seedr_item_id, magnetHash: row.magnet_hash, displayName: row.display_name,
  sizeBytes: row.size_bytes, status: row.status, progress: row.progress, createdAt: row.created_at,
  cleanupAllowedAt: row.cleanup_allowed_at, expiresAt: row.expires_at,
  deletedAt: row.deleted_at, errorMessage: row.error_message,
  cleanupClaimedAt: row.cleanup_claimed_at, playable: row.playable === 1,
  kind: row.kind, fileCount: row.file_count, ownerSessionHash: row.owner_session_hash,
});

/** Worker-bound D1 only. No browser database credentials or media payloads. */
export class D1MetadataDatabase implements Database {
  constructor(private readonly db: D1Database) {}

  async accountConfigurations(): Promise<AccountConfig[]> {
    const result = await this.query(() => this.db.prepare("SELECT id,label,enabled,capacity_bytes,secret_key_reference FROM account_configuration ORDER BY created_at,id LIMIT 9").all<{
      id:string; label:string; enabled:number; capacity_bytes:number; secret_key_reference:string
    }>());
    return result.results.map(row => ({id:row.id,label:row.label,enabled:row.enabled===1,capacityBytes:row.capacity_bytes,secretKeyReference:row.secret_key_reference}));
  }
  async saveAccountConfiguration(account: AccountConfig): Promise<void> {
    const now = new Date().toISOString();
    const result=await this.query(() => this.db.prepare(`INSERT INTO account_configuration(id,label,enabled,capacity_bytes,secret_key_reference,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET label=excluded.label,enabled=excluded.enabled,
      capacity_bytes=excluded.capacity_bytes,updated_at=excluded.updated_at
      WHERE account_configuration.secret_key_reference=excluded.secret_key_reference RETURNING id`)
      .bind(account.id,account.label,Number(account.enabled),account.capacityBytes,account.secretKeyReference,now).first<{id:string}>());
    if (!result) throw new ApiProblem(409,"account_reference_immutable","An existing account's Worker secret name cannot be changed.");
  }

  async acquireLease(name: string, now: number, ttl: number): Promise<string | null> {
    const holder = crypto.randomUUID();
    const result = await this.query(() => this.db.prepare(`INSERT INTO request_guards(name,holder,expires_ms)
      VALUES (?1,?2,?3) ON CONFLICT(name) DO UPDATE SET holder=excluded.holder,expires_ms=excluded.expires_ms
      WHERE request_guards.expires_ms<=?4 RETURNING holder`).bind(name,holder,now+ttl,now).first<{holder:string}>());
    return result?.holder ?? null;
  }
  async releaseLease(name: string, holder: string): Promise<void> {
    await this.query(() => this.db.prepare("DELETE FROM request_guards WHERE name=?1 AND holder=?2").bind(name,holder).run());
  }
  async pruneGuards(now: number): Promise<void> {
    await this.query(() => this.db.prepare("DELETE FROM request_guards WHERE expires_ms<=?1").bind(now).run());
  }
  async cachedAccounts(includeDisabled=false): Promise<AccountState[]> {
    const result = await this.query(() => this.db.prepare(`SELECT * FROM seedr_accounts${includeDisabled?"":" WHERE enabled=1"}`).all<{
      id:string;label:string;enabled:number;capacity_bytes:number;used_bytes:number;available_bytes:number;secret_key_reference:string;last_synced_at:string
    }>());
    return result.results.map(row=>({id:row.id,label:row.label,enabled:!!row.enabled,capacityBytes:row.capacity_bytes,usedBytes:row.used_bytes,
      availableBytes:row.available_bytes,secretKeyReference:row.secret_key_reference,lastSyncedAt:row.last_synced_at}));
  }

  private async query<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ApiProblem) throw error;
      // Never return SQL text, internal IDs, bindings or raw database errors.
      throw new ApiProblem(503, "database_unavailable", "Metadata storage is temporarily unavailable. Please try again.");
    }
  }

  async syncAccounts(accounts: AccountState[]): Promise<void> {
    if (!accounts.length) return;
    const updatedAt = new Date().toISOString();
    const statements = accounts.map(account => this.db.prepare(`
      INSERT INTO seedr_accounts (id, label, enabled, capacity_bytes, used_bytes,
        available_bytes, secret_key_reference, last_synced_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label, enabled=excluded.enabled,
        capacity_bytes=excluded.capacity_bytes, used_bytes=excluded.used_bytes,
        available_bytes=excluded.available_bytes, secret_key_reference=excluded.secret_key_reference,
        last_synced_at=excluded.last_synced_at, updated_at=excluded.updated_at
    `).bind(account.id, account.label, Number(account.enabled), account.capacityBytes,
      account.usedBytes, account.availableBytes, account.secretKeyReference, account.lastSyncedAt, updatedAt));
    // Removed accounts retain their FK history, but cannot remain enabled in metadata.
    statements.push(this.db.prepare(`UPDATE seedr_accounts SET enabled=0, updated_at=?1
      WHERE enabled=1 AND id NOT IN (${accounts.map((_, index) => `?${index + 2}`).join(",")})`)
      .bind(updatedAt, ...accounts.map(account => account.id)));
    await this.query(() => this.db.batch(statements));
  }

  async listActive(): Promise<DownloadRow[]> {
    const result = await this.query(() => this.db.prepare(`SELECT ${columns} FROM downloads
      WHERE deleted_at IS NULL ORDER BY created_at DESC`).all<StoredRow>());
    return result.results.map(mapRow);
  }

  async findByPublicId(publicId: string): Promise<DownloadRow | null> {
    const row = await this.query(() => this.db.prepare(`SELECT ${columns} FROM downloads
      WHERE public_id=?1 LIMIT 1`).bind(publicId).first<StoredRow>());
    return row ? mapRow(row) : null;
  }

  async findActiveByHash(hash: string): Promise<DownloadRow | null> {
    const row = await this.query(() => this.db.prepare(`SELECT ${columns} FROM downloads
      WHERE magnet_hash=?1 AND deleted_at IS NULL LIMIT 1`).bind(hash).first<StoredRow>());
    return row ? mapRow(row) : null;
  }

  async create(row: DownloadRow): Promise<DownloadRow> {
    return this.query(async () => {
      try {
        const result = await this.db.prepare(`INSERT INTO downloads (${columns}, updated_at)
          VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
          RETURNING ${columns}`).bind(row.id, row.publicId, row.seedrAccountId, row.seedrItemId,
          row.magnetHash, row.displayName, row.sizeBytes, row.status, row.progress,
          row.createdAt, row.cleanupAllowedAt, row.expiresAt, row.deletedAt,
          row.errorMessage, row.cleanupClaimedAt, Number(row.playable), row.kind ?? null, row.fileCount ?? null, row.ownerSessionHash ?? null, new Date().toISOString())
          .first<StoredRow>();
        if (!result) throw new Error("Insert did not return a record");
        return mapRow(result);
      } catch (error) {
        // A cross-isolate duplicate is enforced by the partial unique index.
        if (await this.findActiveByHash(row.magnetHash)) {
          throw new ApiProblem(409, "duplicate_magnet", "That download is already active.");
        }
        throw error;
      }
    });
  }

  async update(row: DownloadRow, expectedCleanupClaim: string | null = row.cleanupClaimedAt): Promise<DownloadRow> {
    // Lifecycle identity/dates are immutable. A progress poll must never overwrite a
    // cleanup claim or resurrect a deleted row. Only the holder of the claim updates it.
    const result = await this.query(() => this.db.prepare(`UPDATE downloads
      SET display_name=?1, size_bytes=?2, status=?3, progress=?4, deleted_at=?5,
          error_message=?6, cleanup_claimed_at=?7, playable=?8, updated_at=?9, seedr_item_id=?12,
          kind=?13, file_count=?14
      WHERE id=?10 AND deleted_at IS NULL
        AND cleanup_claimed_at IS ?11
      RETURNING ${columns}`).bind(row.displayName, row.sizeBytes, row.status, row.progress,
      row.deletedAt, row.errorMessage, row.cleanupClaimedAt, Number(row.playable), new Date().toISOString(),
      row.id, expectedCleanupClaim, row.seedrItemId, row.kind ?? null, row.fileCount ?? null).first<StoredRow>());
    if (result) return mapRow(result);
    const current = await this.findByPublicId(row.publicId);
    if (current) return current;
    throw new ApiProblem(404, "not_found", "This download does not exist.");
  }

  async claimForCleanup(publicId: string, now: string, ownerSessionHash?: string): Promise<DownloadRow | null> {
    // One conditional statement, not SELECT then UPDATE: atomic across all Workers.
    const row = await this.query(() => this.db.prepare(`UPDATE downloads
      SET status='deleting', cleanup_claimed_at=?1, updated_at=?1
      WHERE public_id=?2 AND deleted_at IS NULL
        AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at<=?3)
        AND ((?4 IS NULL AND expires_at<=?1) OR (?4 IS NOT NULL AND owner_session_hash=?4))
      RETURNING ${columns}`).bind(now, publicId, new Date(Date.parse(now)-300000).toISOString(), ownerSessionHash ?? null).first<StoredRow>());
    return row ? mapRow(row) : null;
  }

  async listExpired(now: string): Promise<DownloadRow[]> {
    const result = await this.query(() => this.db.prepare(`SELECT ${columns} FROM downloads
      WHERE deleted_at IS NULL AND expires_at<=?1 AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at<=?2)
      ORDER BY expires_at LIMIT 8`).bind(now,new Date(Date.parse(now)-300000).toISOString()).all<StoredRow>());
    return result.results.map(mapRow);
  }
}
