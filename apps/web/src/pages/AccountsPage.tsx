import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminAccountList, ApiError } from "@temporary-share/shared";
import { BrandIcon } from "../components/BrandIcon";
import { api } from "../lib/api";
import { formatBytes } from "../lib/format";

/** Owner credentials exist only in this mounted component, never browser storage. */
export function AccountsPage({onChanged}:{onChanged:()=>void}) {
  const [key,setKey]=useState(""),[draft,setDraft]=useState("");
  const [data,setData]=useState<AdminAccountList|null>(null),[busy,setBusy]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const [label,setLabel]=useState(""),[reference,setReference]=useState(""),[distinct,setDistinct]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const lock=useCallback(()=>{
    controller.current?.abort();setKey("");setDraft("");setData(null);setBusy(false);setError("");setNotice("");
    setLabel("");setReference("");setDistinct(false);
  },[]);
  useEffect(()=>()=>{controller.current?.abort();},[]);
  useEffect(()=>{
    if (!key) return;
    let timer:number;
    const reset=()=>{window.clearTimeout(timer);timer=window.setTimeout(lock,10*60*1000);};
    const hidden=()=>{if(document.visibilityState==="hidden")lock();};
    reset();window.addEventListener("pointerdown",reset);window.addEventListener("keydown",reset);document.addEventListener("visibilitychange",hidden);
    return ()=>{window.clearTimeout(timer);window.removeEventListener("pointerdown",reset);window.removeEventListener("keydown",reset);document.removeEventListener("visibilitychange",hidden);};
  },[key,lock]);
  async function run(operation:(signal:AbortSignal)=>Promise<AdminAccountList>,success?:()=>void) {
    if (busy) return;
    const current=new AbortController();controller.current=current;setBusy(true);setError("");setNotice("");
    try {const result=await operation(current.signal);if(!current.signal.aborted){setData(result);success?.();}}
    catch(cause){if(!current.signal.aborted){const problem=cause as ApiError;if(problem.code==="admin_unauthorized")lock();setError(problem.error??"Unable to connect. Please retry.");}}
    finally {if(!current.signal.aborted)setBusy(false);}
  }
  return <div className="accounts-page">
    {!key ? <section className="card admin-unlock">
      <BrandIcon name="settings" size={32}/><h2>Private account management</h2>
      <p>Only the site owner can connect Seedr accounts. Shared files remain available without signing in.</p>
      <form onSubmit={event=>{event.preventDefault();if(/^[A-Za-z0-9._~-]{32,128}$/.test(draft))void run(signal=>api.adminAccounts(draft,signal),()=>{setKey(draft);setDraft("");});else setError("Use the 32–128 character admin key configured privately in your terminal.");}}>
        <label>Admin access key<input type="password" value={draft} onChange={event=>setDraft(event.target.value)} autoComplete="off" spellCheck={false} minLength={32} maxLength={128} required/></label>
        <button className="primary full-width" disabled={busy}>{busy?"Unlocking…":"Unlock accounts"}</button>
      </form>
      <details><summary>First-time owner setup</summary><p>Run <code>npm run admin:setup:production</code> in your local LinkBox terminal. Choose a long, unique key in the hidden prompt. Do not share it in chat. For local testing, use <code>npm run admin:setup</code>.</p></details>
    </section> : <>
      <div className="account-heading"><div><h2>Connected accounts</h2><p>Private · owner access only</p></div><button className="secondary" onClick={lock}>Lock</button></div>
      {data?.mock&&<p className="account-hint">Mock mode: storage and account verification are simulated. No Seedr requests are made.</p>}
      <div className="account-list">{data?.accounts.map(account=><section className="card account-card" key={account.id}>
        <div className="account-heading"><BrandIcon name="storage" size={28}/><div><h2>{account.label}</h2><p>{account.enabled?"Accepting new downloads":"New downloads disabled"}</p></div></div>
        <p className="account-quota"><strong>{account.usedBytes===null?"—":formatBytes(account.usedBytes)}</strong> / {formatBytes(account.capacityBytes)} used</p>
        <span className="meter"><span style={{width:`${Math.min(100,(account.usedBytes??0)/account.capacityBytes*100)}%`}}/></span>
        <p>{account.availableBytes===null?(account.enabled?"Refresh to check available storage":"Storage excluded while disabled"):`${formatBytes(account.availableBytes)} available${account.enabled?"":" · last known quota"}`}{!account.secretConfigured&&" · Worker secret missing"}</p>
        <label className="account-toggle"><input type="checkbox" checked={account.enabled} disabled={busy||!account.secretConfigured||!!(account.enabled&&data.accounts.filter(value=>value.enabled).length===1)} onChange={event=>void run(signal=>api.adminEnable(key,account.id,event.target.checked,signal),()=>{setNotice("Account updated. Existing files keep working.");onChanged();})}/>Accept new downloads</label>
        {account.enabled&&data.accounts.filter(value=>value.enabled).length===1&&<p>At least one account must stay enabled.</p>}
      </section>)}</div>
      <button className="secondary full-width" disabled={busy} onClick={()=>void run(signal=>api.adminRefresh(key,signal),()=>{setNotice("Account storage refreshed.");onChanged();})}>{busy?"Working…":"Refresh account storage"}</button>
      <section className="card account-add"><h2>Add a Seedr account</h2><p>Save its token privately in Worker Secrets first. Enter only the secret name here, never the token.</p>
        <details><summary>How to save the token</summary><p>From <code>apps/worker</code>, run:</p><code className="account-command">npx wrangler secret put SEEDR_ACCOUNT_B_TOKEN --env production</code><p>Paste the token only into Wrangler’s private prompt. Use a new secret name for each account. For local testing add that secret to ignored <code>apps/worker/.dev.vars</code> and restart the Worker.</p></details>
        <form onSubmit={event=>{event.preventDefault();void run(signal=>api.adminAdd(key,{label,secretKeyReference:reference,distinctAccount:distinct},signal),()=>{setLabel("");setReference("");setDistinct(false);setNotice("Account connected using its verified storage capacity.");onChanged();});}}>
          <label>Account label<input value={label} onChange={event=>setLabel(event.target.value)} maxLength={128} required placeholder="My second account"/></label>
          <label>Worker secret name<input value={reference} onChange={event=>setReference(event.target.value)} pattern="SEEDR_[A-Z0-9_]+_TOKEN" maxLength={128} required placeholder="SEEDR_ACCOUNT_B_TOKEN" autoComplete="off" spellCheck={false}/></label>
          <label className="account-toggle"><input type="checkbox" checked={distinct} onChange={event=>setDistinct(event.target.checked)} required/>This is a different Seedr account, not another token for an account already connected.</label>
          <button className="primary full-width" disabled={busy||!!(data&&data.accounts.length>=data.limit)}>{busy?"Working…":"Verify & connect account"}</button>
        </form>
        <p className="account-hint">Up to {data?.limit??8} accounts. Each download stays on one account. Disabling affects new downloads only; keep its Worker secret for playback, deletion and automatic 24-hour expiry.</p>
      </section>
    </>}
    {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p className="account-hint" role="status">{notice}</p>}
  </div>;
}
