import type { AccountConfig, AccountState, DownloadRow } from "../types";
export interface Database {
 accountConfigurations():Promise<AccountConfig[]>;
 saveAccountConfiguration(account:AccountConfig):Promise<void>;
 syncAccounts(accounts:AccountState[]):Promise<void>;
 cachedAccounts(includeDisabled?:boolean):Promise<AccountState[]>;
 acquireLease(name:string,now:number,ttl:number):Promise<string|null>;
 releaseLease(name:string,holder:string):Promise<void>;
 pruneGuards(now:number):Promise<void>;
 listActive():Promise<DownloadRow[]>; findByPublicId(publicId:string):Promise<DownloadRow|null>;
 /** Least recently polled eligible rows, bounded to the per-request provider budget. */
 progressCandidates(now:number):Promise<string[]>;
 findActiveByHash(hash:string):Promise<DownloadRow|null>; create(row:DownloadRow):Promise<DownloadRow>;
 update(row:DownloadRow,expectedCleanupClaim?:string|null):Promise<DownloadRow>;
 /** Internal policy removal only: CAS against the item observed by the progress poll. */
 claimForFailure(publicId:string,now:string,expectedItemId:string):Promise<DownloadRow|null>;
 /** Creator can delete anytime; others wait 3 hours. Cron only claims expired items. */
 claimForCleanup(publicId:string,now:string,mode?:"manual"|"expired",ownerSessionHash?:string|null):Promise<DownloadRow|null>; listExpired(now:string):Promise<DownloadRow[]>;
}
