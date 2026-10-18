# B-3: 各実行入口とWorkflow再開の根拠

確認日: 2026-10-02。公式仕様と、このプロジェクトの実装判断・ローカル検証を区別する。B-3J、Jev service、新メディア、実接続・配備は対象外。

| 公式資料 | 確認した仕様 | 採用と制約 |
| --- | --- | --- |
| [Workflowsの実行規則](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) | step単位で結果が永続化され、再開時に完了済みstepの結果が利用される。再実行される処理には冪等性が必要 | 所有者照合を専用`step.do`へ置き、再開後も同じownerと現在のジョブ状態で照合する。要約結果を保存する後続stepは独立に設定/台帳を再確認し、完了済み要約stepのguardが再実行される前提にしない |
| [Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/) | `step.do`、`waitForEvent`、timeout/retry等をWorkflow内で指定できる | 既存step名とretry方針を維持し、所有者stepにtimeoutと出力のsensitive指定を追加。待機後に状態・guardを再照合する。停止/再開・実課金のクラウド検証ではない |

インストール済みAI SDK 7.0.118の公開型定義`node_modules/ai/dist/index.d.ts`で、`prepareStep`の非同期hookが各モデルstepの準備時に使用できることを確認した。依存変更なしで、チャット次stepの環境/選択/台帳/資格情報確認へ採用。SDK宣言の確認とfakeモデルのworkerd検証であり、実providerの推論・接続品質を証明しない。

独立拡張は共有環境境界と通常stagingの旧台帳存在検査を使用し、チャット/Jevの設定不備を流用しない。同期catalog一覧/直接取得はSQLを行わず、実行入口が台帳を確認する。SQLの根拠と旧検証境界は[B-2の記録](runtime-boundary-20261002.md)を保持する。

実装と設定上の注意は[現在の設定メモ](../docs/実AI検証制御-実装状況.md#2026-10-02-b-3のモデル選択と別入口統合)、最終検証は[plan](../docs/plan.md)と[B-3引き継ぎ](../docs/archive/B3完了-次セッション開始プロンプト.md)を参照。実workerd/D1とfake外部境界で342テストを含むcheck、最終buildのpreview HTTP smokeが成功。最新CI・別名複製・実クラウドの再開/配達/配備は未実施。
