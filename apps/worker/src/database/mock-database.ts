import type { Database } from "./database";
import type { DownloadRow } from "../types";
import { mockRows } from "../seedr/mock-fixtures";
export class MockDatabase implements Database { private readonly rows=new Map<string,DownloadRow>();
 private readonly guards=new Map<string,{holder:string;expires:number}>(); private accounts: import("../types").AccountState[]=[];
 async acquireLease(name:string,now:number,ttl:number){const previous=this.guards.get(name);if(previous&&previous.expires>now)return null;const holder=crypto.randomUUID();this.guards.set(name,{holder,expires:now+ttl});return holder;}
 async releaseLease(name:string,holder:string){if(this.guards.get(name)?.holder===holder)this.guards.delete(name);}
 async pruneGuards(now:number){for(const [key,value] of this.guards)if(value.expires<=now)this.guards.delete(key);}
 async cachedAccounts(){return structuredClone(this.accounts);}
 constructor(){for(const row of mockRows())this.rows.set(row.id,row); }
 async listActive(){return [...this.rows.values()].filter(row=>!row.deletedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(row=>structuredClone(row));}
 async syncAccounts(accounts:import("../types").AccountState[]){this.accounts=structuredClone(accounts);}
 async findByPublicId(id:string){const row=[...this.rows.values()].find(value=>value.publicId===id);return row?structuredClone(row):null;}
 async findActiveByHash(hash:string){const row=[...this.rows.values()].find(value=>value.magnetHash===hash&&!value.deletedAt);return row?structuredClone(row):null;}
 async create(row:DownloadRow){this.rows.set(row.id,structuredClone(row));return structuredClone(row);}
 async update(row:DownloadRow,expectedCleanupClaim:string|null=row.cleanupClaimedAt){const current=this.rows.get(row.id);if(current&&(current.deletedAt||current.cleanupClaimedAt!==expectedCleanupClaim))return structuredClone(current);const updated={...row,ownerSessionHash:current?.ownerSessionHash??null};this.rows.set(row.id,structuredClone(updated));return structuredClone(updated);}
 async claimForCleanup(publicId:string,now:string,ownerSessionHash?:string){const row=[...this.rows.values()].find(value=>value.publicId===publicId);if(!row||row.deletedAt||row.cleanupClaimedAt||(ownerSessionHash?row.ownerSessionHash!==ownerSessionHash:row.expiresAt>now))return null;row.cleanupClaimedAt=now;row.status="deleting";this.rows.set(row.id,row);return structuredClone(row);}
 async listExpired(now:string){return [...this.rows.values()].filter(row=>!row.deletedAt&&row.expiresAt<=now&&!row.cleanupClaimedAt).map(row=>structuredClone(row));}
}
