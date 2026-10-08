ALTER TABLE chat_requests ADD COLUMN inference_started INTEGER;
ALTER TABLE chat_requests ADD COLUMN failure_code TEXT;
-- 既存要求の推論実行有無はNULLのまま残し、推論なしと推定しない。
