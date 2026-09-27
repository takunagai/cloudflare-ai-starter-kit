# Cloudflare製品と最近の更新: 初期調査

確認日: 2026-09-27。製品ごとの提供状況・費用・互換性が未確認のものはコアへ採用しない。

## 確認した公式資料

- [公式製品一覧](https://developers.cloudflare.com/directory/): Workers、Static Assets関連、D1、R2、Durable Objects、Workflows、Queues、AI Gateway、Workers AI、Agents、AI Search、Vectorizeなどを候補として確認。
- [公式Changelog](https://developers.cloudflare.com/changelog/): 最近の更新の入口。
- [AI Search](https://developers.cloudflare.com/ai-search/): Open Betaを追加確認。RAGを任意拡張として実装する要件は合意済みで、AI Searchの採用は相談待ち。
- [Email Service](https://developers.cloudflare.com/email-service/): 認証メールが必要な場合の追加調査候補。
- [Flagship](https://developers.cloudflare.com/flagship/): 機能フラグの候補。具体的要件が現時点ではなく、コアへの採用予定なし。
- [Artifacts](https://developers.cloudflare.com/artifacts/): 公式本文でclosed betaを確認。ファイル成果物管理の具体的要件が現時点ではなく、コアへの採用予定なし。

## 参考資料から追加する検討項目

公式Changelogの2026-09-22「Test every pull request in an isolated environment with Worker Previews」で、コード・設定・URL・可観測性をPreviewごとに分離する機能を確認した。Wrangler 4.135.0以降を案内している。Durable Objects/Containersの分離に対し、D1/R2/KVなどアカウント単位のリソースは別リソースへ接続する必要がある。

詳細: [Worker Previews公式](https://developers.cloudflare.com/workers/previews/)。

**プロジェクト判断**: 検証環境の候補として調べる。Previewという機能名だけから提供段階を断定しない。提供条件・費用・現行制約を確認するまでは採用未決定。公開やリソース作成は未実施。

## 現時点の採否

| 区分 | 候補 | 理由 |
| --- | --- | --- |
| コア候補・構成相談待ち | Workers + Static Assets、Vite、React Router SSR、D1、AI SDK | 認証・履歴・モデル切替の標準搭載要件を満たす提案 |
| 任意拡張の採用技術を相談 | R2、AI Search、Workflows、AI Gateway | RAG/Agent/長時間/決済を実装済み任意拡張として納品することは合意済み |
| 代替・当面保留 | Durable Objects、AIChatAgent、Vectorize、Queues | 永続WebSocket/復元、独自検索、大量処理等の追加要件が明確な場合に再評価 |
| 当面保留 | Sandbox、Code Mode、Agent Memory、Flagship、Artifacts | 必要性・提供状況を確認してから再評価。標準機能のために一括導入しない |

これは設計案であり、公式がこの組み合わせを保証するという意味ではない。認証ライブラリ、AI SDK provider、Workers実行環境の相互互換性は調査・テストで別途確認する。
