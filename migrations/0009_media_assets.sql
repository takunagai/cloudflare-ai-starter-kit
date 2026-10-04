-- M-2: 0001〜0008を保持し、素材書込み・grantを独立して記録する。
CREATE TABLE media_uploads (
  asset_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes BETWEEN 1 AND 10485760),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  state TEXT NOT NULL CHECK (state IN ('reserved','writing','write_unknown','settled')),
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(asset_id,owner_id) REFERENCES media_assets(id,owner_id)
);
CREATE INDEX media_uploads_owner ON media_uploads(owner_id,state,expires_at);
CREATE TRIGGER media_upload_reservation_guard BEFORE INSERT ON media_uploads
BEGIN
  SELECT CASE WHEN COALESCE((SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1),1)!=0 THEN RAISE(ABORT,'MEDIA_RECOVERY_BLOCKED') END;
  SELECT CASE WHEN
    (SELECT count(*) FROM media_uploads WHERE owner_id=NEW.owner_id AND state!='settled')>=2 OR
    COALESCE((SELECT sum(held_bytes) FROM media_storage_holds WHERE owner_id=NEW.owner_id),0)>1073741824 OR
    COALESCE((SELECT sum(held_bytes) FROM media_storage_holds),0)>10737418240
    THEN RAISE(ABORT,'MEDIA_LIMIT_REACHED') END;
END;
CREATE TABLE media_asset_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
  job_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  asset_version INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reference','mask')),
  ordinal INTEGER NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose='fal-reference'),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  get_count INTEGER NOT NULL DEFAULT 0 CHECK (get_count BETWEEN 0 AND 20),
  head_count INTEGER NOT NULL DEFAULT 0 CHECK (head_count BETWEEN 0 AND 20),
  transferred_bytes INTEGER NOT NULL DEFAULT 0 CHECK (transferred_bytes>=0),
  FOREIGN KEY(job_id,owner_id) REFERENCES media_jobs(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id,owner_id) REFERENCES media_assets(id,owner_id)
);
CREATE INDEX media_grants_asset ON media_asset_grants(asset_id,revoked_at);
CREATE TRIGGER media_grants_asset_revoked AFTER UPDATE OF state ON media_assets
WHEN NEW.state!='ready'
BEGIN
  UPDATE media_asset_grants SET revoked_at=COALESCE(revoked_at,NEW.deleted_at,NEW.expires_at) WHERE asset_id=NEW.id;
END;
-- job終端/取消/本文消去は取得SQLが毎回照合する。job更新のchangesをtriggerで増やさない。
-- 書込み中/受付不明objectを台帳の終端・期限だけで削除/解放しない。
CREATE TABLE media_output_objects (
  job_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
  asset_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('writing','write_unknown','stored','deleting','deleted')),
  receipt_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(job_id,ordinal)
);
