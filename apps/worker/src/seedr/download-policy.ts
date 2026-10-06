import type { DownloadRow, SeedrItem } from "../types";

export const MISSING_TASK_GRACE_MS = 5 * 60 * 1000;
export const METADATA_TIMEOUT_MS = 15 * 60 * 1000;

export const missingTaskMessage = "Seedr did not confirm a download task. It may have rejected the magnet because of storage limits or file availability. Delete this item before trying again.";
export const metadataTimeoutMessage = "File information could not be obtained within 15 minutes. Seedr may be unavailable or the torrent may have too few peers. Delete this item before trying again.";
export const rejectionMessage = "Seedr could not accept this download. Check the file, available storage and account limits. Delete this item before trying again.";

/** Only unknown, zero-progress admission is bounded. Slow real transfers are not timed out. */
export function metadataTimedOut(row: DownloadRow, now = Date.now()): boolean {
  return ["queued", "fetching_metadata"].includes(row.status) && row.sizeBytes === 0 && row.progress === 0 &&
    now - Date.parse(row.createdAt) >= METADATA_TIMEOUT_MS;
}

export function itemFailure(row: DownloadRow, item: SeedrItem, maximumBytes: number, capacityBytes: number, now = Date.now()): { message: string; remove: boolean } | null {
  if (item.sizeBytes > maximumBytes) return { message: "This file exceeds the supported file size limit. Downloads cannot be split across storage accounts.", remove: true };
  if (item.sizeBytes > capacityBytes) return { message: "This file is too large to fit in its storage account. Downloads cannot be split across storage accounts.", remove: true };
  if (item.status === "failed") return { message: "Seedr reported that this download failed or was removed. Check file availability and storage limits.", remove: false };
  if (item.taskMissing && now - Date.parse(row.createdAt) >= MISSING_TASK_GRACE_MS) return { message: missingTaskMessage, remove: false };
  if (item.sizeBytes === 0 && item.progress === 0 && item.status === "fetching_metadata" && metadataTimedOut(row, now)) {
    return { message: metadataTimeoutMessage, remove: false };
  }
  return null;
}
