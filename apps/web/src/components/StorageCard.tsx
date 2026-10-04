import { RefreshCw } from "lucide-react";
import type { StorageSummary } from "@temporary-share/shared";
import { formatBytes } from "../lib/format";
import { BrandIcon } from "./BrandIcon";
export function StorageCard({ storage, onRefresh }: { storage: StorageSummary | null; onRefresh: () => void }) {
  const ratio = storage ? Math.min(100, (storage.usedBytes / storage.capacityBytes) * 100) : 0;
  return <section className="storage-card"><div className="row"><BrandIcon name="storage" size={37}/><div><h2>{storage ? formatBytes(storage.usedBytes) : "Loading…"}</h2><p className="storage-total">{storage ? <>/ {formatBytes(storage.capacityBytes)}<span> used</span></> : "Checking storage"}</p></div><button className="icon-button" onClick={onRefresh} aria-label="Refresh storage"><RefreshCw size={17}/></button></div><div className="meter" aria-label={`${Math.round(ratio)} percent used`}><span style={{width:`${ratio}%`}}/></div><p className="availability">{storage ? <><strong>{formatBytes(storage.availableBytes)}</strong><span>Available</span></> : "Checking current capacity…"}</p></section>;
}
