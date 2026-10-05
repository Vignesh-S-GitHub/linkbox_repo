-- Admin-managed metadata only. Seedr credentials remain in Worker Secrets.
CREATE TABLE IF NOT EXISTS account_configuration (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 128),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  capacity_bytes INTEGER NOT NULL CHECK(typeof(capacity_bytes)='integer' AND capacity_bytes > 0),
  secret_key_reference TEXT NOT NULL UNIQUE CHECK(length(secret_key_reference) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
