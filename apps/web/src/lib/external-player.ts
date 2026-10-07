/** Chrome requires a user gesture; prepare the URL before the launch click. */
export function supportsPlayerIntent(userAgent: string): boolean {
  return /Android/i.test(userAgent) && /Chrome\//.test(userAgent) && !/\bwv\b/.test(userAgent);
}

export function isExternalMedia(kind: string): kind is "video" | "audio" {
  return kind === "video" || kind === "audio";
}

/** Pass only the original signed file URL, never an authenticated API URL. */
export function externalPlayerIntent(value: string, kind: "video" | "audio", fallback: string): string {
  const invalid = () => new Error("External player link unavailable");
  if (typeof value !== "string" || value.length > 8192 || [...value].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) throw invalid();
  let media: URL, page: URL;
  try { media = new URL(value); page = new URL(fallback); } catch { throw invalid(); }
  if (!isExternalMedia(kind) || media.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)*seedr\.cc$/i.test(media.hostname)
    || media.username || media.password || media.port || value.includes("#") || media.pathname.startsWith("/api/")) throw invalid();
  if (!["https:", "http:"].includes(page.protocol) || page.username || page.password) throw invalid();
  // No package/component: allow the device to choose a compatible installed player.
  // Returning to LinkBox is safer than triggering a multi-GB download as fallback.
  return `intent:${media.href.slice("https:".length)}#Intent;scheme=https;action=android.intent.action.VIEW;type=${kind}%2F%2A;S.browser_fallback_url=${encodeURIComponent(page.href)};end`;
}
