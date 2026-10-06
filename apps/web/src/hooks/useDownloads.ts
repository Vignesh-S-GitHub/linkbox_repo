import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { PublicDownload, StorageSummary } from "@temporary-share/shared";
import { api } from "../lib/api";
import { RefreshCoordinator } from "../lib/refresh-coordinator";
export function useDownloads() {
  const [downloads, updateDownloads] = useState<PublicDownload[]>([]);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const runner = useRef<RefreshCoordinator<[PromiseSettledResult<StorageSummary>, PromiseSettledResult<PublicDownload[]>]> | null>(null);
  if (!runner.current) runner.current = new RefreshCoordinator(async signal => {
    const result = await Promise.allSettled([api.storage(signal), api.downloads(signal)]);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return result;
  }, ([quota, files]) => {
    if (quota.status === "fulfilled") setStorage(quota.value);
    if (files.status === "fulfilled") updateDownloads(files.value);
    // Preserve last-known state on outages, including the open player.
    setError(quota.status === "rejected" || files.status === "rejected"
      ? "Some information could not refresh. Last-known information may be out of date. Check your connection and retry." : "");
  }, () => setError("Unable to refresh LinkBox. Check your connection and retry."), () => setLoading(false));
  const refresh = useCallback(() => {
    if (!navigator.onLine) { setError("You’re offline. File operations need an internet connection."); setLoading(false); return Promise.resolve(); }
    return runner.current!.refresh();
  }, []);
  const setDownloads = useCallback((value: SetStateAction<PublicDownload[]>) => { runner.current?.cancel(); updateDownloads(value); }, []);
  const pending = downloads.some(item => ["queued", "fetching_metadata", "downloading", "processing"].includes(item.status));
  useEffect(() => { void refresh(); return () => runner.current?.cancel(); }, [refresh]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); };
    const onOffline = () => { runner.current?.cancel(); setLoading(false); setError("You’re offline. File operations need an internet connection."); };
    const timer = window.setInterval(onVisible, pending ? 15000 : 60000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible); window.addEventListener("offline", onOffline);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onVisible); window.removeEventListener("offline", onOffline); };
  }, [refresh, pending]);
  return { downloads, storage, loading, error, refresh, setDownloads };
}
