import type { DownloadRow } from "../types";
import { sha256 } from "./magnet";

/** Browser UUID is a private bearer capability, not a public user identifier. */
export async function requestOwnerHash(request: Request): Promise<string | null> {
  const value = request.headers.get("x-session-id");
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return null;
  return sha256(value);
}
export function ownsDownload(row: DownloadRow, hash: string | null): boolean {
  if (!hash || !row.ownerSessionHash) return false;
  const bytes = (value: string) => Uint8Array.from(value.match(/.{2}/g) ?? [], part => parseInt(part, 16));
  const provided = bytes(hash), stored = bytes(row.ownerSessionHash);
  if (provided.length !== 32 || stored.length !== 32) return false;
  if ("timingSafeEqual" in crypto.subtle && typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(provided, stored) === true;
  // Node's test runtime lacks the Worker extension. Compare every digest byte.
  let mismatch = 0; for (let i = 0; i < 32; i++) mismatch |= provided[i] ^ stored[i];
  return mismatch === 0;
}
