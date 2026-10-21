-- 工程Eの専用経路は2026-10-19に撤去した。0011・0012・0014で作ったtableとtriggerを外す。
-- media_jobsに付いていたtriggerと、media_probe_outputからmedia_jobsへの外部キーもここで外れる。
-- 外部キーの子tableから順に消す。各tableのtriggerはtableと一緒に消える。
DROP TRIGGER media_probe_body_erased;
DROP TABLE media_probe_output;
DROP TABLE media_probe_evidence;
DROP TABLE media_probe_calls;
DROP TABLE media_probe_attempts;
DROP TABLE media_probe_slots;
DROP TABLE media_probe_run;
