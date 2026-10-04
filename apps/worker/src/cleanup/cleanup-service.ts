import type { Database } from "../database/database";
import type { SeedrAdapter } from "../seedr/adapter";
import type { DownloadRow } from "../types";
import { ownsDownload } from "../utils/owner";
import { ApiProblem } from "../utils/magnet";
export async function completeDeletion(database:Database,adapter:SeedrAdapter,row:DownloadRow,now:string,status:"deleted"|"expired",previousStatus:DownloadRow["status"]="ready"):Promise<DownloadRow>{
  try { await adapter.deleteItem(row.seedrAccountId,row.seedrItemId); }
  catch(error) {
    // Adapters handle a confirmed missing item idempotently. An outage is not successful deletion.
    await database.update({...row,status:previousStatus,cleanupClaimedAt:null,errorMessage:"Cleanup could not finish. Please retry."},row.cleanupClaimedAt);
    throw error;
  }
  return database.update({...row,status,deletedAt:now,cleanupClaimedAt:now,errorMessage:null});
}
export async function deleteCommunityItem(database:Database,adapter:SeedrAdapter,publicId:string,now:string){const previous=await database.findByPublicId(publicId);const claimed=await database.claimForCleanup(publicId,now);if(!claimed)return null;return completeDeletion(database,adapter,claimed,now,"deleted",previous?.status);}
export async function deleteOwnedItem(database:Database,adapter:SeedrAdapter,publicId:string,now:string,ownerSessionHash:string|null){
 const previous=await database.findByPublicId(publicId);
 if(!previous||!ownsDownload(previous,ownerSessionHash))throw new ApiProblem(403,"not_download_owner","Only the browser that added this download can delete it immediately.");
 if(previous.deletedAt)return previous;
 const claimed=await database.claimForCleanup(publicId,now,ownerSessionHash!);
 if(!claimed)return null;
 return completeDeletion(database,adapter,claimed,now,"deleted",previous.status==="deleting"?"failed":previous.status);
}
export async function expireDueItems(database:Database,adapter:SeedrAdapter,now:string){const candidates=await database.listExpired(now);let count=0;for(const candidate of candidates){const claimed=await database.claimForCleanup(candidate.publicId,now);if(!claimed)continue;try{await completeDeletion(database,adapter,claimed,now,"expired",candidate.status==="deleting"?"failed":candidate.status);count++;}catch{console.warn("Expired item cleanup will be retried");}}await database.pruneGuards(Date.parse(now));return count;}
