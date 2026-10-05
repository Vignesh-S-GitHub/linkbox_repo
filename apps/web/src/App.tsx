import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { ApiError, FileContents, FileEntry, PublicDownload } from "@temporary-share/shared";
import { downloadKind } from "../../../packages/shared/src/file-kind";
import { Brand } from "./components/Brand";
import { BrandIcon } from "./components/BrandIcon";
import { MagnetForm } from "./components/MagnetForm";
import { FileRow } from "./components/FileRow";
import { EmptyState } from "./components/EmptyState";
import { StorageCard } from "./components/StorageCard";
import { ActionsSheet } from "./components/ActionsSheet";
import { DeleteDownloadSheet } from "./components/DeleteDownloadSheet";
import { AboutPage, SettingsPage } from "./pages/InfoPages";
import { AccountsPage } from "./pages/AccountsPage";
import { FileLoading, FolderPage, PlayerPage, PreviewPage, ProgressPage, UnavailablePage, LivePreviewPage } from "./pages/FilePages";
import { StorageFullPage } from "./pages/StorageFullPage";
import { useDownloads } from "./hooks/useDownloads";
import { useNavigation } from "./hooks/useNavigation";
import { api } from "./lib/api";
import { formatBytes } from "./lib/format";
import { copyDownloadLink } from "./lib/download-link";
import { routeUrl, isFolderView, type Screen } from "./lib/routes";

type Selection = { file: PublicDownload; entry?: FileEntry };
const pageTitles: Partial<Record<Screen, string>> = { progress: "Add Link", storage: "Storage", "storage-full": "Storage full", settings: "Settings", accounts:"Accounts", about: "About LinkBox" };

function App() {
  const { downloads, storage, loading, error, refresh, setDownloads } = useDownloads();
  const { route, go } = useNavigation();
  const [filter, setFilter] = useState<"all" | "downloading" | "ready">("all");
  const [actions, setActions] = useState<Selection | null>(null);
  const [deleteTarget,setDeleteTarget]=useState<PublicDownload|null>(null);
  const [deleteBusy,setDeleteBusy]=useState(false),[deleteError,setDeleteError]=useState("");
  const [storageFull, setStorageFull] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState("");
  const [contents, setContents] = useState<FileContents | null>(null);
  const [contentsError, setContentsError] = useState("");
  const [contentsLoading, setContentsLoading] = useState(false);
  const current = downloads.find(file => file.id === route.id);
  const currentId = current?.id;
  const needsContents = !!current && current.status === "ready" && (route.screen === "folder" || route.screen === "preview" || !!route.entry);

  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem("linkbox-appearance") ?? "light";
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let active = true;
    setContents(null); setContentsError("");
    if (!needsContents || !currentId) { setContentsLoading(false); return; }
    setContentsLoading(true);
    api.contents(currentId).then(result => { if (active) setContents(result); }).catch((cause: ApiError) => {
      if (active) setContentsError(cause.error ?? "Unable to open this file right now.");
    }).finally(() => { if (active) setContentsLoading(false); });
    return () => { active = false; };
  }, [currentId, needsContents]);
  const entry = contents?.entries.find(item => item.id === route.entry);
  const activeFiles = downloads.filter(file => !["deleted", "expired"].includes(file.status) && new Date(file.expiresAt).getTime() > Date.now());
  const downloading = activeFiles.filter(file => ["queued", "fetching_metadata", "downloading", "processing"].includes(file.status));
  const ready = activeFiles.filter(file => file.status === "ready");
  const visible = filter === "all" ? activeFiles : filter === "ready" ? ready : downloading;
  const navigate = (screen: Screen, id?: string, entryId?: string, section?: string) => { setActions(null); go(screen, id, entryId, section); };
  const add = (file: PublicDownload) => { setDownloads(items => [file, ...items]); navigate("progress", file.id); void refresh(); };
  const requestDelete=(file:PublicDownload)=>{setActions(null);setDeleteError("");setDeleteTarget(file);};
  const deleteOwn=async()=>{
    if(!deleteTarget||deleteBusy)return;
    setDeleteBusy(true);setDeleteError("");
    try{
      await api.deleteOwn(deleteTarget.id);
      setDownloads(items=>items.filter(file=>file.id!==deleteTarget.id));
      setDeleteTarget(null);navigate("files");setNotice("Your download was deleted.");await refresh();
    }catch(cause){setDeleteError((cause as ApiError).error??"Deletion could not finish. Please retry.");}
    finally{setDeleteBusy(false);}
  };
  const open = (file: PublicDownload, child?: FileEntry) => {
    if (file.deletedAt || Date.parse(file.expiresAt) <= Date.now()) { navigate("unavailable"); return; }
    if (file.status !== "ready") { navigate("progress", file.id); return; }
    const kind = child?.kind ?? downloadKind(file);
    navigate(kind === "folder" ? "folder" : (child?.playable ?? file.playable) ? "player" : "preview", file.id, child?.id);
  };
  const download = async (file: PublicDownload, child?: FileEntry, newTab = false) => {
    setActions(null);
    if (!child && downloadKind(file) === "folder") { navigate("folder",file.id); return; }
    // Open synchronously for browsers which block popups after an async request.
    const target = newTab ? window.open("about:blank", "_blank") : null;
    if (target) target.opener = null;
    try {
      const result = await api.delivery(file.id, "download", child?.id);
      if (target) target.location.href = result.url;
      else { const link = document.createElement("a"); link.href = result.url; link.rel = "noopener"; link.click(); }
    } catch (cause) {
      target?.close();
      const problem = cause as ApiError;
      if (!child && problem.code === "unsupported") navigate("folder", file.id);
      else setNotice(problem.error ?? "Download unavailable. Please try again.");
    }
  };
  const shareUrl = (file: PublicDownload, child?: FileEntry) => {
    const kind = child?.kind ?? downloadKind(file);
    return new URL(routeUrl(kind === "folder" ? "folder" : (child?.playable ?? file.playable) ? "player" : "preview", file.id, child?.id), location.origin).href;
  };
  const copyDirectLink = async (file: PublicDownload, child?: FileEntry) => {
    await copyDownloadLink(() => api.delivery(file.id, "download", child?.id).then(result => result.url));
    setActions(null);
    setNotice("Download link copied. Paste it into your external player. Temporary link — keep it private.");
  };
  const share = async (file: PublicDownload, child?: FileEntry) => {
    try {
      const url = shareUrl(file, child);
      if (navigator.share) await navigator.share({ title: child?.displayName ?? file.displayName, url });
      else { await navigator.clipboard.writeText(url); setNotice("Link copied"); }
      setActions(null);
    } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setNotice("Sharing is unavailable. Copy the page address from your browser."); }
  };
  const list = (files: PublicDownload[], compact = false) => loading ? <FileLoading/> : files.length ? <div className="file-list">{files.map(file => <FileRow key={file.id} file={file} compact={compact} onOpen={() => open(file)} onMore={() => setActions({ file })} onDownload={() => void download(file)}/>)}</div> : error ? null : <EmptyState/>;
  const rootScreen = route.screen === "home" || route.screen === "files";
  const title = pageTitles[route.screen] ?? entry?.displayName ?? current?.displayName ?? "";
  const fileScreen = ["progress", "folder", "preview", "player"].includes(route.screen);
  const missing = fileScreen && (!current || !!current.deletedAt || Date.parse(current.expiresAt) <= Date.now() || (!!route.entry && contents && !entry));

  let page;
  if (route.screen === "home") page = <>
    <div className="home-hero"><Brand large/></div><MagnetForm onCreated={add} onStorageFull={problem => { setStorageFull(problem); navigate("storage-full"); }}/>
    <section className="recent-files"><div className="section-heading"><h2>Recent Files</h2><button className="text-button" onClick={() => navigate("files")}>See all</button></div>{list(activeFiles.slice(0, 4), true)}</section>
  </>;
  else if (route.screen === "files") page = <>
    <button className="storage-strip" onClick={() => navigate("storage")}><BrandIcon name="storage" size={29}/><div><strong>{storage ? formatBytes(storage.usedBytes) : "—"} <span>/ {storage ? formatBytes(storage.capacityBytes) : "—"}</span></strong><span className="meter"><span style={{ width: storage ? `${storage.usedBytes / storage.capacityBytes * 100}%` : "0%" }}/></span></div><ChevronRight size={17}/></button>
    <div className="filter-tabs" aria-label="Filter files">{(["all", "downloading", "ready"] as const).map(value => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value[0].toUpperCase() + value.slice(1)}{value !== "all" && <span>{value === "ready" ? ready.length : downloading.length}</span>}</button>)}</div>{list(visible)}
  </>;
  else if (route.screen === "storage") page = <section className="storage-page"><StorageCard storage={storage} onRefresh={() => void refresh()}/><div className="storage-stats">{([["Total Storage", storage?.capacityBytes], ["Used Storage", storage?.usedBytes], ["Available", storage?.availableBytes]] as const).map(([label, bytes]) => <div key={label}><BrandIcon name="storage" size={17}/><span>{label}</span><strong>{bytes === undefined ? "—" : formatBytes(bytes)}</strong></div>)}</div><div className="storage-counts"><p><BrandIcon name="add" size={17}/><span>Active downloads</span><strong>{downloading.length}</strong></p><p><BrandIcon name="check" size={17}/><span>Ready files</span><strong>{ready.length}</strong></p></div></section>;
  else if (route.screen === "settings") page = <SettingsPage go={navigate}/>;
  else if (route.screen === "accounts") page = <AccountsPage onChanged={()=>void refresh()}/>;
  else if (route.screen === "about") page = <AboutPage section={route.section}/>;
  else if (route.screen === "storage-full") page = storageFull ? <StorageFullPage error={storageFull} onFiles={() => navigate("files")} onCancel={() => navigate("home")}/> : <UnavailablePage onFiles={() => navigate("files")} message="No pending storage request."/>;
  else if (fileScreen && loading) page = <FileLoading/>;
  else if (missing || route.screen === "unavailable") page = <UnavailablePage onFiles={() => navigate("files")}/>;
  else if (current && route.screen === "progress") page = <ProgressPage file={current} onClose={() => navigate("files")} onDelete={()=>requestDelete(current)}/>;
  else if (current && current.status !== "ready" && fileScreen) page = <ProgressPage file={current} onClose={() => navigate("files")} onDelete={()=>requestDelete(current)}/>;
  else if (contentsLoading || (needsContents && !contents && !contentsError)) page = <FileLoading/>;
  else if (contentsError) page = <UnavailablePage onFiles={() => navigate("files")} message={contentsError}/>;
  else if (current && contents && isFolderView(route, contents.kind)) page = <FolderPage file={current} contents={contents} onOpen={child => open(current, child)} onMore={child => setActions({ file: current, entry: child })} onDownload={child => void download(current, child)}/>;
  else if (current && route.screen === "preview" && (entry?.preview === "guide" || (!route.entry && contents?.preview === "guide"))) page = <PreviewPage key={route.id + (route.entry ?? "")} file={current} entry={entry} onDownload={() => void download(current, entry)} onShare={() => void share(current, entry)} onOpenExternal={() => void download(current, entry, true)}/>;
  else if (current && route.screen === "preview" && ["image","pdf"].includes(entry?.kind??downloadKind(current))) page=<LivePreviewPage key={route.id+(route.entry??"")} file={current} entry={entry} onDownload={()=>void download(current,entry)}/>;
  else if (current && route.screen === "player" && (entry?.playable ?? current.playable)) page = <PlayerPage key={route.id + (route.entry ?? "")} file={current} entry={entry} onDownload={() => void download(current, entry)}/>;
  else page = <section className="unavailable"><BrandIcon name="file" size={70}/><h1>Preview not supported</h1><p>This file can still be downloaded.</p>{current && <button className="primary" onClick={() => void download(current, entry)}><BrandIcon name="download"/>Download</button>}</section>;

  return <main className={`app-shell screen-${route.screen}`}>
    <header className="app-header"><div className="header-inner">
      {rootScreen ? <button className={route.screen === "home" ? "home-header-brand" : "header-brand"} onClick={() => navigate("home")} aria-label="LinkBox home"><Brand/></button> : <button className="icon-button" onClick={() => navigate(route.screen==="accounts"?"settings":"files")} aria-label={route.screen==="accounts"?"Back to settings":"Back to files"}><BrandIcon name="back"/></button>}
      {!rootScreen && <h1 className="page-title">{title}</h1>}
      <nav className="desktop-nav" aria-label="Main navigation">{(["home", "files", "storage"] as const).map(screen => <button className={route.screen === screen ? "active" : ""} key={screen} onClick={() => navigate(screen)}>{screen[0].toUpperCase() + screen.slice(1)}</button>)}</nav>
      <button className="icon-button settings-button" onClick={() => navigate("settings")} aria-label="Settings"><BrandIcon name="settings"/></button>
    </div></header>
    <div className="page-content">{error && <div className="connection-error" role="alert"><p>{error}</p><button className="text-button" onClick={() => void refresh()}><RefreshCw size={15}/>Retry</button></div>}{page}</div>
    {rootScreen && <><button className="floating-add" onClick={() => { navigate("home"); window.setTimeout(() => document.getElementById("magnet")?.focus(), 0); }} aria-label="Add a link"><BrandIcon name="add" size={28}/></button><nav className="bottom-nav" aria-label="Bottom navigation"><button className="active" aria-current={route.screen === "files" ? "page" : undefined} onClick={() => navigate("files")}><BrandIcon name="folder" size={29}/>Files</button><button onClick={() => navigate("storage")}><BrandIcon name="storage" size={29}/>Storage</button></nav></>}
    {actions && <ActionsSheet key={actions.file.id + (actions.entry?.id ?? "")} file={actions.file} entry={actions.entry} onClose={() => setActions(null)} onOpen={() => open(actions.file, actions.entry)} onDownload={() => void download(actions.file, actions.entry)} onShare={() => void share(actions.file, actions.entry)} onCopy={() => copyDirectLink(actions.file, actions.entry)} onDelete={()=>requestDelete(actions.file)}/>}
    {deleteTarget&&<DeleteDownloadSheet file={deleteTarget} busy={deleteBusy} error={deleteError} onClose={()=>setDeleteTarget(null)} onConfirm={()=>void deleteOwn()}/>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
  </main>;
}
export default App;
