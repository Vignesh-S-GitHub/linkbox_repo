-- Anonymous browser ownership; existing downloads cannot be safely attributed.
-- Never persist the raw browser capability or make this digest public.
ALTER TABLE downloads ADD COLUMN owner_session_hash TEXT
  CHECK (owner_session_hash IS NULL OR
    (length(owner_session_hash)=64 AND owner_session_hash NOT GLOB '*[^0-9a-f]*'));
