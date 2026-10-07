import { useEffect, useState } from "react";
import type { FileEntry, PublicDownload } from "@temporary-share/shared";
import { downloadKind } from "../../../../packages/shared/src/file-kind";
import { api } from "../lib/api";
import { canCopyDownloadLink } from "../lib/download-link";
import { externalPlayerIntent, isExternalMedia, supportsPlayerIntent } from "../lib/external-player";
import { BrandIcon } from "./BrandIcon";

export function ExternalPlayerAction({ file, entry, onCopy }: { file: PublicDownload; entry?: FileEntry; onCopy: () => Promise<void> }) {
  const kind = entry?.kind ?? downloadKind(file);
  const media = isExternalMedia(kind);
  const ready = media && canCopyDownloadLink(file, entry);
  const android = supportsPlayerIntent(navigator.userAgent);
  const [intent, setIntent] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!android || !ready || !isExternalMedia(kind)) return;
    const controller = new AbortController();
    // One metadata request per opened media menu; no media fetch, polling or storage.
    api.delivery(file.id, "download", entry?.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setIntent(externalPlayerIntent(result.url, kind, window.location.href));
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("Could not prepare the player. Use Copy download link, or close and reopen this menu to retry.");
    });
    return () => controller.abort();
  }, [android, ready, kind, file.id, entry?.id]);

  const open = async () => {
    if (!canCopyDownloadLink(file, entry)) { setMessage("This file is no longer available."); return; }
    if (android && intent) {
      setMessage("If no player opens, use Copy download link and paste it into your player's network-stream option.");
      // Synchronous navigation inside the click, not after awaiting an API call.
      try { window.location.assign(intent); }
      catch { setMessage("Your browser could not open a player. Use Copy download link instead."); }
      return;
    }
    if (copying) return;
    setCopying(true);
    try { await onCopy(); }
    catch { setMessage("Could not copy the link. Use Copy download link or try again."); }
    finally { setCopying(false); }
  };

  if (!media) return null;
  return <>
    <button disabled={!ready || copying || (android && !intent)} onClick={() => void open()}
      title={android ? "Open the original file in a compatible installed player" : "Copy the original link to paste into your external player's network-stream option"}>
      <BrandIcon name="play"/>{copying ? "Copying link…" : android && ready && !intent && !message ? "Preparing external player…" : "Open in external player"}
    </button>
    {message && <p className="sheet-note" role="status">{message}</p>}
  </>;
}
