import type { PublicDownload } from "@temporary-share/shared";
import { Trash2 } from "lucide-react";
import { Sheet } from "./Sheet";

export function DeleteDownloadSheet({file,busy,error,onClose,onConfirm}:{file:PublicDownload;busy:boolean;error:string;onClose:()=>void;onConfirm:()=>void}){
 return <Sheet title="Delete this download?" onClose={()=>{if(!busy)onClose();}}>
  <h2>Delete this download?</h2><p className="sheet-file-name">{file.displayName}</p>
  <p className="sheet-note">This stops the download and permanently removes the whole download and all its files from Seedr. Shared links will stop working for everyone. This cannot be undone.</p>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <button className="primary full-width delete-confirm" disabled={busy} onClick={onConfirm}><Trash2 size={18}/>{busy?"Deleting…":"Delete"}</button>
  <button className="cancel full-width" disabled={busy} onClick={onClose}>Keep download</button>
 </Sheet>;
}
