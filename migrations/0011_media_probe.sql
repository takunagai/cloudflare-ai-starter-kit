-- 工程E専用。承認行/slotは自動作成せず、通常の上流確認gateを変更しない。
CREATE TABLE media_probe_run (
  id INTEGER PRIMARY KEY CHECK(id=1),
  approval_version TEXT NOT NULL CHECK(approval_version='e-sunburst-20261005-v1'),
  owner_id TEXT NOT NULL,
  app_origin TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at=started_at+1800000),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK(max_attempts=2),
  used_attempts INTEGER NOT NULL DEFAULT 0 CHECK(used_attempts BETWEEN 0 AND 2),
  is_stopped INTEGER NOT NULL DEFAULT 0 CHECK(is_stopped IN(0,1)),
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN(0,1)),
  stopped_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  CHECK(is_closed=0 OR is_stopped=1)
);
CREATE TABLE media_probe_slots (
  run_id INTEGER NOT NULL CHECK(run_id=1),
  slot INTEGER NOT NULL CHECK(slot=1),
  request_key TEXT NOT NULL CHECK(length(request_key)=47),
  input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
  PRIMARY KEY(run_id,slot),
  UNIQUE(request_key),
  FOREIGN KEY(run_id) REFERENCES media_probe_run(id)
);
CREATE TABLE media_probe_attempts (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot=1),
  request_key TEXT NOT NULL UNIQUE,
  input_hash TEXT NOT NULL,
  consumed_at INTEGER NOT NULL,
  dispatch_claim TEXT,
  dispatched_at INTEGER,
  terminal_at INTEGER,
  UNIQUE(slot),
  CHECK((dispatch_claim IS NULL)=(dispatched_at IS NULL))
);
CREATE TABLE media_probe_calls (
  job_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('status','result','cancel','token','acl','anonymous','diagnostic','cleanup_status','upstream_delete','expiry_observation','token_observation')),
  count INTEGER NOT NULL CHECK(count>=1),
  last_at INTEGER NOT NULL,
  PRIMARY KEY(job_id,operation),
  FOREIGN KEY(job_id) REFERENCES media_probe_attempts(job_id)
);
CREATE TABLE media_probe_evidence (
  job_id TEXT NOT NULL,
  item TEXT NOT NULL CHECK(item IN('acl','anonymous','token','expiry','quality','billing','upstream_delete')),
  verdict TEXT NOT NULL CHECK(verdict IN('pass','fail','unknown','not_due')),
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(job_id,item),
  FOREIGN KEY(job_id) REFERENCES media_probe_attempts(job_id)
);
-- provider URLは本文と同じ私有/早期消去/終端30日。最小台帳へ混ぜない。
CREATE TABLE media_probe_output (
  job_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES media_jobs(id) ON DELETE CASCADE
);
CREATE TRIGGER media_probe_run_immutable BEFORE UPDATE ON media_probe_run
BEGIN
  SELECT CASE WHEN NEW.approval_version!=OLD.approval_version OR NEW.owner_id!=OLD.owner_id OR NEW.app_origin!=OLD.app_origin OR NEW.started_at!=OLD.started_at OR NEW.expires_at!=OLD.expires_at OR NEW.max_attempts!=OLD.max_attempts OR NEW.used_attempts<OLD.used_attempts OR NEW.is_stopped<OLD.is_stopped OR NEW.is_closed<OLD.is_closed OR NEW.revision<OLD.revision OR (OLD.stopped_at IS NOT NULL AND NEW.stopped_at IS NOT OLD.stopped_at) THEN RAISE(ABORT,'MEDIA_PROBE_DENIED') END;
END;
CREATE TRIGGER media_probe_slot_immutable BEFORE UPDATE ON media_probe_slots
BEGIN SELECT RAISE(ABORT,'MEDIA_PROBE_DENIED'); END;
CREATE TRIGGER media_probe_reservation BEFORE INSERT ON media_probe_attempts
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM media_probe_run r JOIN media_probe_slots s ON s.run_id=r.id JOIN media_jobs j ON j.id=NEW.job_id
    WHERE r.id=1 AND r.owner_id=NEW.owner_id AND r.is_stopped=0 AND r.is_closed=0
    AND r.used_attempts=0 AND r.used_attempts<r.max_attempts
    AND r.started_at<=CAST(unixepoch('subsec')*1000 AS INTEGER)
    AND r.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)+15000
    AND s.slot=NEW.slot AND s.request_key=NEW.request_key AND s.input_hash=NEW.input_hash
    AND j.owner_id=NEW.owner_id AND j.request_key=NEW.request_key AND j.input_hash=NEW.input_hash
    AND j.model_id='openai/gpt-image-2.5/sunburst/text-to-image' AND j.quantity=1 AND j.kind='image'
    AND j.provider_state='reserved' AND j.attempt_count=0
    AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0
  ) THEN RAISE(ABORT,'MEDIA_PROBE_DENIED') END;
END;
CREATE TRIGGER media_probe_consumed AFTER INSERT ON media_probe_attempts
BEGIN
  UPDATE media_probe_run SET used_attempts=used_attempts+1,stopped_at=COALESCE(stopped_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER media_probe_attempt_immutable BEFORE UPDATE ON media_probe_attempts
BEGIN
  SELECT CASE WHEN NEW.job_id!=OLD.job_id OR NEW.owner_id!=OLD.owner_id OR NEW.slot!=OLD.slot OR NEW.request_key!=OLD.request_key OR NEW.input_hash!=OLD.input_hash OR NEW.consumed_at!=OLD.consumed_at OR (OLD.dispatch_claim IS NOT NULL AND (NEW.dispatch_claim IS NOT OLD.dispatch_claim OR NEW.dispatched_at IS NOT OLD.dispatched_at)) OR (OLD.terminal_at IS NOT NULL AND NEW.terminal_at IS NOT OLD.terminal_at) THEN RAISE(ABORT,'MEDIA_PROBE_DENIED') END;
END;
CREATE TRIGGER media_probe_dispatch_guard BEFORE UPDATE OF dispatch_claim ON media_probe_attempts
WHEN OLD.dispatch_claim IS NULL AND NEW.dispatch_claim IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM media_probe_run r JOIN media_jobs j ON j.id=NEW.job_id
    WHERE r.id=1 AND r.owner_id=NEW.owner_id AND r.is_stopped=0 AND r.is_closed=0 AND r.used_attempts=1
    AND r.started_at<=CAST(unixepoch('subsec')*1000 AS INTEGER) AND r.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)+15000
    AND j.provider_state='reserved' AND j.attempt_count=0 AND j.terminal_at IS NULL AND j.cancel_requested_at IS NULL AND j.body_erased_at IS NULL
    AND j.created_at+30000>CAST(unixepoch('subsec')*1000 AS INTEGER)
    AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0
  ) THEN RAISE(ABORT,'MEDIA_PROBE_DENIED') END;
END;
CREATE TRIGGER media_probe_dispatch_claimed AFTER UPDATE OF dispatch_claim ON media_probe_attempts
WHEN OLD.dispatch_claim IS NULL AND NEW.dispatch_claim IS NOT NULL
BEGIN
  UPDATE media_jobs SET provider_state='submitting',attempt_count=1,lease_token=NEW.dispatch_claim,
    lease_until=NEW.dispatched_at+30000,updated_at=NEW.dispatched_at WHERE id=NEW.job_id;
END;
CREATE TRIGGER media_probe_call_monotonic BEFORE UPDATE ON media_probe_calls
BEGIN
  SELECT CASE WHEN NEW.job_id!=OLD.job_id OR NEW.operation!=OLD.operation OR NEW.count!=OLD.count+1 OR NEW.last_at<OLD.last_at THEN RAISE(ABORT,'MEDIA_PROBE_DENIED') END;
END;
CREATE TRIGGER media_probe_body_erased AFTER UPDATE OF body_erased_at ON media_jobs
WHEN NEW.body_erased_at IS NOT NULL
BEGIN DELETE FROM media_probe_output WHERE job_id=NEW.id; END;
