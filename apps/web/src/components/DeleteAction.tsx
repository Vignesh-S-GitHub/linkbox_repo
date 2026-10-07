import { useEffect, useState } from "react";
import { LockKeyhole, Trash2 } from "lucide-react";
import type { PublicDownload } from "@temporary-share/shared";
import { relativeTime } from "../lib/format";

/** UI guidance only. The Worker and atomic database claim enforce protection. */
export function DeleteAction({ file, onDelete, fullWidth=false }: { file: PublicDownload; onDelete:()=>void; fullWidth?:boolean }) {
  const [now,setNow]=useState(Date.now);
  const unlock=file.cleanupAllowedAt ? Date.parse(file.cleanupAllowedAt) : Date.parse(file.createdAt)+10800000;
  useEffect(()=>{
    if(file.canDelete===true||!Number.isFinite(unlock)||now>=unlock)return;
    const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(0,Math.min(unlock-Date.now(),30000)));
    return()=>window.clearTimeout(timer);
  },[unlock,now,file.canDelete]);
  if(file.deletedAt)return null;
  if(file.canDelete!==true&&!Number.isFinite(unlock))return <p className="sheet-note">Deletion is unavailable until the protection time can be confirmed.</p>;
  if(file.canDelete!==true&&now<unlock)return <p className="sheet-note"><LockKeyhole size={16} style={{display:"inline-block",verticalAlign:"text-bottom"}} aria-hidden="true"/> Protected · Delete available in {relativeTime(new Date(unlock).toISOString(),now)}</p>;
  return <button className={`unavailable-action${fullWidth ? " full-width" : ""}`} disabled={file.status==="deleting"} onClick={onDelete}><Trash2 size={19}/>Delete</button>;
}
