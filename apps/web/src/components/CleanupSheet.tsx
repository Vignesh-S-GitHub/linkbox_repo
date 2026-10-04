import { X, Trash2 } from "lucide-react";
import type { PublicDownload } from "@temporary-share/shared";
import { formatBytes, age } from "../lib/format";
export function CleanupSheet({ file, onClose, onConfirm, busy }: { file: PublicDownload | null; onClose: () => void; onConfirm: () => void; busy: boolean }) {
 if (!file) return null; return <div className="overlay" role="presentation"><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="cleanup-title"><button className="close" onClick={onClose} aria-label="Close"><X/></button><div className="sheet-icon"><Trash2 size={22}/></div><p className="eyebrow">Cleanup eligible</p><h2 id="cleanup-title">Free {formatBytes(file.sizeBytes)}?</h2><p className="muted">{file.displayName} was added {age(file.createdAt)}. It will no longer be available to anyone.</p><div className="sheet-actions"><button className="secondary button" onClick={onClose}>Keep it</button><button className="danger button" onClick={onConfirm} disabled={busy}>{busy ? "Freeing…" : `Free ${formatBytes(file.sizeBytes)}`}</button></div></section></div>;
}
