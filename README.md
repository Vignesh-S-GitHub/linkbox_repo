# LinkBox

A mobile-first temporary shared-download app using the approved LinkBox assets. The UI is unchanged by the database migration.

## Current status

Work locally in `C:\Users\shanm\Projects\LinkBox`. Your single real Seedr account is connected for **storage-only** reads: the UI shows its actual quota, not the 9.5 GB demonstration pool. Real transfers, playback, delivery and deletion remain disabled until their API mappings are verified. A full-access token alone does not enable these features.

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
apps/worker/src/seedr/       Adapter interface, mock adapter, live PAT quota client
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

The hidden prompt verifies the documented quota endpoint before atomically saving the token to ignored `apps/worker/.dev.vars`. It configures exactly one enabled account using its actual `space_max` capacity and leaves `SEEDR_ACCESS=storage-only`. Restart `npm run dev` afterwards.

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
- Account selection uses best fit to reduce fragmented space.
- First 3 hours: protected. At 3 hours: cleanup eligible. At 24 hours: automatic deletion due.
- Community cleanup is offered when storage is needed, not as encouragement to delete randomly.
- D1 enforces lifecycle timestamps, foreign keys, status/progress constraints and active-magnet uniqueness.
- One conditional SQL `UPDATE … RETURNING` atomically claims cleanup across Worker instances.
- Progress updates cannot undo claims or resurrect deleted records.
- Cleanup errors release their own claim for retry; confirmed missing remote content must be handled idempotently by the adapter.
- The hourly Cron handles at most 50 expired candidates per run. With the default 8-active-item limit, normal expiry is within approximately one hour after 24 hours.

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

Enter the token at Wrangler's private prompt. Production uses `SEEDR_MODE=live`, `SEEDR_ACCESS=storage-only`, one account and hourly Cron. Its permitted origin is `https://linkbox-repo.pages.dev`. Do not flip to full access yet: unverified file operations intentionally fail closed.

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

Use mock mode for synthetic cleanup tests. Local Cron does not run automatically as a production clock. Successful triggering is not evidence of real Seedr deletion while live cleanup is disabled.

## Environment configuration

`.env.example` contains sanitized Worker settings. `apps/worker/.dev.vars` is private/ignored; keep existing tokens there, never in source or examples.

| Setting | Purpose |
| --- | --- |
| `DB` | D1 binding in Wrangler; not an environment secret |
| `SEEDR_MODE` | `mock` or `live` |
| `SEEDR_ACCESS` | `storage-only` until live file operations are verified |
| `SEEDR_ACCOUNT_CONFIG` | Internal account metadata and secret references |
| `SEEDR_ACCOUNT_A_TOKEN` | Private Seedr PAT in Worker secrets |
| `ALLOWED_ORIGIN` | Exact permitted frontend origin |
| `MAX_FILE_SIZE_BYTES` | Maximum entire item size |
| `MAX_ACTIVE_DOWNLOADS` | Shared active-submission cap, default 8 |
| `SUBMISSION_COOLDOWN_SECONDS` | Default 30-second session cooldown |
| `TURNSTILE_SECRET_KEY` | Reserved optional integration; not yet enforced |
| `VITE_API_URL` | Public Worker URL only |

## Adding another Seedr account

Append an enabled object to `SEEDR_ACCOUNT_CONFIG` with an internal ID, label, actual capacity and a distinct `secretKeyReference`. Store that token with `wrangler secret put`. D1 upserts metadata during storage refresh; no seed migration or selection rewrite is necessary. Removed accounts retain metadata history but are disabled when remaining accounts sync.

The current storage-only connection deliberately requires one account. Expanding real file pooling is a later verified integration step; the account-selection logic already handles arbitrary account counts.

## Switching mock → full live

The signed-in [official Seedr API reference](https://www.seedr.cc/api/v0.1/console/documentation), inspected on 2026-10-04, documents PAT Bearer authentication at `https://www.seedr.cc/api/v0.1/p`, quota reads, tasks, filesystem operations and temporary delivery URLs. Quota field names, byte counts and actual account access have been tested.

Before enabling full live mode, verify task response schemas, task-to-folder/file completion mapping, temporary media/download URL formats, and safe app-owned cleanup. The reference does not document a magnet-size preflight endpoint; do not assume a missing size is zero or trust a user-supplied size. Persist safe ownership before any destructive path is enabled. D1 replacing Supabase does not solve these Seedr API limitations.

## Security and remaining production work

Magnet validation, bounded request bodies, CORS, public UUIDs, safe errors, duplicate constraints, cleanup validation and server-only tokens are implemented. Anonymous browser identifiers contain no requested email, name, phone or location. Polling is 15 seconds for pending transfers, otherwise 60 seconds, only while visible.

Current cooldown/submission serialization is per Worker isolate, not globally durable. Cross-isolate submission reservations and abuse enforcement remain required before public full live writes. Turnstile is reserved but not enforced. CORS is not authentication. Cleanup claims fail closed if a process dies after claiming; automatic stale-claim reconciliation is not implemented, so investigate such rows before manually releasing them. Do not deploy this as an unrestricted public full-access account bridge.

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
- Old file pending cleanup: Cron runs hourly; live storage-only never deletes, and claimed rows need reconciliation after crashes.
- Build/migration `spawn EPERM`: run the normal commands in user PowerShell and report the output; do not bypass security.
