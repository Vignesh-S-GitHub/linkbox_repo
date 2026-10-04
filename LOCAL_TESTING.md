# Local LinkBox testing

## Start here

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm ci --cache .npm-cache
npm run db:migrate:local
npm run dev
```

Open `http://localhost:5173`. The Worker listens on `http://localhost:8787`. Keep the terminal open; press Ctrl+C to stop. Alternatively run `npm run dev:worker` and `npm run dev:web` in separate terminals. Both ports are fixed: if occupied, stop the existing service instead of silently starting the frontend on another origin.

The ignored `.dev.vars` currently connects your real account in live storage-only mode; do not overwrite its private token. For the synthetic checklist below, deliberately set `SEEDR_MODE=mock` and restart. No external database, Cloudflare login, Seedr credentials or GitHub upload is necessary for mock testing. `npm run dev` uses Wrangler's local runtime, not a deployed Worker. The local D1 migration initializes persistent metadata for future full live operation; mock data remains isolated in memory.

## Smoke check

```powershell
Invoke-RestMethod http://localhost:8787/api/storage
Invoke-RestMethod http://localhost:8787/api/downloads
```

In mock mode, storage is 9.5 GB total and 6.2 GB used and five mock files appear. In live storage-only mode, storage reflects the actual connected quota and the file list is empty. Responses must not contain credentials, internal storage account IDs or remote Seedr item IDs.

## Browser checklist

1. Home: original logo, magnet input, recent files and See all. Invalid links show an inline error, never an alert.
2. Files: All/Downloading/Ready filters work and storage opens the Storage page.
3. Add the mock video below. Progress opens, moves through metadata/downloading/processing/ready, and then Go to files works. Polling may add up to 15 seconds to each displayed transition.
4. Play a ready video: the external CC0 sample opens with native controls. An internet connection is required for this sample; application infrastructure does not store it.
5. Download: a `linkbox-mock-download.txt` synthetic fixture is saved. It is intentionally not a torrent's original content.
6. Open Project Files when ready: seven source-defined entries are listed, search filters them, video opens the player and document opens the guide preview.
7. Guide: Previous/Next page works across 12 synthetic guide pages.
8. Actions sheet: Copy link, Share where supported, File details, and Unavailable navigation work. Escape closes the sheet. Cleanup is not offered here.
9. Settings: System/Light/Dark persists on reload. About accordions explain the 3-hour protection and 24-hour lifetime.
10. Storage-full: use the 4 GB mock magnet below before adding other large fixtures. Protected items have no cleanup checkbox. Selecting an eligible file and Free space & continue deletes selected files and retries the pending submission; files cannot span accounts.
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

These hashes are synthetic, not real-content download instructions. Only use them in mock mode. Wait 30 seconds between successful submissions. The progress view's Cancel leaves the view; it does not delete or cancel a protected shared download.

## Quality gate

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

The automated tests simulate time to verify the protection and expiry boundaries without waiting 24 hours. Wrangler's production Cron Trigger is not a running local clock; local expiry tests exercise the cleanup function. Scheduled production deletion still needs an integration check before deployment.

The D1 test runner executes the actual SQLite migration and bound SQL through a small binding facade. It covers account upserts, duplicate/lifecycle constraints, protection, expiry, simultaneous cleanup, failed-delete retry, and stale progress updates. It is not a replacement for Wrangler runtime testing. See README for `dev:cron` and remote D1 deployment steps. Never delete local Wrangler state to fix a migration without backing up needed metadata.

## Troubleshooting

- Connection banner: ensure both services started; check `http://localhost:8787/api/storage` and terminal errors.
- EADDRINUSE / port occupied: stop the old development instance using its original terminal.
- npm cache permissions: use `npm ci --cache .npm-cache` in this project.
- `spawn EPERM`: the process could not launch a helper. Do not disable security tools or bypass the sandbox. Record the error and run these standard commands in a normal user PowerShell terminal if the agent execution environment is the source of the restriction.
- Mock state disappears on restart: expected for the in-memory adapter and database.
- Real Seedr testing: do not simply change `SEEDR_MODE` to live. Verify official API access and finish the live adapter/database security work first. Do not paste passwords or tokens into chat or `VITE_` variables.

## Deployment later

No source has been pushed and no Cloudflare service has been deployed as part of this local setup. Deployment should follow only after local browser/build checks and the credential-dependent integration are validated.
