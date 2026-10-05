import type { AdminAccountList, ApiError, FileContents, PublicDownload, StorageSummary } from "@temporary-share/shared";
const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const sessionKey = "temporary-share-session";
const storedSession = localStorage.getItem(sessionKey);
const sessionId = storedSession && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storedSession) ? storedSession : crypto.randomUUID();
localStorage.setItem(sessionKey, sessionId);
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-session-id": sessionId, ...init?.headers } });
  if (!response.ok) throw (await response.json()) as ApiError;
  return response.json() as Promise<T>;
}
export const api = {
  adminAccounts: (key:string,signal?:AbortSignal) => request<AdminAccountList>("/api/admin/accounts",{headers:{authorization:`Bearer ${key}`},signal}),
  adminRefresh: (key:string,signal?:AbortSignal) => request<AdminAccountList>("/api/admin/accounts/refresh",{method:"POST",headers:{authorization:`Bearer ${key}`},signal}),
  adminAdd: (key:string,body:{label:string;secretKeyReference:string;distinctAccount:boolean},signal?:AbortSignal) => request<AdminAccountList>("/api/admin/accounts",{method:"POST",headers:{authorization:`Bearer ${key}`},body:JSON.stringify(body),signal}),
  adminEnable: (key:string,id:string,enabled:boolean,signal?:AbortSignal) => request<AdminAccountList>(`/api/admin/accounts/${encodeURIComponent(id)}`,{method:"POST",headers:{authorization:`Bearer ${key}`},body:JSON.stringify({enabled}),signal}),
  storage: () => request<StorageSummary>("/api/storage"),
  downloads: () => request<PublicDownload[]>("/api/downloads"),
  create: (magnet: string) => request<PublicDownload>("/api/downloads", { method: "POST", body: JSON.stringify({ magnet }) }),
  deleteOwn: (id: string) => request<PublicDownload>(`/api/downloads/${encodeURIComponent(id)}/delete`, { method: "POST" }),
  contents: (id: string) => request<FileContents>(`/api/downloads/${encodeURIComponent(id)}/contents`),
  delivery: (id: string, action: "play" | "download", entryId?: string) => request<{ url: string }>(`/api/downloads/${encodeURIComponent(id)}/${action}?format=json${entryId ? `&entry=${encodeURIComponent(entryId)}` : ""}`),
  play: (id: string, entryId?: string) => `${baseUrl}/api/downloads/${encodeURIComponent(id)}/play${entryId ? `?entry=${encodeURIComponent(entryId)}` : ""}`,
  download: (id: string, entryId?: string) => `${baseUrl}/api/downloads/${encodeURIComponent(id)}/download${entryId ? `?entry=${encodeURIComponent(entryId)}` : ""}`
};
