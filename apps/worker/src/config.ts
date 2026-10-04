import type { AccountConfig, Env } from "./types";
const gib = 1024 ** 3;
export const DEFAULT_ACCOUNTS: AccountConfig[] = [
 {id:"seedr-a",label:"Seedr A",enabled:true,capacityBytes:5*gib,secretKeyReference:"SEEDR_ACCOUNT_A_TOKEN"},
 {id:"seedr-b",label:"Seedr B",enabled:true,capacityBytes:4.5*gib,secretKeyReference:"SEEDR_ACCOUNT_B_TOKEN"}
];
export function accountsFromEnv(env: Env): AccountConfig[] {
  if (!env.SEEDR_ACCOUNT_CONFIG) return DEFAULT_ACCOUNTS;
  try {
    const parsed: unknown = JSON.parse(env.SEEDR_ACCOUNT_CONFIG);
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 8) throw new Error("account limit");
    const ids = new Set<string>(), secrets = new Set<string>();
    return parsed.map(value => {
      if (typeof value !== "object" || value === null) throw new Error("invalid");
      const record = value as Record<string, unknown>;
      if (typeof record.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(record.id) || ids.has(record.id) ||
          typeof record.label !== "string" || !record.label.trim() || record.label.length > 128 ||
          typeof record.capacityBytes !== "number" || !Number.isSafeInteger(record.capacityBytes) || record.capacityBytes <= 0 ||
          typeof record.secretKeyReference !== "string" || !/^SEEDR_[A-Z0-9_]+_TOKEN$/.test(record.secretKeyReference) || secrets.has(record.secretKeyReference) ||
          (record.enabled !== undefined && typeof record.enabled !== "boolean")) throw new Error("invalid account");
      ids.add(record.id); secrets.add(record.secretKeyReference);
      return { id: record.id, label: record.label, enabled: record.enabled !== false, capacityBytes: record.capacityBytes, secretKeyReference: record.secretKeyReference };
    });
  } catch { throw new Error("SEEDR_ACCOUNT_CONFIG is not valid account configuration"); }
}
export const maxFileBytes = (env: Env) => positiveLimit(env.MAX_FILE_SIZE_BYTES,5*gib,Number.MAX_SAFE_INTEGER);
export const maxActiveDownloads = (env: Env) => positiveLimit(env.MAX_ACTIVE_DOWNLOADS,8,8);
function positiveLimit(value:string|undefined,fallback:number,maximum:number){const result=Number(value??fallback);if(!Number.isSafeInteger(result)||result<1||result>maximum)throw new Error("Invalid private limit configuration");return result;}
