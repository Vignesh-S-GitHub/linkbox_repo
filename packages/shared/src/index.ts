export type DownloadStatus = "queued" | "fetching_metadata" | "downloading" | "processing" | "ready" | "failed" | "expired" | "deleted" | "deleting";

export interface PublicDownload {
  id: string;
  displayName: string;
  sizeBytes: number;
  status: DownloadStatus;
  progress: number;
  createdAt: string;
  expiresAt: string;
  deletedAt: string | null;
  errorMessage?: string;
  playable: boolean;
  /** Provider-confirmed type; absent while metadata is pending or on older APIs. */
  kind?: FileKind | null;
  fileCount?: number | null;
  /** Request-specific permission; never an owner ID or session capability. */
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
export interface ApiError { error: string; code: string; details?: { requestedBytes?: number; availableBytes?: number }; }
