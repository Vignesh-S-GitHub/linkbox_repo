# Real Seedr V1 connection

LinkBox uses one actual Seedr account and its real quota. The approved theme is unchanged. Tokens are server-only; existing personal Seedr files are not imported or automatically deleted.

## Private setup

Required PAT scopes: `account.read`, `files.read`, `files.write`, `tasks.read`, `tasks.write`, `media.read`. Your full-access token can be used, but a narrower, expiring token is safer. Never paste a token/password into chat, GitHub, screenshots or a `VITE_` variable.

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm run seedr:configure
npm run db:migrate:local
npm run dev
```

The hidden prompt checks quota, then saves the PAT only in ignored `apps/worker/.dev.vars`. It sets `SEEDR_MODE=live`, `SEEDR_ACCESS=full`, and one enabled account using actual capacity. Restart dev after changing config. Open `http://localhost:5173` and submit only an authorized magnet.

`npm run seedr:check` is still a read-only unsaved diagnostic. Successful quota access alone does not prove file-write permissions. Share only sanitized error messages, never `.dev.vars`.

## Verified API contract

[Official signed-in API Console](https://www.seedr.cc/api/v0.1/console/documentation), inspected/tested 2026-10-04:

- PAT Bearer authentication, base `https://www.seedr.cc/api/v0.1/p`.
- Quota: `GET /me/quota`, numeric byte fields `space_used` / `space_max`.
- Isolated folder: `POST /fs/folder`, JSON `name` / `parent_id`.
- Magnet: `POST /tasks`, JSON **`torrent_magnet` / `folder_id`** from the endpoint form. Generic code examples using `url` / `save_folder_id` are stale and returned 422.
- Task details: `GET /tasks/{id}` → `task` with `state`, `progress`, `size`, `folder_id` / `folder_created_id`. Only the isolated parent is trusted; task IDs are never treated as file IDs.
- Contents: `GET /fs/folder/{id}/contents`, recursively bounded underneath the owned parent.
- Direct file: `GET /download/file/{id}/url` → temporary URL; range delivery verified.
- Video: documented `GET /presentation/fs/item/{id}/video/url` → HLS URL; the full lazy HLS.js build supports separate audio, with native controls only. Modern video route returned 400 for the test.
- Deletion: `DELETE /tasks/{id}` does not delete files; `DELETE /fs/folder/{id}` removes the owned content. Both are called only after validating ownership and task association, and confirmed 404 is idempotent success.

No size-only preflight is documented. Unknown-size torrents use the roomiest non-transferring account; Seedr enforces account fit, metadata later enforces the configured size cap. Do not trust `xl`. Whole-folder ZIP init request bodies are undocumented; download individual files instead. Deep folder trees, provider restrictions, unsupported browser codecs or unavailable transcoding can fail safely without a paid workaround.

## Lifetime and safety

The app persists D1 admission before Seedr operations. Every item has a dedicated `LinkBox-<public UUID>` folder, with ownership checkpoints. Never rename it or move personal files into it. The originating browser can delete its download at any time after confirmation; other browsers cannot delete it manually. There is no 3-hour lock or community cleanup. Files expire after 24h. Cron runs hourly; stale claims recover after 5 minutes. No public admin/time-bypass endpoint exists.

Full mode can submit to Seedr and delete **app-managed** files through owner confirmation or automatic expiration. `SEEDR_ACCESS=storage-only` is an explicit rollback switch that prevents all file actions/Cron. D1 stores no media or PAT.

## Cloudflare production

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm run db:migrate:remote
cd apps\worker
npx wrangler secret put SEEDR_ACCOUNT_A_TOKEN --env production
npx wrangler deploy --env production
```

Enter the PAT privately at the prompt. For token rotation, this changes the Worker Secret without publishing the token to GitHub. Pages receives only the public API URL. Applying migrations must precede Worker deployment. See README for GitHub auto-deploy and verification.
