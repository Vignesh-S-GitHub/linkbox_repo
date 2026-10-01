# LinkBox

LinkBox is a mobile-first temporary file interface for the workflow **paste → fetch → access**.

> Use LinkBox only for content you are authorized to access.

## Stack

React + Vite + TypeScript, Cloudflare Pages, Cloudflare Workers, Cloudflare D1, Cloudflare Cron, and a mock-first Seedr integration.

## V1 screens

1. Home / Add Link
2. Adding / Progress
3. Files
4. Folder View
5. File Preview
6. Media Player
7. File Actions bottom sheet
8. Storage
9. Storage Full / Cleanup
10. Settings
11. About / How It Works
12. Error / Unavailable

## Retention

- First 3 hours: protected from shared cleanup.
- After 3 hours: eligible to be cleared when space is needed.
- After 24 hours: automatically removed.

The normal file UI intentionally does not show retention countdowns. These rules belong on About / How It Works.

## Local development

```bash
npm install
npm run dev
```

## Cloudflare / D1

Create a D1 database named `linkbox`, copy its ID into `wrangler.toml`, and apply `migrations/0001_init.sql`.

```bash
npx wrangler login
npx wrangler d1 create linkbox
npx wrangler d1 execute linkbox --file=./migrations/0001_init.sql --remote
npx wrangler dev
```

The hourly Cron trigger clears records whose 24-hour expiry has passed.

## Seedr

Keep Seedr credentials/tokens in Cloudflare Worker Secrets only. Do not put them in browser code, GitHub, Vite public variables, or plaintext D1 fields. Use only currently documented Seedr API capabilities. A single file must fit entirely in one underlying Seedr account; never split one file across accounts.

Initial logical pool: 5 GB + 4.5 GB = 9.5 GB.

## Deployment

Frontend: Cloudflare Pages, build command `npm run build`, output `dist`.

API: `npx wrangler deploy`.

## Status

V1 is mock-first. Live Seedr authentication, storage synchronization, magnet progress, and secure direct playback/download URLs require connection to verified Seedr API capabilities and credentials.
