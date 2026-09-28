-- One durable verification allowance per database. No automatic reset or TTL.
-- This row deliberately has no foreign key to deletable conversations/users.
CREATE TABLE ai_verification (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at = started_at + 1800000),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3)
);
