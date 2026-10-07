import type { ApiError } from "@temporary-share/shared";
import { BrandIcon } from "../components/BrandIcon";
import { formatBytes } from "../lib/format";

export function StorageFullPage({ error, onFiles, onCancel }: { error: ApiError; onFiles: () => void; onCancel: () => void }) {
  const requested = error.details?.requestedBytes;
  const available = error.details?.availableBytes ?? 0;
  return <section className="full-page"><div className="warning-circle">!</div><h1>Not enough space</h1><p className="full-message">{requested === undefined ? error.error : <>Your file needs {formatBytes(requested)} but only<br/>{formatBytes(available)} is available.</>}</p><div className="card requested-file"><BrandIcon name="folder" variant="file" size={40}/><div><strong>File to add</strong><small>{requested === undefined ? "Size pending Seedr metadata" : formatBytes(requested)}</small></div></div><p className="need-space">{requested === undefined ? `${formatBytes(available)} available · one file must fit in one account.` : `Need ${formatBytes(Math.max(0, requested - available))} more to continue.`}</p>
    <section className="clear-card"><h2><BrandIcon name="storage" size={16}/>Make room for your download</h2><p className="muted">Open Files and use “Delete” to remove downloads added in this browser anytime. For other users’ downloads, wait until their 3-hour protection ends.</p><p className="muted">Files expire automatically after 24 hours. Scheduled removal runs hourly. After space is available, add your link again.</p></section>
    <button className="primary full-width" onClick={onFiles}>Go to files</button><button className="secondary full-width" onClick={onCancel}>Cancel</button>
  </section>;
}
