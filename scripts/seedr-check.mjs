import { pathToFileURL } from "node:url";

// Verified in Seedr's signed-in API Console documentation on 2026-10-04.
const QUOTA_URL = "https://www.seedr.cc/api/v0.1/p/me/quota";
const MAX_RESPONSE_BYTES = 64 * 1024;

// Emit types, never response values: the diagnostic is safe to share in chat.
export function responseShape(value, depth = 0, secret = "") {
  if (depth > 6) return "nested";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? [responseShape(value[0], depth + 1, secret)] : [];
  if (typeof value !== "object") return typeof value;
  const shape = {};
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    // Avoid dynamic keys (identifiers/emails) and sensitive-field names too.
    if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(key) || /token|secret|password|email|authorization|cookie/i.test(key) || ["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (secret && key.includes(secret)) continue;
    shape[key] = responseShape(entry, depth + 1, secret);
  }
  return shape;
}

export async function checkQuota(token, fetchImpl = fetch, includeStorageCounts = false) {
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 8192) {
    throw new Error("Invalid token format. Enter only the Personal Access Token, not 'Bearer' or your password.");
  }
  let response;
  try {
    response = await fetchImpl(QUOTA_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Seedr connection failed or timed out. No files were changed.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    const reason = {
      401: "Token rejected or expired.",
      403: "Token needs account.read permission, or the account does not allow this operation.",
      429: "Seedr is limiting requests. Wait before retrying.",
    }[response.status] ?? "Seedr could not complete the quota check.";
    throw new Error(`${reason} HTTP ${response.status}. No files were changed.`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel();
    throw new Error("Seedr returned an unexpected response format. No response content was logged.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Seedr returned an empty quota response.");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Seedr quota response exceeded the diagnostic size limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Seedr quota response exceeded the diagnostic size limit.") throw error;
    throw new Error("Seedr quota response could not be read. No response content was logged.");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let quota;
  try { quota = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Seedr returned invalid JSON. No response content was logged."); }
  if (!quota || typeof quota !== "object" || Array.isArray(quota)) {
    throw new Error("Seedr returned an unexpected quota structure.");
  }
  if ("error" in quota || quota.success === false) {
    throw new Error("Seedr reported an API error. No response content was logged.");
  }
  const result = { authenticatedQuotaRequest: true, httpStatus: response.status, responseShape: responseShape(quota, 0, token) };
  if (includeStorageCounts) {
    const used = quota.space_used;
    const capacity = quota.space_max;
    if (!Number.isSafeInteger(used) || !Number.isSafeInteger(capacity) || used < 0 || capacity <= 0 || used > capacity) {
      throw new Error("Seedr returned invalid storage counts. Private configuration was not changed.");
    }
    result.storageCounts = { space_used: used, space_max: capacity };
  }
  return result;
}

async function main() {
  let token = "";
  try {
    for await (const chunk of process.stdin) {
      token += chunk.toString();
      if (token.length > 8194) throw new Error("Token input exceeded the size limit.");
    }
    const result = await checkQuota(token.trim());
    console.log("Seedr accepted the read-only quota request. No files were added, downloaded or deleted.");
    console.log("Diagnostic below contains field names/types only (no token or account values):");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Seedr connection check failed.");
    process.exitCode = 1;
  } finally {
    token = "";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
