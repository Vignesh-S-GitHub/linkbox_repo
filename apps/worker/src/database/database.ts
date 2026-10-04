import type { AccountState, DownloadRow } from "../types";
export interface Database {
 syncAccounts(accounts:AccountState[]):Promise<void>;
 cachedAccounts():Promise<AccountState[]>;
 acquireLease(name:string,now:number,ttl:number):Promise<string|null>;
 releaseLease(name:string,holder:string):Promise<void>;
 pruneGuards(now:number):Promise<void>;
 listActive():Promise<DownloadRow[]>; findByPublicId(publicId:string):Promise<DownloadRow|null>;
 findActiveByHash(hash:string):Promise<DownloadRow|null>; create(row:DownloadRow):Promise<DownloadRow>;
 update(row:DownloadRow,expectedCleanupClaim?:string|null):Promise<DownloadRow>;
 claimForCleanup(publicId:string,now:string,ownerSessionHash?:string):Promise<DownloadRow|null>; listExpired(now:string):Promise<DownloadRow[]>;
}
