# Workers AI最小検証の公式根拠

2026-09-29再開時: [FP8個別ページ](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/)と[Workers AI料金表](https://developers.cloudflare.com/workers-ai/platform/pricing/)を再確認。指定モデルの掲載、context 32,000、入力$0.152・出力$0.287/100万tokens、13,778・26,128 Neurons/100万tokens、Paid超過$0.011/1,000 Neuronsに変更なし。既存見積りを維持する。これは公開資料の確認で、共有使用量・個別アカウントでの推論成功は未再確認。

確認日: 2026-09-28。実装レビュー時にもFP8個別ページとWorkers AI・Workers・D1料金の公式資料を再確認し、下記の単価・contextに変更なし。実アカウント・残量・認証情報・推論APIは照会していない。FP8採用と制御のローカル実装は完了し、実接続は未実施。[実装状況](../docs/実AI検証制御-実装状況.md)を現在の正本とする。以下の候補段階・未実装の記述は計画作成時の調査記録。

| 公式資料 | 確認した事実 | 採用判断・制約 |
| --- | --- | --- |
| [2026-05-08廃止告知](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/) | 現行コードの`@cf/meta/llama-3.1-8b-instruct`は2026-05-30廃止対象 | 旧資料・料金表・SDK例への残存は実行可能性の根拠にしない。現行個別ページも404を確認。実呼出しで試さない |
| [モデルカタログ](https://developers.cloudflare.com/workers-ai/models/) | 下記FP8版と3B版を掲載 | 掲載と個別アカウントの利用許可・稼働状態は別 |
| [Llama 3.1 8B FP8](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/) | 正確なIDは`@cf/meta/llama-3.1-8b-instruct-fp8`、context 32,000、streamとmax_tokensの仕様あり。入力$0.152、出力$0.287/100万tokens | 同じモデル系列で最小変更の第一候補。現行allowlist未対応。採用前にライセンス・実アカウント利用可否を確認する |
| [Llama 3.2 3B](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/) | IDは`@cf/meta/llama-3.2-3b-instruct`、context 80,000。個別ページの入力単価$0.0509、料金表は丸めた$0.051、出力$0.335/100万tokens | 比較用候補。安価な入力だけで選ばず、今回は1モデルに限定する |
| [Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/) | 10,000 Neurons/日の無料枠、Paid超過$0.011/1,000 Neurons。token単価は比較用で実請求はNeurons。UTC 00:00に日次リセット | 残枠は未確認。無料枠なしで見積もる。既存モデルも表に残るため提供状況は別資料と照合 |
| [AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/) | Worker内でAI bindingを使える | `AI` bindingの追加と再配備が必要。外部provider APIキー投入やGateway追加を要件にしない |
| [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/) | Standard超過は$0.30/100万requests、$0.02/100万CPU ms。CPU既定30秒、最大5分。待ち時間とCPUを区別 | アカウント共有枠、契約・対象WorkerのCPU設定は今回未確認。既定値を実設定と断定しない |
| [D1料金](https://developers.cloudflare.com/d1/platform/pricing/) | Paid超過は読取$0.001/100万行、書込$1/100万行、保存$0.75/GB-month。indexの更新も計上 | SQLの結果件数とスキャン行数を区別し、実DB規模で見積りを再確認 |

## 見積りの再計算

### 有効化前の提供条件再確認（2026-09-28）

FP8個別ページとWorkers AI料金表を再取得し、指定IDの掲載、context 32,000、入力$0.152・出力$0.287/100万tokens、13,778・26,128 Neurons/100万tokensを再確認した。見積りは据え置く。公式掲載は個別アカウントの実行成功を保証しない。

モデルページから参照される[MetaのLlama 3.1 Community License](https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/LICENSE)と[Acceptable Use Policy](https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/USE_POLICY.md)、[Cloudflareのデータ利用条件](https://developers.cloudflare.com/workers-ai/platform/data-usage/)を確認した。今回の用途は本人限定の架空の計算・番号列挙で、モデル本体の配布や学習は含めない。利用ポリシーへの抵触は確認しなかった。モデルや派生成果を製品として提供・再配布する場合のライセンス添付・表示義務などは、将来の公開前に改めて確認する。製品資料上のモデル表示: **Built with Llama**。今回の準備で新規契約や追加規約への同意操作は行っていない。アカウント側で新たな契約・権限・課金条件を要求された場合は停止して本人へ確認する。

Cloudflareの上記資料ではモデル固有条件の確認を利用者へ求め、明示同意なしでWorkers AIの入力・出力をモデル学習やサービス改善へ使わないと説明している。アプリ側のD1への保存・削除は別途今回の検証対象とする。

2026-09-28の実行準備で[WorkersのCPU制限](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)も再確認。PaidのHTTPリクエストは既定30秒、設定可能な最大値は5分。DashboardのCPU欄が空であることと、対象の実効上限を30秒と確認したことを区別する。本人が配備前の実設定・生成設定を照合し、30秒より大きければ下記のCPU数量前提を再評価する。実CPU使用量を計測した結果ではなく、設定変更も行っていない。

無料枠を一切控除しない。FP8候補へ最大3回、各回のinputを全context 32,000、outputを現行コードの1,024 tokensと仮定する。実入力をtoken計測した値ではない。

- AI token表: `3 × (32,000 × 0.152 + 1,024 × 0.287) / 1,000,000 = $0.015473664`。
- Neurons表: input 13,778、output 26,128 Neurons/100万tokensから、同条件で`1,402.953216 Neurons × 0.011 / 1,000 = $0.015432485376`。表の換算丸めの差があるため大きい方を基準に約$0.016、AI目安$0.02とする。
- Workers参考: `30 × 0.30 / 1,000,000 + 900,000 × 0.02 / 1,000,000 = $0.018009`。
- D1参考: `10,000 × 0.001 / 1,000,000 + 1,000 × 1 / 1,000,000 + 0.001 × 0.75 = $0.001760`。
- 上記条件の合計は`$0.035242664`、端数を切り上げて約$0.0353。追加利用の申請目安は$0.05。税・為替・既存契約基本料金・他アプリ利用量を含まない。

基盤の数量は余裕を持った試算条件であり、実装済みの硬い数量上限ではない。推論回数の原子的制限とbyte上限もこの文書作成時点では未実装。共有枠の残量・課金反映の遅延・個別契約を確認し、条件が変われば実行せず見積りを更新する。
