import { ApiProblem } from "../utils/magnet";

const BASE_URL = "https://www.seedr.cc/api/v0.1/p";
const MAX_QUOTA_RESPONSE_BYTES = 64 * 1024;

export interface SeedrQuota {
  capacityBytes: number;
  usedBytes: number;
  availableBytes: number;
}

/** Names verified by a successful account.read request on 2026-10-04.
 * Confirm byte units against the account's displayed capacity before live use.
 */
export function parseQuota(value: unknown): SeedrQuota {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidQuota();
  const data = value as Record<string, unknown>;
  const used = data.space_used;
  const capacity = data.space_max;
  if (data.error || data.success === false || typeof used !== "number" || typeof capacity !== "number" ||
      !Number.isSafeInteger(used) || !Number.isSafeInteger(capacity) || used < 0 || capacity <= 0 || used > capacity) {
    throw invalidQuota();
  }
  return { capacityBytes: capacity, usedBytes: used, availableBytes: capacity - used };
}

function invalidQuota(): ApiProblem {
  return new ApiProblem(502, "seedr_invalid_quota", "Seedr returned invalid storage information. No files were changed.");
}

/** Server-only PAT client: fixed origin, no redirects, bounded JSON, safe errors. */
export class SeedrTokenClient {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 8192) {
      throw new ApiProblem(503, "seedr_token_missing", "A valid private Seedr token is required.");
    }
  }

  async quota(): Promise<SeedrQuota> {
    let response: Response;
    try {
      // workerd's native fetch requires the global receiver, unlike Node fetch.
      response = await this.fetchImpl.call(globalThis, `${BASE_URL}/me/quota`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        // Manual is supported by workerd and never forwards the token to a
        // redirect destination. Any 3xx response is rejected below.
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const reason = message.includes("illegal invocation") || message.includes("incorrect this") ? "runtime_receiver" :
        message.includes("redirect") ? "redirect_rejected" :
        message.includes("certificate") || message.includes("ssl") || message.includes("tls") ? "tls_connection" :
        message.includes("timeout") || message.includes("abort") ? "timeout" :
        message.includes("dns") || message.includes("resolve") ? "dns_connection" : "network_connection";
      // A fixed category only: no raw exception, URL, header or token is logged.
      console.warn("Seedr quota transport failed", reason);
      throw new ApiProblem(503, "seedr_unavailable", "Seedr could not be reached. Please try again later.", { reason });
    }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* Cancellation only; never expose provider errors. */ }
      if (response.status >= 300 && response.status < 400) {
        throw new ApiProblem(503, "seedr_redirect_rejected", "Seedr returned an unexpected redirect. No credentials were forwarded.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new ApiProblem(503, "seedr_token_rejected", "Seedr access was rejected. Check the private token and its account.read permission.");
      }
      throw new ApiProblem(503, "seedr_unavailable", "Seedr storage information is temporarily unavailable.");
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      try { await response.body?.cancel(); } catch { /* Best-effort cancellation only. */ }
      throw invalidQuota();
    }
    const reader = response.body?.getReader();
    if (!reader) throw invalidQuota();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_QUOTA_RESPONSE_BYTES) { await reader.cancel(); throw invalidQuota(); }
        chunks.push(value);
      }
    } catch {
      throw invalidQuota();
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let data: unknown;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalidQuota(); }
    return parseQuota(data);
  }
}
