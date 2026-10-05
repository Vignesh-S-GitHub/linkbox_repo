# Local LinkBox testing

## Start here

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm ci --cache .npm-cache
npm run db:migrate:local
npm run dev
```

Open `http://localhost:5173`. The Worker listens on `http://localhost:8787`. Keep the terminal open; press Ctrl+C to stop. Alternatively run `npm run dev:worker` and `npm run dev:web` in separate terminals. Both ports are fixed: if occupied, stop the existing service instead of silently starting the frontend on another origin.

The ignored `.dev.vars` connects your real account in full V1 mode; do not overwrite its private token. For the synthetic checklist below, deliberately set `SEEDR_MODE=mock` and restart. Mock data remains isolated in memory; live metadata persists in local D1. Both modes keep media off application infrastructure.

## Smoke check

```powershell
Invoke-RestMethod http://localhost:8787/api/storage
Invoke-RestMethod http://localhost:8787/api/downloads
```

Mock storage is 9.5 GB total with generic fixtures. Full live storage uses actual quota and lists only LinkBox-created downloads. Existing personal Seedr files never appear. Responses must not expose credentials or internal remote/account IDs.

## Real V1 workflow

1. Paste an authorized magnet on Home. Follow metadata/progress until Ready; refresh is bounded to 15 seconds while visible.
2. Open its folder, search entries, play a supported video/audio file, and download an individual file directly from Seedr. On supported browsers, image/PDF previews are native.
3. Open File details: expiry is 24h, with no protection or cleanup-eligibility row. A new item has Delete my download in its root menu/progress page only in the browser that added it. Confirm deletion using disposable authorized content; other browsers must receive 403.
4. Submit the same magnet again: it must return 409 duplicate. Storage is refreshed from Seedr, never invented from fixture data.
5. Storage-full explains how to delete your own items or wait for expiry, with Go to files and Cancel. There are no community-cleanup checkboxes. The removed `/cleanup` route returns 404 in full/mock mode. Refresh after owner deletion and verify saved app links are unavailable.
6. Cron removes app-owned expired files after 24h. Local handler: `Invoke-WebRequest http://localhost:8787/cdn-cgi/local/scheduled`. Do not accelerate production expiry or expose admin/testing endpoints.

The integration smoke test used the Creative Commons Sintel torrent listed by [WebTorrent](https://webtorrent.io/free-torrents). Its small sample is legal test content, not a generic fixture for public UI. Time-accelerated checks change **only disposable local D1 records**, never production records or retention rules.

## Browser checklist

1. Home: original logo, magnet input, recent files and See all. Invalid links show an inline error, never an alert.
2. Files: All/Downloading/Ready filters work and storage opens the Storage page.
3. Add the mock video below. Progress opens, moves through metadata/downloading/processing/ready, and then Go to files works. Polling may add up to 15 seconds to each displayed transition.
4. Play a ready video: the external CC0 sample opens with native controls. An internet connection is required for this sample; application infrastructure does not store it.
5. Download: a `linkbox-mock-download.txt` synthetic fixture is saved. It is intentionally not a torrent's original content.
6. Open Project Files when ready: seven source-defined entries are listed, search filters them, video opens the player and document opens the guide preview.
7. Guide: Previous/Next page works across 12 synthetic guide pages.
8. Actions sheet: Copy link, Share where supported, File details, and Unavailable navigation work. Escape closes the sheet. Cleanup is not offered here.
9. Settings: System/Light/Dark persists on reload. About accordions explain owner-only deletion and the 24-hour lifetime.
10. Storage-full: use the 4 GB mock magnet below before adding other large fixtures. It reports contiguous available space and directs you to Files; it never offers someone else's files for deletion. Files cannot span accounts.
11. A deleted file's saved public link should show File unavailable, not a usable player.
12. Resize to 360, 390 and 430 px and desktop. Check tap targets, file-name truncation, bottom navigation and absence of horizontal scrolling.

### Harmless mock video

```text
magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Test%20Video.mp4&xl=1073741824
```

### Storage-full example

```text
magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Test%20Archive.zip&xl=4294967296
```

These hashes are synthetic, not real-content download instructions. Only use them in mock mode. Wait 30 seconds between successful submissions. Back to files leaves the progress view without canceling; Delete my download opens the existing permanent-deletion confirmation.

## Quality gate

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

The automated tests simulate time to verify that owners can delete at any age, strangers cannot, and automatic cleanup begins at exactly 24 hours. Wrangler's production Cron Trigger is not a running local clock. The live local scheduled handler was verified against a disposable app-owned Seedr download, including repeated expiration; production timestamps were not altered. Production Cron itself runs on the configured hourly schedule.

The D1 test runner executes the actual SQLite migration and bound SQL through a small binding facade. It covers account upserts, duplicate/lifecycle constraints, ownership, expiry, simultaneous cleanup, failed-delete retry, and stale progress updates. It is not a replacement for Wrangler runtime testing. See README for `dev:cron` and remote D1 deployment steps. Never delete local Wrangler state to fix a migration without backing up needed metadata.

## Troubleshooting

- Connection banner: ensure both services started; check `http://localhost:8787/api/storage` and terminal errors.
- EADDRINUSE / port occupied: stop the old development instance using its original terminal.
- npm cache permissions: use `npm ci --cache .npm-cache` in this project.
- `spawn EPERM`: the process could not launch a helper. Do not disable security tools or bypass the sandbox. Record the error and run these standard commands in a normal user PowerShell terminal if the agent execution environment is the source of the restriction.
- Mock state disappears on restart: expected for the in-memory adapter and database.
- Real Seedr testing: use `npm run seedr:configure` with the required PAT scopes, apply D1 migrations, then restart. Never paste credentials into chat or `VITE_` variables.

## Deployment later

GitHub and Cloudflare are connected. Pages builds the frontend from main automatically. Apply remote D1 migrations and deploy the Worker separately after the release checks pass. See README.
