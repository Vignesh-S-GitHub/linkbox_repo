import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Search, X } from "lucide-react";
import type { FileContents, FileEntry, PublicDownload } from "@temporary-share/shared";
import { Brand } from "../components/Brand";
import { BrandIcon } from "../components/BrandIcon";
import { FileRow, FileTile } from "../components/FileRow";
import { kindLabels } from "../lib/file-labels";
import { downloadKind, formatProgress } from "../../../../packages/shared/src/file-kind";
import { formatBytes } from "../lib/format";
import { api } from "../lib/api";
import { StreamMedia } from "../components/StreamMedia";

export function UnavailablePage({ onFiles, message }: { onFiles: () => void; message?: string }) {
  return <section className="unavailable"><div className="missing-art"><FileTile kind="text"/><span><X size={20}/></span></div><h1>File unavailable</h1><p>{message ?? "This file is no longer available in LinkBox."}</p><button className="primary" onClick={onFiles}>Go to files</button></section>;
}
export function ProgressPage({ file, onClose, onDelete }: { file: PublicDownload; onClose: () => void; onDelete:()=>void }) {
  const steps = ["Added", "Fetching metadata", "Downloading", "Processing", "Ready"];
  const step = file.status === "ready" ? 4 : file.status === "processing" ? 3 : file.status === "downloading" ? 2 : 1;
  return <div className="progress-page"><section className="card"><div className="folder-heading"><FileTile kind={downloadKind(file)}/><div><strong>{file.displayName}</strong><small>{file.sizeBytes ? formatBytes(file.sizeBytes) : "Size pending metadata"}</small></div></div>
    <ol className="timeline">{steps.map((label, index) => <li key={label} className={index < step || file.status === "ready" ? "complete" : index === step ? "current" : "future"}>
      <span className="step-dot">{index < step || file.status === "ready" ? <BrandIcon name="check" size={15}/> : index === step ? <LoaderCircle size={23} className="spin"/> : null}</span>
      <strong>{label}</strong><small>{index === 0 ? new Date(file.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : index < step ? "Completed" : index === step ? (file.status === "failed" ? "Download failed" : `${formatProgress(file.progress)}${file.sizeBytes ? ` · ${formatBytes(file.sizeBytes * file.progress / 100)} / ${formatBytes(file.sizeBytes)}` : " · Waiting for file information"}`) : ""}</small>
      {index === step && file.status !== "failed" && <div className="meter"><span style={{ width: `${file.progress}%` }}/></div>}
    </li>)}</ol>
    {file.errorMessage && <p className="inline-error" role="alert">{file.errorMessage}</p>}
  </section><button className={file.status === "ready" ? "primary full-width" : "cancel full-width"} onClick={onClose}>{file.status === "ready" ? "Go to files" : "Back to files"}</button>{file.canDelete&&<button className="unavailable-action full-width" disabled={file.status==="deleting"} onClick={onDelete}>Delete my download</button>}{["queued", "fetching_metadata", "downloading", "processing"].includes(file.status) && <p className="progress-hint">Progress comes from Seedr and refreshes automatically. New torrents or few available peers can take longer. You can leave and return; the download keeps running.</p>}</div>;
}
export function FolderPage({ file, contents, onOpen, onMore, onDownload }: { file: PublicDownload; contents: FileContents; onOpen: (entry: FileEntry) => void; onMore: (entry: FileEntry) => void; onDownload: (entry: FileEntry) => void }) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const entries = contents.entries.filter(entry => entry.displayName.toLowerCase().includes(search.toLowerCase()));
  return <section className="folder-page"><div className="folder-heading"><FileTile kind="folder"/><div><strong>{file.displayName}</strong><small>{formatBytes(file.sizeBytes)} · {contents.entries.length} files</small></div><button className="icon-button" onClick={() => setSearching(!searching)} aria-label="Search folder"><Search size={19}/></button></div>
    {searching && <label className="search-field"><Search size={16}/><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search files" aria-label="Search files"/></label>}
    <div className="file-list">{entries.map(entry => <FileRow key={entry.id} file={file} entry={entry} onOpen={() => onOpen(entry)} onMore={() => onMore(entry)} onDownload={() => onDownload(entry)}/>)}</div>
    {!entries.length && <p className="empty-folder">{search ? "No matching files." : "No files are available in this folder."}</p>}
  </section>;
}
const guidePages = [
  ["Quick Start Guide", "Welcome to LinkBox", "Paste a magnet link on Home to start a temporary download. You can follow its progress from the Files screen."],
  ["Add a link", "Paste. Fetch. Access.", "Use a complete magnet URI for content you are authorized to access. LinkBox automatically selects storage for the whole download."],
  ["Follow progress", "From added to ready", "The steps are Added, Fetching metadata, Downloading, Processing and Ready. Progress refreshes while the app is visible."],
  ["Your files", "Everything in one place", "Use All, Downloading and Ready to filter files. Tap a row to open it and use the menu for more actions."],
  ["Folders", "Browse the contents", "Open a ready folder to view its entries. Search narrows the list by name."],
  ["Playback", "Press play", "Ready, supported media opens in the player. Playback support depends on the connected storage provider."],
  ["Downloads", "Keep what you need", "Download before the temporary storage period ends. LinkBox does not provide permanent backups."],
  ["Storage", "Your connected capacity", "The Storage page shows the connected capacity. One file must fit in a single account; capacity cannot be pooled for one download."],
  ["Protection", "The first three hours", "New items cannot be deleted by community cleanup during their first three hours."],
  ["Free space", "Cleanup when needed", "After three hours, items become eligible for cleanup. Confirm carefully: clearing a file removes access for everyone."],
  ["Expiration", "Temporary by design", "Files expire after 24 hours. Scheduled removal runs hourly. Download anything you need in time."],
  ["Important", "Use responsibly", "Only add files you are authorized to access. This guide is a synthetic mock preview, not a file retrieved from Seedr."],
];
export function PreviewPage({ file, entry, onDownload, onShare, onOpenExternal }: { file: PublicDownload; entry?: FileEntry; onDownload: () => void; onShare: () => void; onOpenExternal: () => void }) {
  const [page, setPage] = useState(0);
  const guide = guidePages[page];
  return <div className="preview-page"><div className="document-stage"><article className="guide-page"><div className="guide-brand"><Brand/></div><h1>{guide[0]}</h1><span className="guide-underline"/><h2>{guide[1]}</h2><p>{guide[2]}</p><div className="document-lines" aria-hidden="true"><i/><i/><i/><i/><i/></div><div className="paper-waves" aria-hidden="true"><span/><span/><span/></div></article>
    <div className="page-control"><button className="icon-button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={18}/></button><span>{page + 1} / {guidePages.length}</span><button className="icon-button" disabled={page === guidePages.length - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={18}/></button></div></div>
    <div className="preview-actions"><button onClick={onShare}><BrandIcon name="share"/>Share</button><button onClick={onDownload}><BrandIcon name="download"/>Download</button><button onClick={onOpenExternal}><BrandIcon name="file"/>Open in…</button></div><p className="sr-only">Mock preview of {entry?.displayName ?? file.displayName}.</p>
  </div>;
}
export function PlayerPage({ file, entry, onDownload }: { file: PublicDownload; entry?: FileEntry; onDownload: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.delivery(file.id, "play", entry?.id).then(result => { if (active) setUrl(result.url); }).catch(() => { if (active) setError("Playback is unavailable for this file. You can still try Download."); });
    return () => { active = false; };
  }, [file.id, entry?.id]);
  const name = entry?.displayName ?? file.displayName;
  return <section className="player-page">{url ? <StreamMedia key={`${file.id}:${entry?.id ?? ""}`} url={url} name={name} audio={(entry?.kind ?? downloadKind(file)) === "audio"} onError={() => setError("The media could not be played in this browser. You can still download it.")}/> : <div className="video-stage"><div className="player-loading">{error ? "Playback unavailable" : <><LoaderCircle className="spin"/>Loading playback…</>}</div></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="folder-heading"><FileTile kind={entry?.kind ?? downloadKind(file)}/><div><strong>{name}</strong><small>{formatBytes(entry?.sizeBytes ?? file.sizeBytes)} · {kindLabels[entry?.kind ?? downloadKind(file)]}</small></div></div><button className="primary full-width" onClick={onDownload}><BrandIcon name="download" size={18}/>Download</button>
  </section>;
}
export function FileLoading() { return <div className="file-list" aria-label="Loading files" role="status">{[1, 2, 3, 4].map(id => <div className="skeleton-row" key={id}><span/><div><i/><i/></div></div>)}<span className="sr-only">Loading files</span></div>; }

export function LivePreviewPage({ file, entry, onDownload }: { file: PublicDownload; entry?: FileEntry; onDownload:()=>void }) {
  const [url,setUrl]=useState(""); const [error,setError]=useState("");
  useEffect(()=>{let active=true;api.delivery(file.id,"download",entry?.id).then(value=>{if(active)setUrl(value.url);}).catch(()=>{if(active)setError("Preview unavailable. Try downloading this file.");});return()=>{active=false;};},[file.id,entry?.id]);
  const name=entry?.displayName??file.displayName,kind=entry?.kind??downloadKind(file);
  return <section className="preview-page"><div className="document-stage">{url ? kind==="image" ? <img src={url} alt={name} style={{maxWidth:"100%",maxHeight:"70vh",objectFit:"contain"}} onError={()=>setError("Preview unavailable. Try Download.")}/> : <object data={url} type="application/pdf" aria-label={name} style={{width:"100%",height:"65vh"}}><p>Open Download to view this PDF in your browser.</p></object> : <div className="player-loading">{error||"Loading preview…"}</div>}</div>{error&&<p className="inline-error" role="alert">{error}</p>}<button className="primary full-width" onClick={onDownload}><BrandIcon name="download"/>Download</button></section>;
}
