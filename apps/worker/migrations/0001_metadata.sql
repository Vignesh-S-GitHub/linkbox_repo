-- Cloudflare D1 (SQLite). Metadata only; never store media or credentials.
CREATE TABLE seedr_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  capacity_bytes INTEGER NOT NULL CHECK(capacity_bytes > 0),
  used_bytes INTEGER NOT NULL CHECK(used_bytes >= 0),
  available_bytes INTEGER NOT NULL CHECK(available_bytes >= 0),
  secret_key_reference TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(used_bytes + available_bytes = capacity_bytes)
);

CREATE TABLE downloads (
  id TEXT PRIMARY KEY NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  seedr_account_id TEXT NOT NULL REFERENCES seedr_accounts(id),
  seedr_item_id TEXT NOT NULL,
  magnet_hash TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 255),
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  status TEXT NOT NULL CHECK(status IN ('queued','fetching_metadata','downloading','processing','ready','failed','expired','deleted','deleting')),
  progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
  created_at TEXT NOT NULL CHECK(unixepoch(created_at) IS NOT NULL),
  cleanup_allowed_at TEXT NOT NULL CHECK(unixepoch(cleanup_allowed_at) IS NOT NULL),
  expires_at TEXT NOT NULL CHECK(unixepoch(expires_at) IS NOT NULL),
  deleted_at TEXT,
  error_message TEXT,
  cleanup_claimed_at TEXT,
  playable INTEGER NOT NULL DEFAULT 0 CHECK(playable IN (0,1)),
  updated_at TEXT NOT NULL,
  UNIQUE(seedr_account_id, seedr_item_id),
  CHECK(unixepoch(cleanup_allowed_at)=unixepoch(created_at)+10800),
  CHECK(unixepoch(expires_at)=unixepoch(created_at)+86400),
  CHECK((deleted_at IS NULL AND status NOT IN ('deleted','expired')) OR
        (deleted_at IS NOT NULL AND status IN ('deleted','expired'))),
  CHECK(status!='deleting' OR cleanup_claimed_at IS NOT NULL)
);

CREATE UNIQUE INDEX downloads_active_magnet ON downloads(magnet_hash) WHERE deleted_at IS NULL;
CREATE INDEX downloads_active_created ON downloads(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX downloads_expiry ON downloads(expires_at) WHERE deleted_at IS NULL AND cleanup_claimed_at IS NULL;
CREATE INDEX downloads_account ON downloads(seedr_account_id);
