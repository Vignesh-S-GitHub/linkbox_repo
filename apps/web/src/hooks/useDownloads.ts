import { useCallback, useEffect, useState } from "react";
import type { PublicDownload, StorageSummary } from "@temporary-share/shared";
import { api } from "../lib/api";
export function useDownloads() {
  const [downloads, setDownloads] = useState<PublicDownload[]>([]);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [nextStorage, nextDownloads] = await Promise.all([api.storage(), api.downloads()]);
      setStorage(nextStorage); setDownloads(nextDownloads); setError("");
    } catch { setStorage(null); setDownloads([]); setError("Unable to connect to LinkBox. Check that the Worker is running and try again."); }
    finally { setLoading(false); }
  }, []);
  const pending = downloads.some(item => ["queued", "fetching_metadata", "downloading", "processing"].includes(item.status));
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, pending ? 15000 : 60000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh, pending]);
  return { downloads, storage, loading, error, refresh, setDownloads };
}
