CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  active_request_id TEXT,
  lock_until INTEGER
);
CREATE INDEX conversations_owner ON conversations(owner_id, updated_at);

CREATE TABLE chat_requests (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','complete','failed','cancelled')),
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX chat_requests_quota ON chat_requests(owner_id, created_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES chat_requests(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('pending','complete','failed','cancelled')),
  created_at INTEGER NOT NULL,
  UNIQUE(request_id, role)
);
CREATE INDEX messages_conversation ON messages(conversation_id, created_at, role);

CREATE TABLE app_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX app_rate_limits_expiry ON app_rate_limits(expires_at);

CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id, id)
);
CREATE INDEX notes_owner ON notes(owner_id, created_at);

CREATE TABLE tool_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
