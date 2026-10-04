import { Trash2 } from "lucide-react";
import type { FileEntry, PublicDownload } from "@temporary-share/shared";
import { Sheet } from "./Sheet";
import { BrandIcon } from "./BrandIcon";
import { formatBytes, relativeTime, age } from "../lib/format";
import { useState } from "react";

export function ActionsSheet({ file, entry, onClose, onOpen, onDownload, onShare, onCopy, onUnavailable, onDelete }: { file: PublicDownload; entry?: FileEntry; onClose: () => void; onOpen: () => void; onDownload: () => void; onShare: () => void; onCopy: () => void; onUnavailable: () => void; onDelete:()=>void }) {
  const [details, setDetails] = useState(false);
  const ready = file.status === "ready";
  const protectedFile = new Date(file.cleanupAllowedAt).getTime() > Date.now();
  return <Sheet title={`Actions for ${entry?.displayName ?? file.displayName}`} onClose={onClose}>
    <h2 className="sheet-file-name">{entry?.displayName ?? file.displayName}</h2><div className="action-menu">
      <button disabled={!ready} onClick={onOpen}><BrandIcon name="play"/>Play / Preview</button>
      <button disabled={!ready} onClick={onDownload}><BrandIcon name="download"/>Download</button>
      <button onClick={onCopy}><BrandIcon name="link"/>Copy link</button><button onClick={onShare}><BrandIcon name="share"/>Share</button>
      <button onClick={() => setDetails(!details)} aria-expanded={details}><BrandIcon name="info"/>File details</button>
    </div>{details && <dl className="file-details"><div><dt>Size</dt><dd>{formatBytes(entry?.sizeBytes ?? file.sizeBytes)}</dd></div><div><dt>Added</dt><dd>{age(file.createdAt)}</dd></div><div><dt>Expires in</dt><dd>{relativeTime(file.expiresAt)}</dd></div><div><dt>{protectedFile ? "Protected" : "Cleanup eligible"}</dt><dd>{protectedFile ? `Available for cleanup in ${relativeTime(file.cleanupAllowedAt)}` : "Can be cleared when space is needed"}</dd></div></dl>}
    {!entry&&file.canDelete&&<button className="unavailable-action" disabled={file.status==="deleting"} onClick={onDelete}><Trash2 size={19}/>Delete my download</button>}
    <button className="unavailable-action" onClick={onUnavailable}><Trash2 size={19}/>Not available</button>
    <p className="sheet-note">Space cleanup is offered when a new download needs room.</p>
  </Sheet>;
}
