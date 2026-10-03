-- M-1: 旧表/既存データを変更せず、両世代の受付を同じ原子的境界に置く。
CREATE TABLE media_runtime_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  is_recovery_blocked INTEGER NOT NULL DEFAULT 0 CHECK (is_recovery_blocked IN (0,1))
);
INSERT INTO media_runtime_state(id) VALUES (1);
CREATE TABLE media_models (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','tts','music')),
  UNIQUE(id,kind)
);
INSERT INTO media_models VALUES
  ('openai/gpt-image-2.5/sunburst/text-to-image','image'),
  ('openai/gpt-image-2.5/sunburst/edit','image'),
  ('openai/gpt-image-2.5/flare/text-to-image','image'),
  ('openai/gpt-image-2.5/flare/edit','image'),
  ('minimax/h3-max/text-to-video','video'),
  ('minimax/h3-max/image-to-video','video'),
  ('minimax/h3-max/reference-to-video','video'),
  ('minimax/h3-max/camera-controls','video'),
  ('google/gemini-3.8-flash-tts','tts'),
  ('google/gemini-3.8-flash-lite-tts','tts'),
  ('elevenlabs/tts/eleven-v4','tts'),
  ('elevenlabs/music/v2.5','music');
CREATE TABLE media_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK (length(request_key)=47),
  request_uuid TEXT NOT NULL CHECK (request_uuid=substr(request_key,12)),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  model_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL CHECK (catalog_version='media-v1'),
  kind TEXT NOT NULL CHECK (kind IN ('image','video','tts','music')),
  quantity INTEGER NOT NULL CHECK (quantity>0 AND quantity<=20000),
  reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes>0 AND reserved_bytes<=268435456),
  provider_id TEXT,
  provider_state TEXT NOT NULL CHECK (provider_state IN ('reserved','submitting','submission_unknown','queued','running','completed','failed','cancelled')),
  collection_state TEXT NOT NULL DEFAULT 'pending' CHECK (collection_state IN ('pending','collecting','collection_failed','stored','invalid','deleting','discarded')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count IN (0,1)),
  collection_attempts INTEGER NOT NULL DEFAULT 0 CHECK (collection_attempts BETWEEN 0 AND 3),
  next_poll_at INTEGER NOT NULL,
  monitor_until INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  cancel_requested_at INTEGER,
  cancel_sent_at INTEGER,
  body_erased_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  terminal_at INTEGER,
  terminal_outcome TEXT CHECK (terminal_outcome IN ('stored','failed','invalid','cancelled','discarded')),
  FOREIGN KEY(model_id,kind) REFERENCES media_models(id,kind),
  UNIQUE(owner_id,request_key), UNIQUE(owner_id,request_uuid), UNIQUE(id,owner_id),
  CHECK ((lease_token IS NULL)=(lease_until IS NULL)),
  CHECK ((terminal_at IS NULL)=(terminal_outcome IS NULL)),
  CHECK (terminal_at IS NULL OR terminal_at>=created_at),
  CHECK (terminal_at IS NULL OR
    (terminal_outcome='stored' AND provider_state='completed' AND collection_state='stored' AND cancel_requested_at IS NULL) OR
    (terminal_outcome IN ('failed','cancelled') AND provider_state IN ('failed','cancelled') AND collection_state='discarded') OR
    (terminal_outcome IN ('invalid','discarded') AND provider_state='completed' AND collection_state IN ('invalid','discarded'))),
  CHECK (attempt_count=1 OR provider_state IN ('reserved','failed','cancelled')),
  CHECK (provider_state NOT IN ('queued','running','completed') OR provider_id IS NOT NULL)
);
CREATE INDEX media_jobs_owner ON media_jobs(owner_id,created_at);
CREATE INDEX media_jobs_active ON media_jobs(terminal_at,next_poll_at);
CREATE TABLE media_job_bodies (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  FOREIGN KEY(job_id,owner_id) REFERENCES media_jobs(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE media_usage_events (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video','tts','music')),
  quantity INTEGER NOT NULL CHECK (quantity>0),
  consumed_at INTEGER NOT NULL,
  FOREIGN KEY(job_id,owner_id) REFERENCES media_jobs(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX media_usage_owner ON media_usage_events(owner_id,kind,consumed_at);
CREATE TABLE media_storage_reservations (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  held_bytes INTEGER NOT NULL CHECK (held_bytes>=0),
  state TEXT NOT NULL CHECK (state IN ('reserved','stored','deleting','released')),
  -- 台帳90日後も物理削除が未確認なら容量だけを保持する。
  CHECK ((held_bytes=0)=(state='released'))
);
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK (version>=1),
  source TEXT NOT NULL CHECK (source IN ('upload','result')),
  source_job_id TEXT,
  format TEXT NOT NULL CHECK (format IN ('png','jpeg','webp','mp4','wav','mp3')),
  bytes INTEGER NOT NULL CHECK (bytes>0),
  width INTEGER, height INTEGER, duration REAL,
  has_alpha INTEGER NOT NULL DEFAULT 0 CHECK (has_alpha IN (0,1)),
  state TEXT NOT NULL CHECK (state IN ('quarantined','ready','deleting','deleted')),
  validated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(id,owner_id),
  CHECK (expires_at>validated_at),
  CHECK ((state='deleted')=(deleted_at IS NOT NULL)),
  CHECK ((source='result')=(source_job_id IS NOT NULL))
);
CREATE TABLE media_job_assets (
  job_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reference','start','end','mask','output')),
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  asset_version INTEGER NOT NULL,
  mask_target_id TEXT,
  PRIMARY KEY(job_id,role,ordinal),
  UNIQUE(job_id,asset_id,role),
  FOREIGN KEY(job_id,owner_id) REFERENCES media_jobs(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id,owner_id) REFERENCES media_assets(id,owner_id),
  FOREIGN KEY(mask_target_id,owner_id) REFERENCES media_assets(id,owner_id),
  CHECK ((role='mask')=(mask_target_id IS NOT NULL))
);
CREATE VIEW media_generation_usage AS
  SELECT owner_id,kind,quantity,consumed_at FROM media_usage_events
  UNION ALL SELECT owner_id,'image',1,created_at FROM image_jobs;
CREATE VIEW media_active_jobs AS
  SELECT owner_id FROM media_jobs WHERE terminal_at IS NULL
  UNION ALL SELECT owner_id FROM image_jobs WHERE state IN ('submitting','queued','running','submission_unknown','cancel_requested','timed_out');
CREATE VIEW media_storage_holds AS
  SELECT owner_id,held_bytes FROM media_storage_reservations
  UNION ALL SELECT owner_id,bytes FROM media_assets WHERE source='upload' AND state!='deleted'
  UNION ALL SELECT owner_id,20971520 FROM image_jobs WHERE state IN ('submitting','queued','running','submission_unknown','cancel_requested','timed_out');
CREATE TRIGGER media_reservation_guard BEFORE INSERT ON media_jobs
WHEN NOT EXISTS(SELECT 1 FROM media_jobs WHERE owner_id=NEW.owner_id AND request_key=NEW.request_key)
BEGIN
  SELECT CASE WHEN COALESCE((SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1),1)!=0 THEN RAISE(ABORT,'MEDIA_RECOVERY_BLOCKED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM image_jobs WHERE owner_id=NEW.owner_id AND request_key=NEW.request_uuid) THEN RAISE(ABORT,'MEDIA_REQUEST_CONFLICT') END;
  SELECT CASE WHEN
    (SELECT count(*) FROM media_active_jobs WHERE owner_id=NEW.owner_id)>=1 OR
    (SELECT count(*) FROM media_active_jobs)>=3 OR
    COALESCE((SELECT sum(held_bytes) FROM media_storage_holds WHERE owner_id=NEW.owner_id),0)+NEW.reserved_bytes>1073741824 OR
    COALESCE((SELECT sum(held_bytes) FROM media_storage_holds),0)+NEW.reserved_bytes>10737418240 OR
    (SELECT count(*) FROM media_generation_usage WHERE owner_id=NEW.owner_id AND kind=NEW.kind AND consumed_at>=NEW.created_at-86400000)>=CASE NEW.kind WHEN 'image' THEN 10 WHEN 'video' THEN 3 WHEN 'tts' THEN 10 ELSE 3 END OR
    COALESCE((SELECT sum(quantity) FROM media_generation_usage WHERE owner_id=NEW.owner_id AND kind=NEW.kind AND consumed_at>=NEW.created_at-86400000),0)+NEW.quantity>CASE NEW.kind WHEN 'image' THEN 20 WHEN 'video' THEN 30 WHEN 'tts' THEN 20000 ELSE 180 END
    THEN RAISE(ABORT,'MEDIA_LIMIT_REACHED') END;
END;
CREATE TRIGGER media_reservation_created AFTER INSERT ON media_jobs
BEGIN
  INSERT INTO media_usage_events VALUES(NEW.id,NEW.owner_id,NEW.kind,NEW.quantity,NEW.created_at);
  INSERT INTO media_storage_reservations VALUES(NEW.id,NEW.owner_id,NEW.reserved_bytes,'reserved');
END;
CREATE TRIGGER legacy_media_reservation_guard BEFORE INSERT ON image_jobs
WHEN NOT EXISTS(SELECT 1 FROM image_jobs WHERE owner_id=NEW.owner_id AND request_key=NEW.request_key)
BEGIN
  SELECT CASE WHEN COALESCE((SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1),1)!=0 THEN RAISE(ABORT,'MEDIA_RECOVERY_BLOCKED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM media_jobs WHERE owner_id=NEW.owner_id AND request_uuid=NEW.request_key) THEN RAISE(ABORT,'MEDIA_REQUEST_CONFLICT') END;
  SELECT CASE WHEN
    (SELECT count(*) FROM media_active_jobs WHERE owner_id=NEW.owner_id)>=1 OR
    (SELECT count(*) FROM media_active_jobs)>=3 OR
    COALESCE((SELECT sum(held_bytes) FROM media_storage_holds WHERE owner_id=NEW.owner_id),0)+20971520>1073741824 OR
    COALESCE((SELECT sum(held_bytes) FROM media_storage_holds),0)+20971520>10737418240 OR
    (SELECT count(*) FROM media_generation_usage WHERE owner_id=NEW.owner_id AND kind='image' AND consumed_at>=NEW.created_at-86400000)>=10 OR
    COALESCE((SELECT sum(quantity) FROM media_generation_usage WHERE owner_id=NEW.owner_id AND kind='image' AND consumed_at>=NEW.created_at-86400000),0)+1>20
    THEN RAISE(ABORT,'MEDIA_LIMIT_REACHED') END;
END;
