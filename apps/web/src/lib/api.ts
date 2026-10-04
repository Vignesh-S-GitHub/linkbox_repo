import type { ApiError, FileContents, PublicDownload, StorageSummary } from "@temporary-share/shared";
const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const sessionKey = "temporary-share-session";
const sessionId = localStorage.getItem(sessionKey) ?? crypto.randomUUID();
localStorage.setItem(sessionKey, sessionId);
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-session-id": sessionId, ...init?.headers } });
  if (!response.ok) throw (await response.json()) as ApiError;
  return response.json() as Promise<T>;
}
export const api = {
  storage: () => request<StorageSummary>("/api/storage"),
  downloads: () => request<PublicDownload[]>("/api/downloads"),
  create: (magnet: string) => request<PublicDownload>("/api/downloads", { method: "POST", body: JSON.stringify({ magnet }) }),
  cleanup: (id: string) => request<PublicDownload>(`/api/downloads/${id}/cleanup`, { method: "POST" }),
  contents: (id: string) => request<FileContents>(`/api/downloads/${encodeURIComponent(id)}/contents`),
  delivery: (id: string, action: "play" | "download", entryId?: string) => request<{ url: string }>(`/api/downloads/${encodeURIComponent(id)}/${action}?format=json${entryId ? `&entry=${encodeURIComponent(entryId)}` : ""}`),
  play: (id: string, entryId?: string) => `${baseUrl}/api/downloads/${encodeURIComponent(id)}/play${entryId ? `?entry=${encodeURIComponent(entryId)}` : ""}`,
  download: (id: string, entryId?: string) => `${baseUrl}/api/downloads/${encodeURIComponent(id)}/download${entryId ? `?entry=${encodeURIComponent(entryId)}` : ""}`
};
