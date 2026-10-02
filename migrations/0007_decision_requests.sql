-- Metadata only. No input, answer, hash, credentials or deletion cascade.
CREATE TABLE decision_requests (
  owner_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK (length(request_key) = 47),
  request_day TEXT NOT NULL CHECK (request_day = substr(request_key, 1, 10)),
  definition_id TEXT NOT NULL CHECK (definition_id IN ('starter-intent', 'starter-clarity', 'starter-request')),
  contract_version TEXT NOT NULL CHECK (contract_version = definition_id || '-v1'),
  model_id TEXT NOT NULL CHECK (model_id = 'jev-1.13.0'),
  question_count INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 8),
  state TEXT NOT NULL CHECK (state IN ('reserved','submitting','succeeded','failed','submission_unknown')),
  error_code TEXT CHECK (error_code IN (
    'decision_guard_rejected','decision_timeout','decision_submission_unknown',
    'decision_invalid_response','decision_upstream_auth','decision_upstream_invalid_request',
    'decision_upstream_rate_limited','decision_upstream_overloaded','decision_reservation_expired'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count IN (0,1)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  reservation_until INTEGER NOT NULL CHECK (reservation_until = created_at + 30000),
  sent_at INTEGER,
  execution_until INTEGER,
  finished_at INTEGER,
  expires_at INTEGER,
  input_tokens INTEGER CHECK (input_tokens BETWEEN 0 AND 9007199254740991),
  output_tokens INTEGER CHECK (output_tokens BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(owner_id,request_key),
  CHECK ((attempt_count=0 AND sent_at IS NULL AND execution_until IS NULL) OR
         (attempt_count=1 AND sent_at IS NOT NULL AND execution_until IS NOT NULL AND sent_at>=created_at AND execution_until=sent_at+30000)),
  CHECK ((state='reserved' AND attempt_count=0) OR
         (state IN ('submitting','submission_unknown','succeeded') AND attempt_count=1) OR state='failed'),
  CHECK ((state IN ('succeeded','failed') AND finished_at IS NOT NULL AND expires_at IS NOT NULL AND finished_at>=created_at AND expires_at=finished_at+7776000000) OR
         (state IN ('reserved','submitting','submission_unknown') AND finished_at IS NULL AND expires_at IS NULL)),
  CHECK ((state IN ('reserved','submitting','succeeded') AND error_code IS NULL) OR
         (state IN ('failed','submission_unknown') AND error_code IS NOT NULL)),
  CHECK (state!='succeeded' OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL)),
  CHECK ((input_tokens IS NULL AND output_tokens IS NULL) OR
         (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND state IN ('succeeded','failed')))
);
CREATE INDEX decision_owner_created ON decision_requests(owner_id,created_at);
CREATE INDEX decision_created ON decision_requests(created_at);
CREATE INDEX decision_owner_state ON decision_requests(owner_id,state);
CREATE INDEX decision_state ON decision_requests(state);
CREATE INDEX decision_expiry ON decision_requests(expires_at) WHERE expires_at IS NOT NULL;
