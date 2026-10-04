import type { FileKind, PublicDownload } from "@temporary-share/shared";

export const statusLabels: Record<PublicDownload["status"], string> = {
  queued: "Queued", fetching_metadata: "Fetching metadata", downloading: "Downloading", processing: "Processing",
  ready: "Ready", failed: "Failed", expired: "Expired", deleted: "Deleted", deleting: "Deleting",
};
export const kindLabels: Record<FileKind, string> = { folder: "Folder", video: "Video", audio: "Audio", image: "Image", pdf: "PDF", archive: "Archive", text: "Text", subtitle: "Subtitles", sheet: "Spreadsheet", presentation: "Presentation", other: "File" };
