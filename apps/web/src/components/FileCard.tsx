import { useState } from "react";
import { CheckCircle2, Film, ShieldCheck, Trash2, X } from "lucide-react";
import { BrandIcon } from "./BrandIcon";
import type { PublicDownload } from "@temporary-share/shared";
import { age, formatBytes, relativeTime } from "../lib/format";
import { api } from "../lib/api";
const labels: Record<PublicDownload["status"], string> = { queued: "Queued", fetching_metadata: "Fetching metadata", downloading: "Downloading", processing: "Processing", ready: "Ready", failed: "Failed", expired: "Expired", deleted: "Deleted", deleting: "Deleting" };
export function FileCard({ file, onCleanup, onPlay, cleaning }: { file: PublicDownload; onCleanup: (file: PublicDownload) => void; onPlay: (file: PublicDownload) => void; cleaning: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const protectedFile = Date.parse(file.cleanupAllowedAt) > Date.now();
  const video = /\.(mp4|mkv|webm|mov)$/i.test(file.displayName);
  const archive = /\.(zip|rar|7z|tar)$/i.test(file.displayName);
  const busy = ["downloading", "fetching_metadata", "processing"].includes(file.status);
  return <article className="file-card">
    <div className={`file-type ${video ? "video-type" : archive ? "archive-type" : "document-type"}`}>{video ? <Film size={25}/> : <BrandIcon name={archive ? "folder" : "file"} size={28}/>}</div>
    <div className="file-content"><h3 title={file.displayName}>{file.displayName}</h3>
      {busy && <div className="progress"><span style={{ width: `${file.progress}%` }}/></div>}
      <p className={`file-subtitle ${file.status === "ready" ? "ready-note" : ""}`}>{file.status === "ready" && <CheckCircle2 size={13}/>}<span>{formatBytes(file.sizeBytes)} · {labels[file.status]}{busy ? ` · ${file.progress}%` : ""}</span></p>
      <p className="expiry">{protectedFile ? "Protected" : "Cleanup eligible"} · Expires in {relativeTime(file.expiresAt)}</p>
    </div>
    <div className="row-actions">{file.status === "ready" && file.playable && <button className="file-action" onClick={() => onPlay(file)} aria-label={`Play ${file.displayName}`}><BrandIcon name="play" size={17}/></button>}{file.status === "ready" && <a className="file-action" href={api.download(file.id)} aria-label={`Download ${file.displayName}`}><BrandIcon name="download" size={17}/></a>}<button className="more-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={`Details for ${file.displayName}`}><BrandIcon name="more" size={19}/></button></div>
    {expanded && <div className="overlay"><section className="sheet file-menu" role="dialog" aria-modal="true" aria-label={`Actions for ${file.displayName}`}><button className="close" onClick={() => setExpanded(false)} aria-label="Close file actions"><X/></button><h2>{file.displayName}</h2><p className="muted">{formatBytes(file.sizeBytes)} · {labels[file.status]}</p>{file.status === "ready" && file.playable && <button className="menu-action" onClick={() => { setExpanded(false); onPlay(file); }}><BrandIcon name="play"/>Play / Preview</button>}{file.status === "ready" && <a className="menu-action" href={api.download(file.id)}><BrandIcon name="download"/>Download</a>}<div className="menu-details"><BrandIcon name="info"/><div><p>File details</p><small>Added {age(file.createdAt)} · Expires in {relativeTime(file.expiresAt)}</small></div></div><p className="menu-protection"><ShieldCheck size={15}/>{protectedFile ? `Protected · Cleanup in ${relativeTime(file.cleanupAllowedAt)}` : "Cleanup eligible"}</p>{!protectedFile && file.status !== "deleting" && <button className="menu-action danger-action" onClick={() => { setExpanded(false); onCleanup(file); }} disabled={cleaning}><Trash2 size={19}/>Free {formatBytes(file.sizeBytes)}</button>}</section></div>}
  </article>;
}
