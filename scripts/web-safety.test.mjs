import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const root = new URL("../", import.meta.url);
const tests = [], test = (name, run) => tests.push([name, run]);
async function moduleAt(path) {
  const source = await readFile(new URL(path, root), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
const { requestJson } = await moduleAt("apps/web/src/lib/http.ts");
const { RefreshCoordinator } = await moduleAt("apps/web/src/lib/refresh-coordinator.ts");
test("API timeout is bounded, does not retry POST and warns about uncertain acceptance", async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = (_, options) => new Promise((_, reject) => { calls++; options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }); });
    await assert.rejects(requestJson("https://fixture.invalid/api", { method: "POST" }, 5), e => e.code === "request_timeout" && e.error.includes("Check Files"));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test("caller cancellation stays cancellation, not a public failure", async () => {
  const original = globalThis.fetch, controller = new AbortController(); controller.abort();
  try { globalThis.fetch = (_, options) => { assert.ok(options.signal.aborted); throw new DOMException("aborted", "AbortError"); };
    await assert.rejects(requestJson("https://fixture.invalid", { signal: controller.signal }, 50), e => e.name === "AbortError");
  } finally { globalThis.fetch = original; }
});
test("API preserves safe error codes, rejects non-JSON errors and disallows cache/redirects", async () => {
  const original = globalThis.fetch;
  try { globalThis.fetch = async (_, options) => { assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error"); return Response.json({ code: "storage_full", error: "Not enough space." }, { status: 409 }); };
    await assert.rejects(requestJson("https://fixture.invalid"), e => e.code === "storage_full");
    globalThis.fetch = async () => new Response("private proxy error", { status: 502 });
    await assert.rejects(requestJson("https://fixture.invalid"), e => e.code === "invalid_response" && !e.error.includes("private"));
  } finally { globalThis.fetch = original; }
});
test("refresh deduplicates and cancelled stale work cannot overwrite a local add/delete", async () => {
  let resolve, calls = 0, settled = 0; const applied = [];
  const runner = new RefreshCoordinator(() => { calls++; return new Promise(r => { resolve = r; }); }, value => applied.push(value), () => assert.fail("unexpected error"), () => settled++);
  const first = runner.refresh(); assert.equal(runner.refresh(), first); await Promise.resolve(); assert.equal(calls, 1);
  runner.cancel(); const next = runner.refresh(); const oldResolve = resolve; await Promise.resolve(); oldResolve("stale"); resolve("fresh");
  await Promise.all([first, next]); assert.deepEqual(applied, ["fresh"]); assert.equal(settled, 1);
});
test("refresh failures keep last-known state and allow retry", async () => {
  let errors = 0, settled = 0, fail = true; const applied = [];
  const runner = new RefreshCoordinator(async () => { if (fail) throw new Error("offline"); return "new"; }, value => applied.push(value), () => errors++, () => settled++);
  await runner.refresh(); assert.deepEqual(applied, []); assert.equal(errors, 1); fail = false; await runner.refresh(); assert.deepEqual(applied, ["new"]); assert.equal(settled, 2);
});

async function serviceWorker() {
  const handlers = new Map(), cacheStores = new Map(); let offline = false, claimed = 0, skipped = 0, htmlForJs = false, stalledNavigation = false;
  const origin = "https://linkbox.example";
  const pathOf = value => new URL(typeof value === "string" ? value : value.url, origin).pathname;
  const cache = name => {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map()); const entries = cacheStores.get(name);
    return { put: async (key, value) => entries.set(pathOf(key), value.clone()), match: async key => entries.get(pathOf(key))?.clone(), keys: async () => [...entries.keys()].map(path => new Request(origin + path)), delete: async key => entries.delete(pathOf(key)) };
  };
  const caches = { open: async name => cache(name), keys: async () => [...cacheStores.keys()], delete: async name => cacheStores.delete(name) };
  const context = { URL, Response, Request, Error, caches, AbortController, setTimeout: callback => setTimeout(callback, 5), clearTimeout, self: { location: { origin }, clients: { claim: async () => { claimed++; } }, skipWaiting: async () => { skipped++; }, addEventListener: (type, handler) => handlers.set(type, handler) },
    fetch: async (value, options) => { if (offline) throw new Error("offline"); if (stalledNavigation && value.mode === "navigate") return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })); const path = pathOf(value), js = path.endsWith(".js") && !htmlForJs; return new Response(js ? "app()" : path.endsWith(".svg") ? "<svg/>" : path.endsWith(".json") ? "{}" : path === "/index.html" ? "<html>public shell</html>" : "<html>new online shell</html>", { headers: { "content-type": js ? "text/javascript" : path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".json") ? "application/json" : "text/html" } }); } };
  const source = (await readFile(new URL("apps/web/public/sw.js", root), "utf8")).replace("__LINKBOX_BUILD__", "fixture").replace('["__LINKBOX_ASSETS__"]', JSON.stringify(["/index.html", "/assets/app.js", "/brand/04_ui_icons/svg/back.svg"]));
  runInNewContext(source, context);
  async function event(type, extra = {}) { const waiting = []; let response;
    handlers.get(type)({ ...extra, waitUntil: promise => waiting.push(promise), respondWith: promise => { response = promise; } });
    const result = response ? await response : undefined; await Promise.all(waiting); return result;
  }
  return { event, cacheStores, cache, setOffline: value => { offline = value; }, setHtmlForJs: value => { htmlForJs = value; }, setStalledNavigation: value => { stalledNavigation = value; }, claimed: () => claimed, skipped: () => skipped, origin };
}
function swRequest(url, options = {}) { return { url, method: "GET", mode: "cors", headers: new Headers(), ...options }; }
test("service worker bypasses API, admin, media, POST, authorization and signed queries", async () => {
  const sw = await serviceWorker(); await sw.event("install");
  for (const request of [swRequest(sw.origin + "/api/downloads"), swRequest(sw.origin + "/api/admin/accounts"), swRequest("https://cdn.seedr.cc/signed.mp4"), swRequest(sw.origin + "/video.mp4"), swRequest(sw.origin + "/assets/app.js?token=private"), swRequest(sw.origin + "/files", { method: "POST", mode: "navigate" }), swRequest(sw.origin + "/assets/app.js", { headers: new Headers({ Authorization: "Bearer fixture" }) }), swRequest(sw.origin + "/assets/app.js", { headers: new Headers({ Range: "bytes=0-" }) })]) assert.equal(await sw.event("fetch", { request }), undefined);
  assert.equal(sw.cacheStores.get("linkbox-shell-fixture").size, 3);
});
test("offline routes get only the public shell; static assets remain available", async () => {
  const sw = await serviceWorker(); await sw.event("install"); sw.setOffline(true);
  assert.match(await (await sw.event("fetch", { request: swRequest(sw.origin + "/settings?private=not-cached", { mode: "navigate" }) })).text(), /public shell/);
  assert.equal(await (await sw.event("fetch", { request: swRequest(sw.origin + "/assets/app.js") })).text(), "app()");
  assert.equal(await (await sw.event("fetch", { request: swRequest(sw.origin + "/brand/04_ui_icons/svg/back.svg") })).text(), "<svg/>");
  assert.equal(sw.cacheStores.get("linkbox-shell-fixture").size, 3);
});
test("cache cleanup touches only LinkBox caches and update activation is explicit", async () => {
  const sw = await serviceWorker(); await sw.event("install"); sw.cache("linkbox-shell-old"); sw.cache("another-app");
  await sw.event("activate"); assert.ok(!sw.cacheStores.has("linkbox-shell-old")); assert.ok(sw.cacheStores.has("another-app")); assert.equal(sw.claimed(), 1); assert.equal(sw.skipped(), 0);
  await sw.event("message", { data: { type: "UNKNOWN" } }); assert.equal(sw.skipped(), 0);
  await sw.event("message", { data: { type: "SKIP_WAITING" } }); assert.equal(sw.skipped(), 1);
});
test("online navigation never mixes new HTML into the installed offline shell", async () => {
  const sw = await serviceWorker(); await sw.event("install");
  assert.match(await (await sw.event("fetch", { request: swRequest(sw.origin + "/settings", { mode: "navigate" }) })).text(), /new online shell/);
  sw.setOffline(true);
  assert.match(await (await sw.event("fetch", { request: swRequest(sw.origin + "/settings", { mode: "navigate" }) })).text(), /public shell/);
});
test("stalled navigation is aborted and falls back to the installed shell", async () => {
  const sw = await serviceWorker(); await sw.event("install"); sw.setStalledNavigation(true);
  assert.match(await (await sw.event("fetch", { request: swRequest(sw.origin + "/files", { mode: "navigate" }) })).text(), /public shell/);
});
test("HTML fallback cannot be cached as a JavaScript asset", async () => {
  const sw = await serviceWorker(); await sw.event("install");
  sw.setHtmlForJs(true);
  await sw.event("fetch", { request: swRequest(sw.origin + "/assets/missing.js") });
  assert.ok(!sw.cacheStores.get("linkbox-shell-fixture").has("/assets/missing.js"));
  assert.equal(await sw.event("fetch", { request: swRequest(sw.origin + "/unknown", { mode: "navigate" }) }), undefined);
});
test("blocked browser storage does not crash identity or appearance preferences", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try { Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    const storage = await moduleAt("apps/web/src/lib/browser-storage.ts"); assert.equal(storage.readBrowserValue("session"), null); assert.equal(storage.writeBrowserValue("session", "fixture"), false); assert.equal(storage.readAppearance(), "light");
  } finally { if (original) Object.defineProperty(globalThis, "localStorage", original); else delete globalThis.localStorage; }
});
test("manifest has stable identity, standalone scope and original valid PNG icons", async () => {
  const manifest = JSON.parse(await readFile(new URL("apps/web/public/site.webmanifest", root), "utf8"));
  assert.equal(manifest.id, "/"); assert.equal(manifest.scope, "/"); assert.equal(manifest.display, "standalone");
  for (const size of [192, 512]) { const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`); assert.ok(icon); const png = await readFile(new URL("apps/web/public" + icon.src, root)); assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size); }
});
test("install prompt is one-shot and app updates never reload without consent", async () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document, originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const window = new EventTarget(), workers = new EventTarget(), registration = new EventTarget(), display = new EventTarget(); let reloads = 0, prompts = 0, messages = 0;
  display.matches = false; window.matchMedia = () => display; window.isSecureContext = true; window.location = { reload: () => reloads++ };
  registration.waiting = null; workers.register = async () => registration;
  try { globalThis.window = window; globalThis.document = { readyState: "complete" }; Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serviceWorker: workers } });
    const pwa = await moduleAt("apps/web/src/lib/pwa.ts"); pwa.startPwa(true); await Promise.resolve();
    workers.dispatchEvent(new Event("controllerchange")); assert.equal(reloads, 0);
    assert.equal(await pwa.promptInstall(), "manual");
    const event = new Event("beforeinstallprompt", { cancelable: true }); event.prompt = async () => { prompts++; }; event.userChoice = Promise.resolve({ outcome: "accepted" }); window.dispatchEvent(event);
    assert.ok(event.defaultPrevented); assert.ok(pwa.getInstallState().canPrompt); assert.equal(await pwa.promptInstall(), "accepted"); assert.equal(await pwa.promptInstall(), "manual"); assert.equal(prompts, 1); assert.equal(pwa.getInstallState().standalone, false);
    registration.waiting = { postMessage: value => { assert.equal(value.type, "SKIP_WAITING"); messages++; } }; pwa.applyAppUpdate(); workers.dispatchEvent(new Event("controllerchange")); assert.equal(messages, 1); assert.equal(reloads, 1);
  } finally { globalThis.window = originalWindow; globalThis.document = originalDocument; if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator; }
});
for (const [name, run] of tests) { await run(); console.log(`✓ ${name}`); }
console.log(`${tests.length} web safety/PWA tests passed`);
