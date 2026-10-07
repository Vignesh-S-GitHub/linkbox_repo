import { DeleteAction } from "./DeleteAction";
import type { FileEntry, PublicDownload } from "@temporary-share/shared";
import { Sheet } from "./Sheet";
import { BrandIcon } from "./BrandIcon";
import { formatBytes, relativeTime, age } from "../lib/format";
import { useState } from "react";
import { canCopyDownloadLink } from "../lib/download-link";
import { downloadKind } from "../../../../packages/shared/src/file-kind";
import { ExternalPlayerAction } from "./ExternalPlayerAction";

export function ActionsSheet({ file, entry, onClose, onOpen, onDownload, onShare, onCopy, onDelete }: { file: PublicDownload; entry?: FileEntry; onClose: () => void; onOpen: () => void; onDownload: () => void; onShare: () => void; onCopy: () => Promise<void>; onDelete:()=>void }) {
  const [details, setDetails] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copy = async () => {
    if (copying) return;
    setCopying(true); setCopyError("");
    try { await onCopy(); }
    catch { setCopyError("Could not copy the download link. Check clipboard permissions and try again; the file may no longer be available."); }
    finally { setCopying(false); }
  };
  const ready = file.status === "ready";
  return <Sheet title={`Actions for ${entry?.displayName ?? file.displayName}`} onClose={onClose}>
    <h2 className="sheet-file-name">{entry?.displayName ?? file.displayName}</h2><div className="action-menu">
      <button disabled={!ready} onClick={onOpen}><BrandIcon name="play"/>Play / Preview</button>
      <ExternalPlayerAction file={file} entry={entry} onCopy={onCopy}/>
      <button disabled={!ready} onClick={onDownload}><BrandIcon name="download"/>Download</button>
      {(entry?.kind ?? downloadKind(file)) !== "folder" && <button disabled={copying || !canCopyDownloadLink(file, entry)} onClick={() => void copy()}><BrandIcon name="link"/>{copying ? "Getting link…" : "Copy download link"}</button>}<button onClick={onShare}><BrandIcon name="share"/>Share</button>
      <button onClick={() => setDetails(!details)} aria-expanded={details}><BrandIcon name="info"/>File details</button>
    </div>{details && <dl className="file-details"><div><dt>Size</dt><dd>{formatBytes(entry?.sizeBytes ?? file.sizeBytes)}</dd></div><div><dt>Added</dt><dd>{age(file.createdAt)}</dd></div><div><dt>Expires in</dt><dd>{relativeTime(file.expiresAt)}</dd></div></dl>}
    {copyError && <p className="inline-error" role="alert">{copyError}</p>}
    {!entry&&<DeleteAction file={file} onDelete={onDelete}/>}
    <p className="sheet-note">You can delete downloads added in this browser anytime. Other users must wait 3 hours. Files expire automatically after 24 hours.</p>
  </Sheet>;
}
