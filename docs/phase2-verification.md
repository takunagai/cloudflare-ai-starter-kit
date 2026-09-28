# 第2段階の検証記録

2026-09-28レビュー: 原子的予約・重複・期限・失敗履歴の回帰検証を4件追加し、checkの197テスト（15ファイル）・lint57ファイル・型検査・buildが成功。詳細と送信後の検査結果は[実装状況](実AI検証制御-実装状況.md)へ記録する。

2026-09-28後続: [実AI検証制御](実AI検証制御-実装状況.md)を追加し、lint・型検査・193テスト（15ファイル）・build、0006のlocal D1適用、HTTP smoke、固定応答UIの保存/復元/試験会話削除を確認。以下の157テスト・5 migrationは以前の検証時点。実AI・実stagingでの会話保存/復元/削除は未実施のまま。

更新日: 2026-09-27。第2段階の実装と、第3段階の文書整備・ローカル最終検証を完了。実クラウドの接続成功とは区別する。

## 実行環境

Node.js 26.10.0、pnpm 12.6.0、workerd 1.20260925.1。グローバル環境は変更せず固定toolchainで実行。sandbox内ではローカルlistenとレジストリ接続が制限されるため、必要なコマンドを許可されたローカル実行として実施した。

## 確認済み

- 実workerd/D1で認証・セッション・所有権・チャット保存・日次/同時実行制限・承認保存を検証。
- チャット途中の読取取消、60秒deadline、provider途中失敗で部分本文とfailed/cancelled状態を保存。
- 会話削除によるquotaリセットを防止。承認期限の時刻を1回取得し、保存と状態変更を同じ時点で判定。
- RAGは実D1/R2とfake検索、falとPolarはfake HTTP/API、メールはfake SendEmailで検証。
- Workflowsはnativeローカルruntimeで承認・拒否・timeout・retryを検証。クラウド上の障害復旧は未検証。
- 0001〜0005の5本のmigrationを空のローカルD1へ適用。既存0001〜0004のDBにも0005を追加適用し、再適用で未適用なしを確認。
- client/Worker buildと`/help`事前生成が成功。
- ブラウザのローカルpreviewで架空アカウント登録、固定応答チャット、再読み込み後の会話選択・履歴復元を確認。

## 最終チェック

| 対象 | 結果 |
| --- | --- |
| 元プロジェクト `pnpm check` | lint、型生成/型検査、157テスト（13ファイル）、client/Worker build、`/help`事前生成がすべて成功 |
| `pnpm audit` | 既知の脆弱性の報告なし。推移依存esbuildの限定overrideは運用資料に理由を記録 |
| 最新buildのpreview + `pnpm smoke` | SSR HTML・公開asset・404・API、全拡張OFF、登録・固定応答・履歴・重複要求・削除・ログアウト成功 |
| クリーン複製 | 別ディレクトリ・別package/Worker/D1名でfrozen install、整形、空DB migration、同じ157テストを含むcheck成功 |
| 複製先dev + `pnpm smoke 3000` | 起動・公開ページ・認証・チャット一連・全拡張OFFが成功 |
| ブラウザ | 登録・固定応答・再読み込み後の履歴復元、承認前は未保存→人間の承認後にメモ保存を確認 |
| 再設定画面 | ダミーtokenのURLから、既存セッションがあっても再設定フォームを表示しURLからtokenを除去。ブラウザで実パスワード変更はしていない |
| GitHub Actions（後続確認） | 非公開リポジトリの `main` で、修正後の `verify` が成功。frozen install、`pnpm check`、ローカルD1 migration、build済みWorkerのHTTP smoke、`pnpm audit` を実行 |

クリーン複製は`/private/tmp/cloudflare-starter-clone-sje5xefs`で検証。依存ディレクトリ、build、ローカルDB、生成型、Secretsは持ち込まず、ソース・設定・lockfile・資料だけを複製した。package/Worker名を`cloned-ai-app`、ローカルD1名を`cloned-ai-app-local`へ変更した。これは検証場所の記録であり、実装の絶対パス依存ではない。最終コード・テスト・migrationは元と同一。名称変更後に必要な`pnpm format`をREADMEへ反映した。

ブラウザの承認確認では複製先だけ一時的にエージェント拡張をONにし、確認後は全OFFへ戻して最終checkを通した。固定応答はAI未使用で、実モデルのtool選択品質は未確認。認証・AI・決済の外部通信はテスト境界でfake化した。

画面確認の画像は後続の公開用履歴整理でGit管理から除外したため、共有用の画像リンクは置かない。ローカル確認用の架空アカウントと会話がローカルDBに残る。実Secretは使用していない。

## 2026-09-27時点で実接続を行っていなかったもの

以下はローカル最終検証時点の記録。後続では専用stagingの配備・DNS/Access設定、本人のOTP受信・Accessログイン・認証後UI・D1レート制限書込みを確認しました。2026-09-29には指定FP8での実AI応答2回・逐次表示・会話の保存/復元/削除と、終了後のAI無効化・Access遮断を確認済みです。他モデル・任意拡張・アプリの実メール/決済は未検証。[作業ログ](staging-work-log.md)と[最小検証計画](実AI接続-最小検証計画.md)でローカル検証と実接続結果を区別してください。

| 対象 | ローカル検証 | 実接続前に必要なこと |
| --- | --- | --- |
| Better Auth + Email Service | D1、確認/再設定フロー、fake送信 | stagingのD1・Secret・送信ドメイン登録。DNS変更と実送信範囲を承認 |
| Google OAuth | 設定境界・許可URL生成 | OAuthクライアント、callback、テストアカウント |
| Access | 署名/issuer/audience/期限/所有権 | Zero Trust application、公開/保護ルート、実JWT到達 |
| モデル各社/Workers AI | SDK変換、fake境界、固定応答 | 環境別資格情報/binding、利用可能モデル、回数/費用上限 |
| LM Studio | OpenAI互換fake endpoint | 開発PC上の実モデルとlocalhost API |
| RAG | 所有権・metadata・削除・枠 | R2/AI Search作成、実索引metadata・検索品質 |
| Workflows | nativeローカル実行とstep fake | 環境別binding、クラウドの復旧・観測 |
| fal.ai | 受付/状態/取消・所有権 | API鍵、モデル課金確認、画像1枚の実生成 |
| Polar | 新旧署名、冪等性、順序逆転、SDK fake | sandbox組織/商品/webhook、実sandbox Checkout/Portal |

この表の作成時点では実deploy、実メール、DNS変更、有料AI、実決済は未実施でした。後続のAccess OTP成功はアプリ自身のEmail Service送信検証とは別です。実AI、アプリの実メール、実決済、その他任意拡張の実接続は未実施のままです。GitHub Actions上のCI成功を実接続成功とは扱いません。

## GitHub CIの後続確認（2026-09-27）

`takunagai/cloudflare-ai-starter-kit` を非公開で作成し、ローカル `main` をpushした。初回の[run 36314699076](https://github.com/example/cloudflare-ai-starter-kit) はpnpmのセットアップ前に `actions/setup-node` がpnpmを探して失敗した。セットアップ順を修正し、[run 36314778588](https://github.com/example/cloudflare-ai-starter-kit) の `verify` が2分8秒で成功。GitHub上の実行結果を確認した。

同runに残ったpnpm ActionのNode.js 20非推奨と`ubuntu-latest`の将来移行のannotationへ対応。pnpm 12対応のAction v6.1.0に更新し、runnerを`ubuntu-24.04`へ固定した。[run 36315741871](https://github.com/example/cloudflare-ai-starter-kit)の全ステップが成功し、check runのannotation件数は0件。公式根拠と将来の26.04移行方針は[GitHub Actions調査](../references/github-actions.md)に記録。

## 既知の非致命的な警告

- TanStack route生成の`replaceRouteChunk`循環依存警告（第1段階から継続）。
- 一部SDK配布物のsourcemap元ファイルが未同梱。テスト結果と分けて記録。
- Workflowsの失敗系テストで、ローカルruntimeがWorkflowTimeoutError、固定のtest failure、SUMMARY_WORKFLOW_FAILEDのstackを出す。テスト期待どおりの失敗経路であり、実入力/秘密は使わない。
