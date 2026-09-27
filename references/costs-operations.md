# 費用・環境・検証の方針案

確認日: 2026-09-27。以下の料金は公式公開値であり、ユーザーアカウントの残枠・請求実績・個別契約は確認していない。

## 料金と設計への影響

| 機能 | 確認内容 | 設計上の判断 |
| --- | --- | --- |
| Workers Paid | 最低$5/月。リクエスト1,000万/月とCPU 3,000万ms/月を含み、超過は従量 | 既存契約を前提とするが、他アプリと枠を共有するため追加費用ゼロとは保証しない |
| Static Assets / SSR | 静的アセットへのリクエストは基本無料。Workerで描画・処理するリクエストは課金対象 | SSRの公開ページはWorker負荷を計測。認証ページを共有キャッシュしない |
| D1 | Paidは読取250億行/月、書込5,000万行/月、保存5GBを含む | index・ページング・所有者条件で無駄な走査を減らす |
| R2 Standard | 無料枠10GB-month、Class A 100万/月、Class B 1,000万/月。超過有料 | ファイル拡張利用時のみ設定。Infrequent Accessの無料枠と混同しない |
| Workflows | requests/CPUに加えてsteps/storageの料金体系。Paidは50万step/月、1GB-monthを含む | retry上限、保持期間、重複実行防止を設計。永続状態の保存も費用に含む |
| AI Search | Open Beta中は制限内無料。Workers AIとAI Gatewayは別料金 | 検索基盤自体の将来料金を固定値として保証しない。Betaを明示して拡張採用を相談 |
| 推論 / fal.ai | provider・モデル・入出力・生成物で異なる | モデル/回数/上限を決めた実接続検証だけ別見積。自動有料fallbackを既定にしない |

根拠: [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、[R2料金](https://developers.cloudflare.com/r2/pricing/)、[Workflows料金](https://developers.cloudflare.com/workflows/reference/pricing/)、[step/storage課金告知](https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/)、[AI Search料金](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)。Workflows課金告知の開始表現は「2026-08-10より前には開始しない」であり、全アカウントの課金開始を確認したわけではない。

AI Searchの現行料金にはmanaged storage/vector indexing/crawlingの項目が含まれる。古い個別R2/Vectorize課金モデルをそのまま適用しない。アプリで原本用R2を別途使う場合、その利用量は別に見積もる。

## 再現性

以下の初期候補から、第1段階ではNode 26.10.0 / pnpm 12.6.0 / Tailwind 4.3.3 / Zod 4.6.5を固定して実行確認した。グローバル環境は変更していない。CVA / clsx / tailwind-mergeは第2段階の共有UIで必要になった時点で導入する。最新の運用手順は [運用文書](../docs/operations.md)、結果は [検証記録](../docs/phase1-verification.md)。

- ユーザー指定のNode.js 26.xを採用。[公式リリース](https://nodejs.org/en/blog/release/v26.10.0)で26.10.0 Currentを確認。LTSとは記載しない。ローカル現状26.5.1との差を解消し、プロジェクト/CIで同じ版に固定する案。
- pnpmは公開registry latest 12.6.0を確認。ローカル現状は11.21.0。採用候補を12.6.0として `packageManager` とlockfileに固定する。グローバル設定を無断変更しない。
- pnpm frozen lockfileによるCI、互換範囲とsecurity advisoryの確認、更新PRごとのlint/typecheck/test/buildを行う。調査中に新しいpatchが見つかっても、固定後に無条件更新し続けない。
- UI候補: Tailwind CSS / @tailwindcss/vite 4.3.3、Zod 4.6.5、class-variance-authority 0.7.1、clsx 2.1.1、tailwind-merge 3.7.0。配布元latestを直接確認。Tailwind pluginのVite 8対応はpeer宣言で確認。実動作は未検証。

配布元: [pnpm](https://registry.npmjs.org/pnpm/12.6.0)、[Tailwind plugin](https://registry.npmjs.org/@tailwindcss%2fvite/4.3.3)、[Zod](https://registry.npmjs.org/zod/4.6.5)、[CVA](https://registry.npmjs.org/class-variance-authority/0.7.1)、[clsx](https://registry.npmjs.org/clsx/2.1.1)、[tailwind-merge](https://registry.npmjs.org/tailwind-merge/3.7.0)。

## 第1段階で具体化する運用

以下は設計案。コマンドは実装後に実行確認してからREADMEの正式手順にする。

- local / staging / productionで設定とbindingsを分離。D1・R2等を共用しない。ローカルはエミュレータで、remote bindingによる有料アクセスを既定で有効化しない。
- Secretsはサーバー側だけ。クライアント向け変数に認証情報を入れない。ダミー例・ignore・ログ方針を用意し、秘密値や認証URLを出力しない。
- SQL migrationをレビュー可能なファイルにし、local→staging→productionの順で適用。Workerロールバックとデータの復旧を分離し、破壊的schema変更には復旧手順を要求する。
- CIはinstall / format check / lint / typecheck / Workers runtime test / build。デプロイは別の明示操作で、CI成功だけで本番公開しない。
- Workerの既知の版へ戻す手順と、D1の復旧方針を文書化。実クラウドでの実行結果とローカル検証を分けて記録する。
- 通常CIはLLM・メール・決済のmockを利用。認証やデータ分離、SQL、WorkerのHTTP動作はmockだけにせず実runtime/local D1で検証する。
- Codex/Claude Code共通ルール案は通常の設計資料へ置く。第1段階終了後にユーザーが `/init 日本語で` を実行するまでAGENTS.md / CLAUDE.mdは作らない。
