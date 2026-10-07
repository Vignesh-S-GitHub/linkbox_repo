export type DownloadStatus = "queued" | "fetching_metadata" | "downloading" | "processing" | "ready" | "failed" | "expired" | "deleted" | "deleting";

export interface PublicDownload {
  id: string;
  displayName: string;
  sizeBytes: number;
  status: DownloadStatus;
  progress: number;
  createdAt: string;
  /** Three-hour protection deadline, enforced by the Worker and database. */
  cleanupAllowedAt?: string;
  expiresAt: string;
  deletedAt: string | null;
  errorMessage?: string;
  playable: boolean;
  /** Provider-confirmed type; absent while metadata is pending or on older APIs. */
  kind?: FileKind | null;
  fileCount?: number | null;
  /** Server-confirmed permission: creator anytime, other browsers after 3 hours. */
  canDelete?: boolean;
}

export type FileKind = "folder" | "video" | "audio" | "image" | "pdf" | "archive" | "text" | "subtitle" | "sheet" | "presentation" | "other";
export interface FileEntry {
  id: string;
  displayName: string;
  sizeBytes: number;
  kind: FileKind;
  playable: boolean;
  preview: "guide" | null;
}
export interface FileContents { kind: FileKind; entries: FileEntry[]; preview: "guide" | null; }

export interface StorageSummary { usedBytes: number; availableBytes: number; capacityBytes: number; refreshedAt: string; }
/** Only returned after server-side admin authentication, never on public storage routes. */
export interface AdminAccount {
  id: string; label: string; enabled: boolean; capacityBytes: number;
  usedBytes: number | null; availableBytes: number | null; lastSyncedAt: string | null;
  secretConfigured: boolean;
}
export interface AdminAccountList { accounts: AdminAccount[]; mock: boolean; limit: number; }
export interface ApiError { error: string; code: string; details?: { requestedBytes?: number; availableBytes?: number }; }
