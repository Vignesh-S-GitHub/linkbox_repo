# LinkBox

A mobile-first temporary shared-download app using the approved LinkBox assets. The UI is unchanged by the database migration.

## Current status

LinkBox V1 supports real magnet submission, progress, folder browsing, HLS/native media playback, direct file downloads, community cleanup after 3 hours, and automatic expiry after 24 hours. The approved UI remains unchanged. Your single account uses its **actual Seedr quota**, not the 9.5 GB demo pool. Only downloads created through LinkBox are shared or cleanup-managed; existing personal Seedr files are not imported.

**Supabase is no longer used.** Cloudflare Pages serves the frontend, Workers runs the privileged API, **D1 stores metadata**, and Worker Cron Triggers schedule cleanup. Actual downloaded files stay exclusively on Seedr. No media is stored in Pages, Workers, D1, GitHub or an R2 bucket.

## Architecture

```text
Browser → Cloudflare Pages (React/Vite) → Cloudflare Worker API → Seedr
                                              │
                                              └→ Cloudflare D1 (metadata only)
Cloudflare Cron (hourly) → Worker cleanup → Seedr deletion + D1 metadata
```

Pages provides a static frontend without a running server. Workers keeps tokens and privileged operations off the browser. D1 provides persistent, Worker-bound metadata without a database password or another provider. Cron calls the same protected, idempotent cleanup service.

## Project structure

```text
apps/web/                    React, Vite, TypeScript, Tailwind and brand assets
apps/worker/src/database/    D1 implementation; in-memory mock implementation
apps/worker/src/seedr/       Mock/live adapters, verified PAT API and ownership checks
apps/worker/src/cleanup/     Shared community/automatic cleanup logic
apps/worker/migrations/      Active Cloudflare D1 SQLite migrations
apps/worker/wrangler.toml    Local/production D1 bindings, vars and hourly Cron
packages/shared/            Public API types (no tokens or internal account IDs)
scripts/                    Private Seedr connection/setup helpers
supabase/migrations/        Historical unused SQL only; DO NOT apply it
```

The old Supabase runtime adapter and environment requirements were removed. Historical SQL is retained locally for reference, not run or deployed. Existing private config may still contain unused old values; the app does not read them. Cloudflare D1 `linkbox-metadata` was created for this application and its active migration applied on 2026-10-04.

## Local development

Use a current supported Node.js version with `node:sqlite` (Node 22.13+ or newer) and npm. This project's SQL tests run directly against SQLite without installing another database package.

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm ci --cache .npm-cache
npm run db:migrate:local
npm run dev
```

Open `http://localhost:5173`; API: `http://localhost:8787`. Keep the terminal open. Stop an existing dev session before restarting on those ports.

The migration command is **local only**, needs no Cloudflare login, and initializes the D1 database in ignored Wrangler state. Local D1 persists across restarts; do not delete `apps/worker/.wrangler/state` if you need that metadata. No tables are reset automatically. Mock mode deliberately uses in-memory synthetic metadata/files instead of the live D1 database, and resets on restart.

If `spawn EPERM` prevents helper processes from running inside an agent session, run these standard commands in normal PowerShell. Do not disable security software or bypass process restrictions.

See [LOCAL_TESTING.md](LOCAL_TESTING.md) for the UI checklist.

## Seedr credentials and actual-account storage

Never paste your token into chat or a `VITE_` variable. To replace the old token with your new token privately:

```powershell
npm run seedr:configure
```

The hidden prompt verifies quota before atomically saving the token to ignored `apps/worker/.dev.vars`. It configures one enabled account with `SEEDR_MODE=live` and `SEEDR_ACCESS=full`, using actual `space_max` capacity. Required scopes are `account.read`, `files.read`, `files.write`, `tasks.read`, `tasks.write`, and `media.read`. Restart dev afterwards. `SEEDR_ACCESS=storage-only` remains an explicit emergency read-only switch that disables file actions and Cron.

`npm run seedr:check` performs a private, non-persistent quota diagnostic. Neither command changes or deletes Seedr files. A non-expiring full-access token is especially sensitive: use only the required scopes where possible and revoke/rotate it if exposed. An account-wide token does not authorize the app to delete your existing personal files.

[SEEDR_LOCAL_SETUP.md](SEEDR_LOCAL_SETUP.md) covers token setup. D1 does not store the token, only its secret-key reference.

## Mock mode

Set `SEEDR_MODE=mock` in local Worker vars to use credential-free fixtures. The demo models 5 GB + 4.5 GB accounts, 6.2 GB used, progress, readiness, folder browsing, synthetic previews, playback availability, download and deletion. No real torrents are fetched. Its five files have generic fixture names.

```text
magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Sample%20Video.mp4&xl=1073741824
```

Use this synthetic hash only in mock mode. Mock downloads are labelled text fixtures, previews are synthetic, and playback uses an external CC0 sample. None proves live file delivery.

## Storage and lifetime

- Live single-account storage uses the actual connected quota.
- The 9.5 GB logical pool exists only in the original two-account mock configuration.
- An entire item must fit one account; combined free space is never treated as contiguous.
- Known-size account selection uses best fit. Seedr has no documented size-only magnet preflight: unknown-size tasks choose the account with most free space, one transferring item per account, and rely on Seedr to reject an item that cannot fit. `xl` is never trusted. After metadata resolves, oversized app-owned content is stopped/removed and marked failed. Exact requested/free/shortfall numbers are shown only when size is known; unknown-size errors say metadata is pending.
- First 3 hours: protected. At 3 hours: cleanup eligible. At 24 hours: automatic deletion due.
- Community cleanup is offered when storage is needed, not as encouragement to delete randomly.
- D1 enforces lifecycle timestamps, foreign keys, status/progress constraints and active-magnet uniqueness.
- One conditional SQL `UPDATE … RETURNING` atomically claims cleanup across Worker instances.
- Progress updates cannot undo claims or resurrect deleted records.
- Cleanup errors release only their own claim. A claim abandoned for 5 minutes is atomically reclaimable; missing tasks/folders are successful idempotent cleanup. One outage does not skip other due items.
- Hourly Cron selects up to 8 expired records. Normal cleanup occurs within approximately one cycle after 24 hours; outages may delay removal. Expired playback/download access is blocked immediately even before physical removal.

D1 stores only account metadata and app-managed download records. User-facing API responses explicitly omit internal account IDs, remote IDs, secret references and tokens.

## Cloudflare D1 setup

The connected account already has `linkbox-metadata`, bound as `DB` in both Wrangler environments. Do not create a duplicate database. For a different Cloudflare account, use:

```powershell
cd C:\Users\shanm\Projects\LinkBox\apps\worker
npx wrangler login
npx wrangler d1 create linkbox-metadata
```

For a different account, replace `account_id` and **both** `database_id` values in `wrangler.toml` with the newly created database's UUID. Set the correct production Pages URL for `ALLOWED_ORIGIN`. The bindings are named `DB`; production repeats them because environment bindings are not inherited. Never set `remote=true` for routine local testing.

Then apply the active D1 migration remotely:

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm run db:migrate:remote
```

Do not run the historical PostgreSQL migration. No Supabase URL, API key, service-role secret, Storage bucket or project is needed.

## Worker deployment and secrets

From `apps/worker`:

```powershell
npx wrangler secret put SEEDR_ACCOUNT_A_TOKEN --env production
npx wrangler deploy --env production
```

Enter the token at Wrangler's private prompt. Production V1 uses `SEEDR_MODE=live`, `SEEDR_ACCESS=full`, one actual account and hourly Cron. Its allowed origin is `https://linkbox-repo.pages.dev`. Apply all D1 migrations **before** deploying changed Worker code. For read-only operation explicitly set `SEEDR_ACCESS=storage-only` and redeploy.

D1 uses a platform binding, not a public database endpoint. The Pages frontend has no direct D1 access. Worker secrets hold credentials; D1 stores only references.

## Cloudflare Pages deployment

After successful local checks, push the source to GitHub without ignored secrets/state. Create a Cloudflare Pages project from the repository:

```text
Root directory: /
Build command: npm run build --workspace=@temporary-share/web
Build output directory: apps/web/dist
Public environment: VITE_API_URL=https://temporary-seedr-share-api.vigneshshanmugam.workers.dev
Node version: 24 (NODE_VERSION environment variable)
```

Set Worker `ALLOWED_ORIGIN` to the exact Pages origin. Frontend public variables must never contain Seedr or Cloudflare credentials.

`.github/workflows/quality.yml` checks lint, types, all tests and both production builds on pull requests and main changes. It needs no Seedr/Cloudflare secrets. Pages performs frontend auto-deploy from GitHub; Worker source changes must be deployed separately with the command above. Pages build success alone does not deploy the Worker.

## Cron configuration and testing

Default and production configuration both specify `0 * * * *` (hourly UTC). The Worker `scheduled()` handler performs database selection, atomic claims, Seedr deletion and metadata/storage updates. **Storage-only mode returns without cleanup**; it does not touch personal files.

For a separate local Cron test, stop the running Worker first:

```powershell
cd C:\Users\shanm\Projects\LinkBox\apps\worker
npm run dev:cron
# In another terminal:
Invoke-WebRequest 'http://localhost:8787/__scheduled?cron=0+*+*+*+*'
```

Use mock mode for safe synthetic cleanup tests. In current Wrangler, you can also invoke the local handler at `http://localhost:8787/cdn-cgi/local/scheduled`. Do not alter production timestamps to speed up testing. Live Cron deletes only expired, ownership-verified LinkBox folders/tasks.

## Environment configuration

`.env.example` contains sanitized Worker settings. `apps/worker/.dev.vars` is private/ignored; keep existing tokens there, never in source or examples.

| Setting | Purpose |
| --- | --- |
| `DB` | D1 binding in Wrangler; not an environment secret |
| `SEEDR_MODE` | `mock` or `live` |
| `SEEDR_ACCESS` | `full` for V1; `storage-only` explicitly disables file operations/Cron |
| `SEEDR_ACCOUNT_CONFIG` | Internal account metadata and secret references |
| `SEEDR_ACCOUNT_A_TOKEN` | Private Seedr PAT in Worker secrets |
| `ALLOWED_ORIGIN` | Exact permitted frontend origin |
| `MAX_FILE_SIZE_BYTES` | Maximum entire item size |
| `MAX_ACTIVE_DOWNLOADS` | Shared active-submission cap, default 8 |
| `SUBMISSION_COOLDOWN_SECONDS` | D1-backed 30-second session/IP cooldown |
| `TURNSTILE_SECRET_KEY` | Optional server verification; keep unset unless a frontend token is supplied |
| `VITE_API_URL` | Public Worker URL only |

## Adding another Seedr account

Append an enabled object to `SEEDR_ACCOUNT_CONFIG` with an internal ID, label, actual capacity and a distinct `secretKeyReference`. Store that token with `wrangler secret put`. D1 upserts metadata during storage refresh; no seed migration or selection rewrite is necessary. Removed accounts retain metadata history but are disabled when remaining accounts sync.

Full mode handles up to 8 configured accounts without rewriting selection logic. IDs and token references must be distinct, and capacities must be positive whole byte counts. Keep disabled accounts and their credentials configured until their old records are cleaned; removing an account or token immediately prevents cleanup of those records. No individual download spans accounts.

## Switching mock → full live

The signed-in [official Seedr API reference](https://www.seedr.cc/api/v0.1/console/documentation), inspected on 2026-10-04, documents PAT Bearer authentication at `https://www.seedr.cc/api/v0.1/p`, quota reads, tasks, filesystem operations and temporary delivery URLs. Quota field names, byte counts and actual account access have been tested.

Task/folder mapping, temporary delivery and ownership-scoped deletion were verified with a Creative Commons sample. Each download gets an isolated `LinkBox-<public UUID>` folder. D1 admission is persisted before Seedr writes; folder/task IDs are checkpointed before subsequent operations. Uncertain POSTs are reconciled by the exact owned folder rather than blindly replayed. Use the hidden setup helper, apply local migrations, start dev, then test an authorized magnet.

### Verified API and limitations

- API Console's **endpoint form** documents `POST /tasks` JSON fields `torrent_magnet` and `folder_id`. Its generic code example uses obsolete `url` / `save_folder_id`; those returned HTTP 422 and are not used.
- `POST /fs/folder` uses `name` / `parent_id`. The task's `folder_id` must match the isolated parent; completed content is traversed only beneath that parent. IDs are not interchangeable.
- `GET /download/file/{id}/url` returns a temporary URL. Documented `GET /presentation/fs/item/{id}/video/url` returns HLS; browser playback lazy-loads the **full HLS.js build**, including alternate audio and subtitles, with native play/pause/seek controls. The previous light build omitted separate audio renditions; Sintel's real stream has one and requires the full build. No media proxy is used. Modern `/presentations/file/{id}/video` returned HTTP 400 in the test, so the working documented compatibility endpoint is used.
- Folder/type metadata is provider-confirmed, not guessed from dots in the torrent title. `0003_content_type.sql` adds nullable kind/count columns; old ready records are backfilled by read-only owned-folder contents, at most two per request, once successful, with a five-minute retry lease. Lifetimes and Seedr files are unchanged. SQLite's non-STRICT integer affinity preserves decimal progress; tests cover 1.6% and 6.15%. Pending tasks retain Seedr's numeric percentage, with visible-tab polling every 15 seconds and a slow-peer explanation (not an invented ETA or peer count).
- The simplified player adds **Audio** and **Quality** only, alongside basic native playback controls. Audio language selection is enabled only for multiple real HLS/native tracks. HLS quality choices come from the actual manifest (Auto plus supplied resolutions/bitrates); one supplied level is shown without an artificial choice. Native HLS/MP4 quality is managed by the browser when it exposes no level-selection API. No subtitles, speed, fit/fill, extra seek toolbar, or picture-in-picture UI is added; native speed/PiP options are disabled where browsers honor these hints.
- Browser/platform codec support still governs sound. The full HLS build handles separate AAC tracks; it cannot make an absent audio stream or unsupported Dolby codec playable. The stream may offer fewer audio languages or quality levels than the original file. This app does not transcode, invent resolutions, or promise all features of Seedr's own player. Native iOS volume may use system controls.
- The full HLS chunk is approximately 185 KB gzip, downloaded only on playback. Vite can report its >500 KB uncompressed chunk warning; this is an intentional existing-library capability tradeoff, not a failed build. Home/Files do not load the player library.
- Whole-folder archive initialization has an undocumented request-body schema; V1 offers **individual file downloads** instead of inventing ZIP requests. Folder entries are flattened, bounded to 8 folders / 1,000 files; exceptionally large/deep trees fail safely.
- Each invocation allows at most 48 authenticated Seedr API requests. The optional verification request or body-free delivery HEAD check still keeps the invocation below the free Worker's 50 external-subrequest limit. Unusually expensive reconciliation/cleanup resumes on a later polling or Cron cycle rather than exceeding that budget. Provider outages can delay physical deletion; delivery is blocked as soon as the 24-hour deadline passes.
- Supported media is determined by Seedr's file flags; codecs, transcoding readiness and plan restrictions can still prevent playback. Images/PDFs use direct native previews when the browser supports them; other files remain downloadable.
- Expiring Seedr delivery URLs are bearer capabilities. They contain no account PAT, but anyone receiving a copied temporary URL may use it until Seedr expires it. Already-issued direct links cannot be instantly revoked by D1; deleting the source removes the file.
- Seedr issued URLs returning 404 for the sample's subtitle/poster sidecars while its video worked. Download/preview delivery now verifies availability with a body-free HEAD request and shows a safe error for unavailable files. No account token is sent to the CDN, and no file body passes through the Worker. Listing a file does not guarantee Seedr can deliver it.
- All files placed inside an app-owned folder are temporary/shared. Do not manually move personal content into these folders or rename them; ownership mismatches fail closed. D1 backups do not restore deleted Seedr media.
- Optional Turnstile is architected/server-verified, not enabled by default. If enabled, clients must supply `turnstileToken`; no widget is configured for this release. CORS is not authentication and public anonymous access cannot be made abuse-proof with cooldowns alone.

## Security and remaining production work

Magnet validation, bounded request bodies, CORS, public UUIDs, safe errors, duplicate constraints, cleanup validation and server-only tokens are implemented. Anonymous browser identifiers contain no requested email, name, phone or location. Polling is 15 seconds for pending transfers, otherwise 60 seconds, only while visible.

Submission leases, cooldowns (hashed session and daily hashed Cloudflare IP), and polling leases are durable in D1 across isolates. Active downloads are capped at 8; request bodies and provider JSON are bounded, redirects never forward PATs, and all public IDs are opaque. Only app-managed metadata/files are exposed. Ready-state polling stops, quota is cached for 60 seconds, and at most two transferring rows are refreshed per request. Guard rows are pruned by Cron. This is a shared anonymous service: monitor quotas, restrict the allowed origin and use the read-only switch if abuse occurs. Avoid non-expiring account-wide tokens where a short-lived narrowly scoped PAT suffices.

## Free-tier considerations

Use Cloudflare Workers Free and D1 Free; no paid plan, queue, always-on server or R2 bucket is necessary for this metadata-only architecture. Current D1 free allowances are **5 million rows read/day, 100,000 rows written/day and 5 GB total storage**. Exceeding free quotas causes errors rather than making free usage unlimited. Indexes, small metadata records and bounded polling help keep light usage within them. Check [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) before launch.

Seedr plan capacity and API feature eligibility are separate. No ₹0 guarantee can override provider quotas, Seedr plan restrictions or changing terms. All multi-gigabyte media delivery must remain direct from Seedr.

## Quality gate

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Tests include existing mock API/business coverage, private-token setup, and real SQLite execution of the D1 schema/queries: account upserts, constraints, injection-safe bindings, 3-hour/24-hour boundaries, duplicate prevention, concurrent cleanup, stale progress, failed cleanup retry and idempotent expiry. SQLite tests do not replace Wrangler-runtime and credential-dependent end-to-end tests.

## Troubleshooting

- D1 unavailable: run `npm run db:migrate:local`, check the `DB` binding and restart dev.
- Live storage but no files: expected in storage-only mode; no mock or personal files are imported.
- Storage 503: check the private PAT/config; manual redirects are rejected and tokens never forwarded.
- Fragmented storage: a file must fit one account even when aggregate free space looks sufficient.
- Old file pending cleanup: Cron runs hourly; provider outages retry next cycle and stale claims recover after 5 minutes. Storage-only never deletes.
- Build/migration `spawn EPERM`: run the normal commands in user PowerShell and report the output; do not bypass security.
