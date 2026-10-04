export function validateMagnet(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 8192 || [...input].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new ApiProblem(400,"invalid_magnet","Enter a valid magnet link.");
  let url: URL;
  try { url = new URL(input); } catch { throw new ApiProblem(400,"invalid_magnet","Enter a valid magnet link."); }
  if (url.protocol !== "magnet:" || !url.searchParams.getAll("xt").some(value => /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.test(value))) throw new ApiProblem(400,"invalid_magnet","The magnet link needs a valid BitTorrent info hash.");
  return input;
}
export function magnetIdentity(magnet: string): string {
  const xt = new URL(validateMagnet(magnet)).searchParams.getAll("xt").find(value => /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.test(value))!;
  const hash = xt.slice(9).toUpperCase();
  if (hash.length === 40) return hash.toLowerCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0, bits = 0;
  const bytes: number[] = [];
  for (const character of hash) {
    buffer = (buffer << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); buffer &= (1 << bits) - 1; }
  }
  return bytes.map(byte => byte.toString(16).padStart(2,"0")).join("");
}
export async function sha256(value: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join(""); }
export class ApiProblem extends Error { constructor(public status: number, public code: string, message: string, public details?: Record<string,unknown>){super(message);} }
