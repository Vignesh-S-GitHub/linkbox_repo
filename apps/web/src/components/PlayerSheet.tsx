import { X } from "lucide-react";
import type { PublicDownload } from "@temporary-share/shared";
import { api } from "../lib/api";
export function PlayerSheet({ file, onClose }: { file: PublicDownload | null; onClose: () => void }) { if (!file) return null; return <div className="overlay"><section className="sheet" role="dialog" aria-modal="true" aria-label={`Play ${file.displayName}`}><button className="close" onClick={onClose} aria-label="Close player"><X/></button><video style={{display:"block",width:"100%",maxHeight:"70vh",background:"#111",borderRadius:"11px"}} controls autoPlay playsInline src={api.play(file.id)}>Your browser can’t play this file.</video><p style={{fontWeight:700,fontSize:"13px",paddingTop:"10px"}}>{file.displayName}</p></section></div>; }
