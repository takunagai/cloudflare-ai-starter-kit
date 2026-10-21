# B-2のD1台帳存在検査

確認日: 2026-10-02。

公式根拠: [D1 Prepared Statements / first](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)。`first()`は先頭行を返し、該当行がなければnullを返す。SQL/照会失敗を行なしと同じ扱いにしない。

採用: 通常stagingの認証後に固定SQL `SELECT 1 AS present FROM ai_verification LIMIT 1`を実行し、nullだけを行なしとして受理する。行あり・例外は固定コードの503。台帳本文・所有者・開始時刻・消費数は取得せず、削除/更新せず、永続cacheしない。同期的なB-1設定判定と非同期DB検査を分離する。

検証: `tests/runtime-boundary.test.ts`で実workerd/D1の行なし・行あり・table未適用、合成照会例外、予約前/実行直前再検査を確認。既存旧検証の総枠/固定窓/消費回帰も全体checkへ含める。実D1の読み取り・変更は行っていない。

制約: 存在検査は他リクエストの台帳書込みと単一transactionではない。新しい通常stagingは別Worker/別DBとする採用済み設計が前提。guardだけで旧/通常Workerの共有DB運用を許可しない。[設定/入口契約](../docs/archive/用途別プリセット-開発計画.md#判定順と台帳の扱い)。
