# M-5の固定install・ローカル隔離手順の確認

確認日: 2026-10-04。仕様確認だけで、実アカウント/クラウドリソースへの照会・変更は行っていない。

| 一次資料・配布版 | 確認・採否・制約 |
| --- | --- |
| [pnpm install](https://pnpm.io/cli/install#--frozen-lockfile) | frozen-lockfileはlockを生成/更新せず、不整合で拒否する。現行資料の12.7以降の追加オプションは使わない。固定12.6.0のhelpと実installで照合 |
| [Cloudflare Local Data](https://developers.cloudflare.com/workers/local-development/local-data/) | Vite `persistState.path`とWrangler `--persist-to`を揃える。既定の元DBを流用せずM-5専用の新規領域を使用 |
| [D1 Local Development](https://developers.cloudflare.com/d1/best-practices/local-development/) | DB操作は明示`--local`。空DBの全migrationと再適用0を検証。remoteや既存DBのDROPは行わない |
| [Cloudflare Vite API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) | 固定plugin1.60.2の既存configに合わせて`remoteBindings: false`・専用persistState・configPathを使用。最新beta/cfへの移行や依存更新は採用しない |
| Wrangler4.141.0の`d1 migrations apply --help` | `--local`/`--persist-to`/`--config`を実helpで照合。非対話の確認省略と失敗migration rollbackの説明を確認。成功は実migration/check/HTTP結果で別に判定 |

M-0〜M-4のendpoint調査を実上流確認へ読み替えない。新しい価格・利用権限・データ保持・Gemini tokenizer/wrapperの条件を採用した記録ではない。[M-5検証メモ](../docs/M5-メディア統合と隔離複製検証.md)と[進捗](../docs/archive/plan.md)に実行範囲を残す。
