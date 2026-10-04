import type { FileKind, PublicDownload } from "./index";

export function downloadKind(file: Pick<PublicDownload, "kind" | "displayName">): FileKind {
  return file.kind ?? fileKind(file.displayName);
}

export function formatProgress(progress: number): string {
  if (!Number.isFinite(progress)) return "0%";
  const clamped = Math.max(0, Math.min(100, progress));
  if (clamped > 0 && clamped < 0.01) return "<0.01%";
  // Never display 100% before the provider actually reaches completion.
  return `${clamped > 99.99 && clamped < 100 ? "99.99" : clamped.toFixed(2).replace(/\.?0+$/, "") || "0"}%`;
}

export function fileKind(name: string): FileKind {
  const extension = name.split(".").pop()?.toLowerCase();
  if (!name.includes(".")) return "folder";
  if (["mp4", "webm", "mkv", "mov"].includes(extension ?? "")) return "video";
  if (["mp3", "wav", "ogg", "m4a"].includes(extension ?? "")) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension ?? "")) return "image";
  if (extension === "pdf") return "pdf";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension ?? "")) return "archive";
  if (["txt", "md", "csv"].includes(extension ?? "")) return "text";
  if (["srt", "vtt"].includes(extension ?? "")) return "subtitle";
  if (["xls", "xlsx"].includes(extension ?? "")) return "sheet";
  if (["ppt", "pptx"].includes(extension ?? "")) return "presentation";
  return "other";
}
