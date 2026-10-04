# LinkBox V1 verification

Verified on 2026-10-04. The approved brand assets, theme, layout and navigation remain unchanged.

## Automated checks

- Lint and TypeScript checks pass.
- Frontend production build and Worker production dry-run pass.
- 69 tests pass: 31 business/API/navigation tests, 13 real SQLite/D1 tests, 11 live-adapter contract/safety tests, and 14 private setup tests.
- Production dependency audit reports no known vulnerabilities.

## Real-account local end-to-end checks

The official WebTorrent free-torrent list's Creative Commons Sintel sample was used, not personal account content. Media was stored only on Seedr.

- Isolated app-owned folder creation and magnet submission succeed.
- Progress reaches Ready; 11 actual folder entries are browsable.
- Video decodes in Chrome (640 × 273, approximately 14m 48s) using Seedr's HLS delivery and native player controls.
- Direct download supports HTTP 206 byte-range delivery; no media proxy or application storage is used.
- Duplicate magnet submission is rejected.
- New-download cleanup is rejected during the first 3 hours.
- A disposable local D1 record aged to 4 hours is cleaned; repeated deletion is safe. Concurrent requests do not double-process it.
- A second disposable local record aged to 25 hours is unavailable for delivery, removed by the actual Wrangler scheduled handler, and marked Expired. Repeated Cron runs succeed.
- Seedr quota returns to zero used bytes after disposing of the sample files.

Only disposable **local** metadata timestamps were accelerated. Production lifetime remains exactly 3-hour protection / 24-hour expiry. All local sample media was removed; no personal files were imported or deleted.

## Release scope

The full Worker was deployed as version `60ac45c7-62d1-473b-aad7-13f4b83e2fe9`; Pages production from the merged V1 revision succeeded. Public smoke tests confirmed real submission, Ready status, 11 entries, HLS playback (HTTP 200, decoded video), direct Range download (HTTP 206), protected cleanup rejection (409), and unapproved-origin rejection (403). The approximately 123 MB Creative Commons production sample keeps its normal protection and expires on 2026-10-05 at 17:56 IST; it was not force-deleted or time-accelerated.

Final navigation regressions cover dotted torrent names, extensionless files, loading skeletons, and folder-download fallback. Mobile checks at 360 / 390 / 430px confirm no horizontal overflow; bottom navigation targets are 63px high. The approved CSS and original brand assets are unchanged.

Production is enabled by deploying the full Worker and this frontend revision after all D1 migrations. GitHub Actions checks the same quality gate, and the existing Pages project deploys main automatically. A production browser/API smoke check is recorded separately in the release handoff; local checks do not prove a production deployment succeeded.

## Documented V1 limits

- Seedr does not document a size-only magnet preflight; unknown-size submissions rely on Seedr's own whole-account capacity enforcement.
- Whole-folder ZIP initialization has no documented body schema. Open folders and download individual files.
- The sample video downloads correctly, but Seedr's subtitle/poster direct URLs returned 404. Verified HEAD checks now catch unavailable provider files before issuing a browser delivery link; preview/download shows a safe retry message instead of navigating to a 404 page.
- Browsing is bounded to 8 folders / 1,000 files and 48 provider calls per invocation.
- Native image/PDF preview support varies by browser. Seedr playback availability depends on its supported media and account limits.
- The app is anonymous shared storage, not a private personal-file manager. Only LinkBox-created content is exposed; manually moving personal content into a LinkBox folder makes it part of that temporary shared folder.
