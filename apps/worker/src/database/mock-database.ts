import type { Database } from "./database";
import type { DownloadRow } from "../types";
import { mockRows } from "../seedr/mock-fixtures";
export class MockDatabase implements Database { private readonly rows=new Map<string,DownloadRow>();
 constructor(){for(const row of mockRows())this.rows.set(row.id,row); }
 async listActive(){return [...this.rows.values()].filter(row=>!row.deletedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(row=>structuredClone(row));}
 async syncAccounts(){/* Adapter memory is the mock source of truth. */}
 async findByPublicId(id:string){const row=[...this.rows.values()].find(value=>value.publicId===id);return row?structuredClone(row):null;}
 async findActiveByHash(hash:string){const row=[...this.rows.values()].find(value=>value.magnetHash===hash&&!value.deletedAt);return row?structuredClone(row):null;}
 async create(row:DownloadRow){this.rows.set(row.id,structuredClone(row));return structuredClone(row);}
 async update(row:DownloadRow){this.rows.set(row.id,structuredClone(row));return structuredClone(row);}
 async claimForCleanup(publicId:string,now:string){const row=[...this.rows.values()].find(value=>value.publicId===publicId);if(!row||row.deletedAt||row.cleanupClaimedAt||row.cleanupAllowedAt>now)return null;row.cleanupClaimedAt=now;row.status="deleting";this.rows.set(row.id,row);return structuredClone(row);}
 async listExpired(now:string){return [...this.rows.values()].filter(row=>!row.deletedAt&&row.expiresAt<=now&&!row.cleanupClaimedAt).map(row=>structuredClone(row));}
}
