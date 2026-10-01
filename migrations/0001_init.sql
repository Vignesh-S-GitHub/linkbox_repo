CREATE TABLE IF NOT EXISTS seedr_accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  capacity_bytes INTEGER NOT NULL DEFAULT 0,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  available_bytes INTEGER NOT NULL DEFAULT 0,
  credential_reference TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  seedr_account_id TEXT,
  seedr_item_id TEXT,
  magnet_hash TEXT,
  display_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  cleanup_allowed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER,
  error_message TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(seedr_account_id) REFERENCES seedr_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_downloads_expiry ON downloads(expires_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_downloads_cleanup ON downloads(cleanup_allowed_at, deleted_at);
