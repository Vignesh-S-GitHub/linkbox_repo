import type { PublicDownload } from "@temporary-share/shared";

export function isTransferring(status: PublicDownload["status"]): boolean {
  return ["queued", "fetching_metadata", "downloading", "processing"].includes(status);
}

export function isSizePending(file: PublicDownload): boolean {
  return file.sizeBytes === 0 && file.status !== "ready";
}
