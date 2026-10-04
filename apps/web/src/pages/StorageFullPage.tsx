import { useState } from "react";
import type { ApiError } from "@temporary-share/shared";
import { BrandIcon } from "../components/BrandIcon";
import { formatBytes, age } from "../lib/format";

export function StorageFullPage({ error, busy, onContinue, onCancel }: { error: ApiError; busy: boolean; onContinue: (ids: string[]) => void; onCancel: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const requested = error.details?.requestedBytes ?? 0;
  const available = error.details?.availableBytes ?? 0;
  const eligible = error.details?.eligibleFiles ?? [];
  return <section className="full-page"><div className="warning-circle">!</div><h1>Not enough space</h1><p className="full-message">Your file needs {formatBytes(requested)} but only<br/>{formatBytes(available)} is available.</p><div className="card requested-file"><BrandIcon name="folder" variant="file" size={40}/><div><strong>File to add</strong><small>{formatBytes(requested)}</small></div></div><p className="need-space">Need {formatBytes(Math.max(0, requested - available))} more to continue.</p>
    <section className="clear-card"><h2><BrandIcon name="warning" size={16}/>Files that can be cleared</h2>{eligible.length ? eligible.map(file => <label className="cleanup-option" key={file.id}><BrandIcon name="file" size={32}/><span><strong>{file.displayName}</strong><small>{formatBytes(file.sizeBytes)} · Added {age(file.createdAt)}</small></span><input type="checkbox" disabled={busy} checked={selected.includes(file.id)} onChange={() => setSelected(ids => ids.includes(file.id) ? ids.filter(id => id !== file.id) : [...ids, file.id])}/></label>) : <p className="muted">No files are eligible yet. New files are protected for 3 hours.</p>}</section>
    {!!error.details?.protectedFiles?.length && <details className="protected-list"><summary>Protected files ({error.details.protectedFiles.length})</summary>{error.details.protectedFiles.map(file => <p key={file.id}>{file.displayName}<small>{formatBytes(file.sizeBytes)} · Protected</small></p>)}</details>}
    <p className="cleanup-warning">Clearing selected files removes them for everyone. Space must be available in one account; we’ll check again before adding.</p>
    <button className="primary full-width" disabled={busy || !selected.length} onClick={() => onContinue(selected)}>{busy ? "Freeing space…" : "Free space & continue"}</button><button className="secondary full-width" disabled={busy} onClick={onCancel}>Cancel</button>
  </section>;
}
