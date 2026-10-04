-- Additive migration. Existing ready items are reconciled with owned Seedr
-- contents once, using the bounded polling lease; no files/dates are changed.
ALTER TABLE downloads ADD COLUMN kind TEXT CHECK(kind IS NULL OR kind IN
  ('folder','video','audio','image','pdf','archive','text','subtitle','sheet','presentation','other'));
ALTER TABLE downloads ADD COLUMN file_count INTEGER CHECK(file_count IS NULL OR file_count BETWEEN 0 AND 1000);
-- SQLite's non-STRICT INTEGER affinity already preserves fractional progress
-- as REAL. No destructive table rebuild is necessary; integration tests cover it.
