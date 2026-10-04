import type { AccountState } from "../types";
/** Best-fit leaves the least leftover space, reducing unusable fragmentation. */
export function selectAccount(accounts: AccountState[], requestedBytes: number): AccountState | null { return accounts.filter(account=>account.enabled && account.availableBytes >= requestedBytes).sort((a,b)=>(a.availableBytes-requestedBytes)-(b.availableBytes-requestedBytes) || a.id.localeCompare(b.id))[0] ?? null; }
export function combinedAvailable(accounts: AccountState[]): number { return accounts.filter(account=>account.enabled).reduce((sum, account)=>sum+account.availableBytes,0); }
