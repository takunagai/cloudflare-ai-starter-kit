CREATE TABLE rag_documents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('uploading','pending_index','indexed','deleted','failed')),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX rag_documents_owner ON rag_documents(owner_id, created_at);

CREATE TABLE image_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  provider_id TEXT,
  provider_urls_json TEXT,
  model TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('submitting','queued','running','completed','failed','submission_unknown','cancel_requested','timed_out')),
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, request_key)
);
CREATE INDEX image_jobs_owner ON image_jobs(owner_id, created_at);

CREATE TABLE summary_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  input TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('starting','running','awaiting_approval','approved','rejected','completed','expired','failed')),
  summary TEXT,
  decision TEXT CHECK (decision IN ('approve','reject')),
  approval_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, request_key)
);
CREATE INDEX summary_jobs_owner ON summary_jobs(owner_id, created_at);

-- The primary key is also the idempotency key for the final side effect.
CREATE TABLE saved_summaries (
  job_id TEXT PRIMARY KEY REFERENCES summary_jobs(id),
  owner_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
