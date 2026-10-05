import type { FileEntry, PublicDownload } from "@temporary-share/shared";
import { downloadKind } from "../../../../packages/shared/src/file-kind";

export function canCopyDownloadLink(file: PublicDownload, entry?: FileEntry, now = Date.now()): boolean {
  return file.status === "ready" && !file.deletedAt && Date.parse(file.expiresAt) > now
    && (entry?.kind ?? downloadKind(file)) !== "folder";
}

type ClipboardPort = Pick<Clipboard, "writeText"> & Partial<Pick<Clipboard, "write">>;

// Start clipboard.write during the click gesture: Safari can reject writes started
// only after the asynchronous delivery request. URLs stay in memory, never storage.
export async function copyDownloadLink(
  loadUrl: () => Promise<string>,
  clipboard: ClipboardPort | undefined = navigator.clipboard,
  itemType: typeof ClipboardItem | undefined = globalThis.ClipboardItem,
): Promise<void> {
  if (!clipboard) throw new Error("Clipboard unavailable");
  if (clipboard.write && itemType) {
    const text = loadUrl().then(url => new Blob([url], { type: "text/plain" }));
    try {
      await clipboard.write([new itemType({ "text/plain": text })]);
    } catch (cause) {
      // Also observe the delivery rejection if clipboard permission failed first.
      await text.catch(() => undefined);
      throw cause;
    }
  } else {
    await clipboard.writeText(await loadUrl());
  }
}
