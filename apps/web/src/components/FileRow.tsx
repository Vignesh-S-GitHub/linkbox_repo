import { FileText, Film, Music, Image, FileArchive, FileSpreadsheet, Presentation } from "lucide-react";
import type { FileEntry, FileKind, PublicDownload } from "@temporary-share/shared";
import { fileKind } from "../../../../packages/shared/src/file-kind";
import { formatBytes } from "../lib/format";
import { BrandIcon } from "./BrandIcon";

import { kindLabels, statusLabels } from "../lib/file-labels";
export function FileTile({ kind }: { kind: FileKind }) {
  const icons = { video: Film, audio: Music, image: Image, archive: FileArchive, sheet: FileSpreadsheet, presentation: Presentation, pdf: FileText, text: FileText, other: FileText };
  if (kind === "folder") return <span className="file-tile folder"><BrandIcon name="folder" variant="file" size={35}/></span>;
  const Icon = icons[kind];
  return <span className={`file-tile ${kind}`}><Icon size={25} strokeWidth={1.6}/>{["pdf", "archive", "sheet", "presentation"].includes(kind) && <small>{kind === "archive" ? "zip" : kind === "sheet" ? "xls" : kind === "presentation" ? "ppt" : kind}</small>}</span>;
}
export function FileRow({ file, entry, compact = false, onOpen, onMore, onDownload }: {
  file: PublicDownload; entry?: FileEntry; compact?: boolean; onOpen: () => void; onMore: () => void; onDownload: () => void;
}) {
  const name = entry?.displayName ?? file.displayName;
  const kind = entry?.kind ?? fileKind(name);
  const size = entry?.sizeBytes ?? file.sizeBytes;
  const ready = file.status === "ready";
  return <article className="file-row">
    <button className="file-open" onClick={onOpen} aria-label={`Open ${name}`}><FileTile kind={kind}/>
      <span className="file-meta"><strong title={name}>{name}</strong>
        {!ready && !entry ? <><span className="meter mini"><span style={{ width: `${file.progress}%` }}/></span><small>{statusLabels[file.status]}{["downloading", "fetching_metadata"].includes(file.status) ? ` · ${file.progress}%` : ""}</small></> : <small>{formatBytes(size)} · {compact ? <em>Ready</em> : kindLabels[kind]}</small>}
      </span>
    </button>
    {!ready && !compact && <span className="row-size">{formatBytes(size)}</span>}
    {ready && !compact && <div className="row-tools">
      {(entry?.playable ?? file.playable) && <button className="file-action" onClick={onOpen} aria-label={`Play ${name}`}><BrandIcon name="play" size={18}/></button>}
      {kind === "pdf" && <button className="file-action" onClick={onOpen} aria-label={`Preview ${name}`}><BrandIcon name="preview" size={18}/></button>}
      {kind !== "folder" && <button className="file-action" onClick={onDownload} aria-label={`Download ${name}`}><BrandIcon name="download" size={18}/></button>}
    </div>}
    <button className="icon-button more-button" onClick={onMore} aria-label={`Actions for ${name}`}><BrandIcon name="more" size={20}/></button>
  </article>;
}
