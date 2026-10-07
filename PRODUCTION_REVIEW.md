# LinkBox production review — 6 October 2026

## Scope and release boundary

Review of the approved V1 React frontend, Cloudflare Worker, D1 statements/migrations, Seedr adapter boundary, Cron lifecycle and build pipeline. The existing logo, light/dark themes and native-player controls are preserved. The follow-up deletion-policy change protects downloads from other users for 3h, then permits shared deletion; the creator can delete anytime from the submitting browser. Hourly 24h expiry remains unchanged. No new provider endpoint, paid infrastructure, Seedr account privilege or database migration is introduced. Only app-managed files remain in scope for deletion; media stays on Seedr.

This review reduces identified risks; it cannot guarantee zero future failures. The changes are prepared separately from the live release and require merge/deployment approval. Tests use synthetic data, an isolated secret-free mock Worker and SQLite; no real Seedr magnet was submitted or deleted and production Cron was not invoked during this review.

## Issues corrected

| Finding | Correction |
| --- | --- |
| Two newest pending files could consume every refresh, starving older transfers | D1 selects at most two least recently polled eligible records; atomic leases still prevent duplicate work across isolates |
| Quota outage erased otherwise valid files and the open player | Independent settled responses preserve last-known state, with a stale-information warning |
| Overlapping visibility/timer refreshes or an older response could overwrite a local add/delete | Deduplicated refresh coordinator, cancellation on local mutations/unmount, visible/online-only polling |
| Browser HTTP calls could hang indefinitely or encourage duplicate POST retries | 60-second read / 120-second write timeouts; uncertain writes explicitly advise checking Files; no automatic POST retry |
| Repeated rejected full-storage attempts could call Seedr quota before cooldown | Session/IP cooldown moved before quota/metadata requests, after duplicate checking |
| Account labels accepted 128 characters but D1 permitted only 100 | API, configuration and input consistently use the database's 100-character limit |
| Confirmed task-token permission rejection was treated as uncertain acceptance | 401/403-derived permission errors fail immediately with a safe message; no replay or automatic cross-account retry |
| Blocked local storage could crash preference/identity initialization | Safe storage access and in-memory session fallback; permission-loss limitations documented |
| Static frontend lacked a restrictive security policy | Pages CSP, frame denial, MIME protection, referrer policy and disabled camera/mic/location |
| Known vulnerable source-map and local-runtime transitive packages | Targeted compatible patch overrides and lockfile; high-severity npm audit added to CI |

## App installation

Padded 192px/512px app icons with regular/maskable manifest entries, stable manifest identity/scope, standalone display, a padded 180px Apple touch icon/metadata and a production-only versioned service worker. The website logo is unchanged. Settings offers native installation when supported, otherwise Android/iOS/Windows instructions. App updates require user action or closure of old windows; playback is not automatically interrupted.

The service worker intercepts only same-origin public app navigations and narrowly allowed static assets. It bypasses API/admin requests, POST, credential/session headers, Range requests, signed asset queries and all third-party media. It checks response MIME types, bounds runtime caching and cleans only its own versioned caches. No background media download, offline data queue or personal/account cache exists.

The canonical offline HTML is installed together with its versioned bundles and original UI icons; online navigation cannot overwrite it with a different release's HTML. Stalled navigation falls back to that shell after eight seconds. External fonts are not cached, so offline rendering may use the system font.

## Verification

- Final local recheck on 7 October 2026: lint and TypeScript checking of frontend, Worker and shared types; 137 automated tests passed (48 business, 41 D1, 15 live-adapter fixture, 14 connection helper, 3 admin helper and 16 web/PWA).
- Business/security tests and real SQLite execution of the D1 migration/statements, including races, ownership, fair polling, provider failures, contiguous account fit, metadata timeouts and exact expiry.
- Web safety/PWA tests for request timeout/cancellation, no POST replay, stale-refresh rejection, blocked storage, cache exclusions, offline shell, MIME rejection, scoped cache cleanup, explicit update activation, one-shot install prompt, actual icon dimensions and decoded artwork pixels wholly inside the 40%-radius mask-safe circle. Corrected assets were visually inspected; this is not an OS installation test.
- Frontend production build and Worker deployment dry-run, without production writes.
- Full dependency audit and lockfile dry-run validation.
- Isolated workerd runtime checks for mock quota, validation, submission/list, duplicate rejection, owner/stranger delete, idempotent delete, expired delivery, folder contents/playback link, admin/origin rejection and local scheduled handler.
- Exact multi-account live-adapter fixture: first account 4.8 GB used of 5 GB, admin-added second account 4.5 GB free, authoritative 2 GB transfer. Folder/task writes used only the second token and progress became 1.6% without exposing account details. A missing-task warning is not evidence of account misrouting; real provider acceptance cannot be inferred from a saved empty-folder checkpoint.
- Browser QA of home, inline magnet validation, mock submission/progress, files/folders, native video/audio, mock document preview, storage, Settings/install instructions, account lock and informational/unavailable pages. Responsive targets: 360, 390, 430 and desktop. A simulated quota failure preserved the file list and recovered via Retry; the cached app shell and its original icons loaded with the local server stopped. Explicit app-update activation was also exercised.

Automated tests and mock runtime checks do **not** prove the user's device audio output, every real codec, a long-running Seedr transfer, or OS installation. Android/iOS/Windows device installation must be confirmed by the user after deploying the HTTPS release. Native/HLS playback is limited to streams, quality and codecs Seedr supplies and the browser supports. Direct download links are bearer delivery capabilities: keep them private; the provider may expire them.

## Operational limits to retain

1. Public anonymous usage is not abuse-proof. CORS is not authentication. Cooldowns/active limits reduce submission abuse but cannot prevent a determined client exhausting read/provider/free-tier quotas. Monitor Worker/D1/Seedr quota and use the storage-only switch during an incident. Optional Turnstile has a server integration contract, but no widget is enabled; do not set its secret alone and expect the current form to work.
2. A whole download must fit one enabled Seedr account. Aggregate 9.5 GB cannot accommodate an 8 GB item on 5 GB + 4.5 GB accounts. Authoritative Seedr size may arrive only after submission; impossible sizes terminate safely once known. Unknown metadata is bounded; actual slow known-size transfers are not timed out merely for low peer counts.
3. Cron runs hourly. Seedr outages or the bounded eight-record batch can delay deletion beyond one cycle. Failed cleanup remains retryable and stale claims recover after five minutes. Check overdue counts periodically; never remove an account token while it still has active/expired LinkBox records.
4. Deleted metadata/tombstones are currently retained. Growth is modest under light usage, but operators should monitor D1 storage and define a retention/backup policy before larger usage. This review does not silently purge history. D1 backups cannot restore deleted Seedr files.
5. Worker/D1/provider free tiers are finite and can change. No unlimited-use or permanent ₹0 guarantee is possible. No paid services are added by this release.
6. Native media/browser installation and clipboard behaviour vary by device. No transcoding or original-resolution guarantee is added. External players may use the original direct delivery link when its codec/protocol is supported.
7. Downloads are protected from other users for 3 hours; the creator can delete anytime using the original private browser session. After 3 hours any visitor can permanently delete them. Browser storage eviction loses creator access but does not change the shared deletion deadline. Legacy unowned records must wait 3 hours. Service-worker caching is not a file backup.
8. Private PAT/admin-key rotation must happen through Worker secrets. Avoid non-expiring full-account tokens when a narrower, expiring token is sufficient. Keep tokens, session IDs and signed media URLs out of logs/source/screenshots.
9. The lazy full HLS chunk retains separate-audio support and exceeds Vite's 500 kB warning threshold. It is a build warning, not a failed build. The install shell precaches this static code once (not media); quota-limited devices may evict caches.

## Rollout and rollback

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm audit --audit-level=high`, `npm run build`. Review GitHub quality/Pages preview checks before merging. Publish the Worker with the existing production bindings/secrets/Cron unchanged; GitHub-connected Pages publishes the frontend. No D1 migration is required. Verify manifest, `sw.js`, security headers, API/CORS, unauthenticated admin rejection, and install instructions on the production origin without adding/deleting personal files.

If a release fails, roll back the Worker to the prior verified version and Pages to the prior deployment. Service workers may keep an older shell while offline or until windows close. Reopen online or use Settings → Update app & reload. Do not reset D1 or remove secrets to roll back application code.
