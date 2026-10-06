import type { ApiError } from "@temporary-share/shared";

/** No automatic POST retries: a timed-out submission may already be accepted. */
export async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = init.method && init.method !== "GET" ? 120000 : 60000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: controller.signal });
    let body: unknown;
    try { body = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw { code: "invalid_response", error: init.method && init.method !== "GET"
        ? "Confirmation was not received. Check Files before retrying; the request may already have completed."
        : "LinkBox received an unexpected response. Please try again." } satisfies ApiError;
    }
    if (!response.ok) {
      if (body && typeof body === "object" && "code" in body && "error" in body && typeof body.code === "string" && typeof body.error === "string") throw body;
      throw { code: "request_failed", error: "This request could not be completed. Please try again." } satisfies ApiError;
    }
    return body as T;
  } catch (error) {
    if (init.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") throw error;
    const write = init.method && init.method !== "GET";
    throw { code: controller.signal.aborted ? "request_timeout" : "network_unavailable", error: write
      ? "Confirmation was not received. Check Files before retrying; the request may already have completed."
      : "Unable to refresh LinkBox. Check your connection and try again." } satisfies ApiError;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
