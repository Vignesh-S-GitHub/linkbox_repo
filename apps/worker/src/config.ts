import type { AccountConfig, Env } from "./types";
const gib = 1024 ** 3;
export const DEFAULT_ACCOUNTS: AccountConfig[] = [
 {id:"seedr-a",label:"Seedr A",enabled:true,capacityBytes:5*gib,secretKeyReference:"SEEDR_ACCOUNT_A_TOKEN"},
 {id:"seedr-b",label:"Seedr B",enabled:true,capacityBytes:4.5*gib,secretKeyReference:"SEEDR_ACCOUNT_B_TOKEN"}
];
export function accountsFromEnv(env: Env): AccountConfig[] { if (!env.SEEDR_ACCOUNT_CONFIG) return DEFAULT_ACCOUNTS; try { const parsed: unknown = JSON.parse(env.SEEDR_ACCOUNT_CONFIG); if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty"); return parsed.map((value, index) => { if (typeof value !== "object" || value === null) throw new Error("invalid"); const record = value as Record<string,unknown>; if (typeof record.id !== "string" || typeof record.label !== "string" || typeof record.capacityBytes !== "number" || typeof record.secretKeyReference !== "string") throw new Error(`invalid account ${index}`); return {id:record.id,label:record.label,enabled:record.enabled !== false,capacityBytes:record.capacityBytes,secretKeyReference:record.secretKeyReference}; }); } catch { throw new Error("SEEDR_ACCOUNT_CONFIG is not valid account configuration"); } }
export const maxFileBytes = (env: Env) => Number(env.MAX_FILE_SIZE_BYTES ?? 5*gib);
export const maxActiveDownloads = (env: Env) => Number(env.MAX_ACTIVE_DOWNLOADS ?? 8);
