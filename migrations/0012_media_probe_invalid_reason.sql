-- 結果本文や取得先を保存せず、限定確認の固定拒否分類だけを保持する。
ALTER TABLE media_probe_attempts ADD COLUMN invalid_reason TEXT CHECK(invalid_reason IN('result_shape','result_count','url_policy','duplicate_url','image_bytes'));
CREATE TRIGGER media_probe_invalid_reason_once BEFORE UPDATE OF invalid_reason ON media_probe_attempts
WHEN OLD.invalid_reason IS NOT NULL OR NEW.invalid_reason IS NULL
BEGIN
  SELECT RAISE(ABORT,'MEDIA_PROBE_DENIED');
END;
