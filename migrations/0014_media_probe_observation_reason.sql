-- 工程Eの観測不明を固定分類だけで残す。token・URL・本文・HTTP個別値は保存しない。
-- 0013は限定実接続の管理外run登録に使用済みのため、公開migrationは0014へ進める。
ALTER TABLE media_probe_evidence ADD COLUMN diagnostic_reason TEXT CHECK(
  diagnostic_reason IS NULL OR
  (item='token' AND diagnostic_reason IN('initial_owner_unreadable','expired_token_readable','expired_token_other','fresh_token_unreadable','observation_error')) OR
  (item='expiry' AND diagnostic_reason IN('owner_token_denied','media_still_readable','other_response','observation_error'))
);
CREATE TRIGGER media_probe_observation_reason_once BEFORE UPDATE OF diagnostic_reason ON media_probe_evidence
WHEN OLD.diagnostic_reason IS NOT NULL AND NEW.diagnostic_reason IS NOT OLD.diagnostic_reason
BEGIN
  SELECT RAISE(ABORT,'MEDIA_PROBE_DENIED');
END;
