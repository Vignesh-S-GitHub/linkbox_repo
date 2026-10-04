-- Atomic, expiring coordination across Worker isolates. No raw IPs or tokens.
CREATE TABLE request_guards (
  name TEXT PRIMARY KEY NOT NULL,
  holder TEXT NOT NULL,
  expires_ms INTEGER NOT NULL
);
CREATE INDEX request_guards_expiry ON request_guards(expires_ms);
