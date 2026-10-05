import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { BrandIcon } from "./BrandIcon";
import type { ApiError, PublicDownload } from "@temporary-share/shared";
import { api } from "../lib/api";
export function MagnetForm({ onCreated, onStorageFull }: { onCreated: (download: PublicDownload) => void; onStorageFull: (error: ApiError) => void }) {
  const [magnet, setMagnet] = useState(""); const [error, setError] = useState(""); const [adding, setAdding] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!magnet.trim().startsWith("magnet:?")) { setError("Paste a complete magnet link starting with magnet:?"); return; }
    setAdding(true);
    try { const item = await api.create(magnet.trim()); setMagnet(""); onCreated(item); }
    catch (cause) { const problem = cause as ApiError; if (problem.code === "storage_full") onStorageFull(problem); else setError(problem.error ?? "We couldn’t add that download right now."); }
    finally { setAdding(false); }
  }
  return <section className="add-card"><form onSubmit={submit}><label className="sr-only" htmlFor="magnet">Magnet link</label><div className="input-row"><BrandIcon name="link" size={21}/><input id="magnet" value={magnet} onChange={e => setMagnet(e.target.value)} placeholder="Paste magnet link…" inputMode="url" maxLength={8192}/><button className="primary" disabled={adding} aria-label="Add download">{adding ? <LoaderCircle className="spin" size={20}/> : <BrandIcon name="add" size={23}/>}</button></div>{error && <p className="inline-error" role="alert">{error}</p>}</form></section>;
}
