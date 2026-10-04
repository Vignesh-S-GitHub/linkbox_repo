# Seedr connection: actual account storage

The user requested actual storage from one Seedr account, rather than the two-account demo pool. The approved theme is unchanged. Two separate commands are available: `seedr:check` is an unsaved diagnostic; `seedr:configure` saves a private local Worker token and activates live **storage-only** mode.

## Activate your real account's storage

Stop the existing development terminal with Ctrl+C, then run:

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm run seedr:configure
npm run dev
```

Enter the existing `account.read` token at the hidden prompt. The setup makes one authenticated quota request, validates the storage counts, and atomically updates ignored `apps/worker/.dev.vars`. It selects exactly one account, sets `SEEDR_MODE=live` and `SEEDR_ACCESS=storage-only`, and derives capacity from the real quota instead of assuming 5 GB or 9.5 GB. Unrelated local settings are preserved. Tokens are not printed or passed on command lines. The file stores a plaintext development secret: keep it private; Windows permissions are inherited from the project directory.

Refresh `http://localhost:5173` and open Storage. Total/used/available come from your account's quota. No mock storage or sample files are returned in this mode. The Files list is empty because existing personal Seedr files are not imported or listed. Add, Play, Download, cleanup and Cron deletion are disabled, with safe backend errors. No database configuration is required for this read-only mode, and no account/media data is uploaded elsewhere.

If setup fails, do not share `.dev.vars` or the token. Share only the error text. If the displayed quota does not match Seedr's own storage bar, report the difference so its units can be checked before any write operations. If Windows blocks the script, do not weaken execution policy or protection settings.

## Verified official documentation

On 2026-10-04 we read the user's signed-in [Seedr API Console documentation](https://www.seedr.cc/api/v0.1/console/documentation). This is different from the old REST v1 API used by the existing, unvalidated live adapter.

- API base: `https://www.seedr.cc/api/v0.1/p`.
- Personal Access Tokens use `Authorization: Bearer <token>`.
- `GET /me/quota` reads storage/bandwidth quota; `account.read` is the read-only account permission.
- The reference lists torrent tasks, filesystem contents, temporary file download URLs and media presentations.
- The official example submits a task with JSON fields `url` and `save_folder_id`.
- Deleting a task is explicitly different from deleting its completed files. Never use a task ID as a file/folder ID.

The user's successful read-only diagnostic verified numeric `space_used` and `space_max` fields. The Worker parses those counts strictly with PAT authentication and skips disabled accounts. Storage-only mode always uses the actual current quota, including capacity changes. Full mode still rejects configuration-capacity mismatches. Compare byte units with the real account's displayed storage before enabling writes. The reference does not specify the full task-to-completed-folder contract or a magnet-size preflight endpoint. Unknown values must not become zero-byte files or invented IDs. The old v1 guesses have been removed; unverified transfer/cleanup/delivery methods fail closed. Never put a PAT into a `_BASIC_AUTH` secret or enable full mode yet.

## 1. Create a narrowly scoped test token yourself

In Seedr's API Console, open Personal Access Tokens and its create-token form.

- Name it `LinkBox local quota check`.
- Select only `account.read` for this first test.
- Choose a short expiry if offered.
- Do not enable write, subscription/payment, or settings permissions.
- Keep the resulting token private. Never paste it into chat or a screenshot.

If the form does not offer those permissions, share a screenshot of the empty form with private information hidden before creating anything. Do not use the documentation's auto-generated 6-hour token button without checking its granted permissions.

## 2. Run the read-only check

In your normal PowerShell terminal:

```powershell
cd C:\Users\shanm\Projects\LinkBox
npm run seedr:check
```

Paste the token only into the hidden-input prompt. It is passed to the local checker over standard input, not command-line arguments, shell history, browser storage, environment variables, or a saved file. The checker sends it only to Seedr's documented HTTPS quota endpoint. It never prints token values or raw response bodies. It requests no media.

If Windows blocks running the PowerShell script, do not weaken execution policy or endpoint protection. Report the error so we can use an approved local credential-entry method instead.

A successful check prints `authenticatedQuotaRequest: true` and a **field-name/type-only** response shape. This confirms that Seedr accepted one quota request, not that all live app functionality works. Copy that diagnostic into chat; it contains no quota values, account details or token. Clear your clipboard after entering the token. You can revoke this test token after the check.

## 3. What remains before a real-file test

- Configure private PAT secrets locally after confirming actual capacity. PAT quota requests and strict parsers are implemented; transfers and delivery still need verified response mappings.
- The user chose one account for the real local test. Verify its quota units and actual capacity; a mock 9.5 GB display is not evidence of real available space.
- Resolve metadata-size support without trusting a magnet's user-supplied `xl` field.
- Verify task IDs, completion mapping, signed delivery, and media availability separately.
- Configure metadata persistence and lock down database cleanup functions before enabling writes/cron.
- Store final tokens only in ignored local Worker secrets, then Cloudflare Worker Secrets for deployment.
- Start with read-only account access. Request the specific task/file write permissions only when the test is ready.
- Add one small authorized test download, then test cleanup only for that application-created item with explicit user approval. Never import existing personal files into automatic cleanup.

The account's quota request has succeeded in the user's terminal. Actual app activation requires running `seedr:configure` privately; the agent has not received the token. No GitHub upload or Cloudflare deployment is part of this step.
