/* Build replaces these markers. Cache only static app assets, never API or media. */
const CACHE_PREFIX = "linkbox-shell-";
const CACHE_NAME = CACHE_PREFIX + "__LINKBOX_BUILD__";
const PRECACHE = ["__LINKBOX_ASSETS__"];
const MAX_RUNTIME_ASSETS = 100;
const APP_ROUTE = /^\/(?:$|(?:home|files|progress|folder|preview|player|storage|storage-full|settings|accounts|about|unavailable)(?:\/[^/]+)?\/?$)/;
function isStatic(url) {
  return !url.search && (/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(url.pathname) ||
    /^\/brand\/[A-Za-z0-9_./-]+\.(?:png|svg|ico)$/.test(url.pathname) || url.pathname === "/site.webmanifest");
}
function cacheable(response, path) {
  const type = response.headers.get("content-type") ?? "";
  return response.ok && response.type !== "opaque" && !response.redirected &&
    (path === "/index.html" ? type.includes("text/html") : path.endsWith(".js") ? /javascript/.test(type) : path.endsWith(".css") ? type.includes("text/css") : /image\/|json/.test(type));
}
async function remember(path, response) {
  if (!cacheable(response, path)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(path, response.clone());
  const keys = await cache.keys();
  const runtime = keys.filter(key => !PRECACHE.includes(new URL(key.url).pathname));
  for (const key of runtime.slice(0, Math.max(0, runtime.length - MAX_RUNTIME_ASSETS))) await cache.delete(key);
}
async function navigationResponse(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try { return await fetch(request, { signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      for (const path of PRECACHE) {
        const response = await fetch(path, { cache: "reload", credentials: "omit", redirect: "error" });
        if (!cacheable(response, path)) throw new Error("App shell is unavailable");
        await cache.put(path, response);
      }
    } catch (error) { await caches.delete(CACHE_NAME); throw error; }
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => { if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting()); });
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || request.headers.has("authorization") || request.headers.has("x-session-id") || request.headers.has("range")) return;
  if (request.mode === "navigate" && APP_ROUTE.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        // Only installation stores the canonical shell. Updating an old cache's
        // HTML could reference new bundles before the new worker finishes caching.
        return await navigationResponse(request);
      } catch {
        return await (await caches.open(CACHE_NAME)).match("/index.html") ?? new Response("LinkBox needs a connection for its first visit.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
  } else if (isStatic(url)) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE_NAME)).match(url.pathname);
      if (cached) return cached;
      const response = await fetch(request);
      event.waitUntil(remember(url.pathname, response));
      return response;
    })());
  }
});
