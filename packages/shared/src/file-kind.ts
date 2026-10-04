import type { FileKind } from "./index";

export function fileKind(name: string): FileKind {
  const extension = name.split(".").pop()?.toLowerCase();
  if (!name.includes(".")) return "folder";
  if (["mp4", "webm", "mkv", "mov"].includes(extension ?? "")) return "video";
  if (["mp3", "wav", "ogg", "m4a"].includes(extension ?? "")) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension ?? "")) return "image";
  if (extension === "pdf") return "pdf";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension ?? "")) return "archive";
  if (["txt", "md", "csv"].includes(extension ?? "")) return "text";
  if (["xls", "xlsx"].includes(extension ?? "")) return "sheet";
  if (["ppt", "pptx"].includes(extension ?? "")) return "presentation";
  return "other";
}
