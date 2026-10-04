-- M-3: 0001〜0009は保持。既存grantを保持して開始/終了画像のroleを追加する。
DROP TRIGGER media_grants_asset_revoked;
CREATE TABLE media_asset_grants_m3 (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
  job_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  asset_version INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reference','mask','start','end')),
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
INSERT INTO media_asset_grants_m3 SELECT * FROM media_asset_grants;
DROP TABLE media_asset_grants;
ALTER TABLE media_asset_grants_m3 RENAME TO media_asset_grants;
CREATE INDEX media_grants_asset ON media_asset_grants(asset_id,revoked_at);
CREATE TRIGGER media_grants_asset_revoked AFTER UPDATE OF state ON media_assets
WHEN NEW.state!='ready'
BEGIN
  UPDATE media_asset_grants SET revoked_at=COALESCE(revoked_at,NEW.deleted_at,NEW.expires_at) WHERE asset_id=NEW.id;
END;
