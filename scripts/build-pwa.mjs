import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const dist = new URL("../apps/web/dist/", import.meta.url);
const html = await readFile(new URL("index.html", dist), "utf8");
const assets = (await readdir(new URL("assets/", dist))).filter(name => /^[A-Za-z0-9_.-]+\.(?:js|css)$/.test(name)).sort();
const icons = (await readdir(new URL("brand/04_ui_icons/svg/", dist))).filter(name => /^[a-z-]+\.svg$/.test(name)).sort();
const precache = ["/index.html", "/site.webmanifest", ...assets.map(name => `/assets/${name}`),
  ...icons.map(name => `/brand/04_ui_icons/svg/${name}`),
  "/brand/02_app_icons/linkbox-192x192.png", "/brand/02_app_icons/linkbox-512x512.png",
  "/brand/02_app_icons/linkbox-180x180.png", "/brand/03_favicons/favicon.ico",
  "/brand/01_logo/png/linkbox-logo-full-transparent.png", "/brand/01_logo/png/linkbox-wordmark-transparent.png"];
// Include template changes in the version so a policy-only update gets a separate cache.
const template = await readFile(new URL("../apps/web/public/sw.js", import.meta.url), "utf8");
const digest = createHash("sha256").update(html).update(template).update(JSON.stringify(precache));
for (const path of precache) digest.update(await readFile(new URL(path.slice(1), dist)));
const version = digest.digest("hex").slice(0, 16);
const output = template.replace("__LINKBOX_BUILD__", version).replace('["__LINKBOX_ASSETS__"]', JSON.stringify(precache));
await writeFile(new URL("sw.js", dist), output);
console.log(`PWA shell ${version}: ${precache.length} static assets (${fileURLToPath(dist)}). No API/media caching.`);
