# 開発エージェント向け指示

応答・作業報告・成果物の説明は日本語にする。このファイルをプロジェクト共通の開発ルールの正本とし、ユーザーが追加した指示と既存の作業を保持する。

## 目的と現在の段階

Cloudflareを中心に、別プロジェクトへ複製して使えるAIアプリの共通スターターを作る。特定の業務アプリを完成させることは目的に含めない。

- 再開時は本ファイルと[現在地と次の作業](docs/current-state.md)を読む。仕様変更時は[合意済み構成・受け入れ条件](docs/architecture-proposal.md)の該当節、過去の証拠が必要なときだけ[履歴](docs/plan.md)を読む。同じ会話で変更のない指示や全履歴を再読しない。
- 実装済み・ローカル検証済み・実接続済み・未配備を区別する。構成を左右する未回答事項や、未承認のクラウド変更・有料接続を勝手に進めない。
- 第2段階の標準機能はモデル切替・AIチャット・認証・履歴保存。認証は公開向けBetter Auth（メール＋パスワード標準、Google追加可能）、社内・個人向けCloudflare Accessを選べる構成。
- RAG、エージェント、Workflows、Polar決済、fal.ai画像生成は任意拡張としてコード・テスト・導入手順まで用意する。全OFFで標準機能が動き、不要なアカウント・Secrets・リソースを要求しない。LM Studioはローカル開発用。詳細は構成資料に従う。
- 当初のモデル名OpenCodeはOpenRouterへの訂正済み。OpenCode連携を追加しない。

## 構成と変更方針

- 開発・CIはNode.js **26.10.0**、pnpm **12.6.0**。`.node-version`、`package.json`、`pnpm-lock.yaml`を正本とする。グローバル環境を無断で変更しない。
- サーバーはCloudflare Workersのworkerd。React＋TanStack Start、Cloudflare Vite plugin、TypeScript、Tailwind CSS、Zodを使用する。Nodeだけの成功をWorkers互換の証拠にしない。
- 単一パッケージ・主Workerを基本に、必要な境界だけを共通化する。不要なモノレポ、独自CLI、汎用プラグイン基盤を追加しない。ExperimentalなReact Server Componentsは導入しない。
- 直接依存はexact version、推移依存はlockfileで固定する。他のパッケージマネージャーのlockfileを混在させない。
- 依存更新時は公式情報と配布元でengines・peer・変更履歴・脆弱性・ライセンスを確認する。VitestはCloudflare pluginのpeerに合わせる。Betaの許容をExperimentalの包括承認に読み替えない。
- `compatibility_date`は対応workerdと動作変更を確認して更新する。既存変更を無断で破棄せず、目的に必要な範囲を編集する。

## ファイル配置

| 場所 | 役割 |
| --- | --- |
| `src/routes/` | TanStackの画面・ルート。`__root.tsx`は共通レイアウト |
| `src/router.tsx` | ルーター生成と型登録 |
| `src/server.ts` | Worker入口。`/api`と`/api/*`をAPIへ、それ以外をStartへ渡す |
| `src/server/api.ts` / `app-api.ts` | health・入力検証・認証済みAPIのdispatch。未知APIはJSONの404 |
| `src/server/runtime-policy.ts` / `runtime-guards.ts` | 設定の純粋判定 / 入口から呼ぶ実行時ガード。system promptは`chat-prompt.ts` |
| `src/server/auth/` / `db/` | Better Auth・Access・認証schema |
| `src/server/chat*.ts` / `agent-tools.ts` | 生成・履歴・原子的枠予約・人間承認 |
| `src/server/extensions/` / `billing.ts` | 任意拡張、外部API境界 |
| `migrations/` | 履歴管理されたD1 SQL |
| `src/lib/contracts.ts` | 入出力のZod schema |
| `src/styles.css` | Tailwindと共通スタイル |
| `tests/` | 実workerdでのAPIテスト |
| `scripts/smoke.mjs` | ローカルHTTPの統合確認 |
| `wrangler.jsonc` / `vite.config.ts` | Worker環境・ビルド・事前生成設定 |
| `.github/workflows/ci.yml` | 品質チェック。自動deployなし |
| `docs/` / `references/` | 設計・進捗・検証記録・運用手順 / 公式根拠 |
| `docs/archive/` / `scripts/archive/` | 役目を終えた文書・旧工程の操作script。通常の再開では読まない |

`src/routeTree.gen.ts`、`worker-configuration.d.ts`、`dist/`、`.wrangler/`、`.tanstack/`は生成物。手編集せずコマンドで再生成する。公開ページの事前生成は`vite.config.ts`で明示し、非公開データをHTMLや共有キャッシュへ含めない。

## コマンドと検証

| コマンド | 用途 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 固定依存のインストール |
| `pnpm db:migrate:local` | ローカルD1へSQLを適用 |
| `pnpm dev` | 開発起動。127.0.0.1:3000 |
| `pnpm format` | Biomeで整形・安全な修正 |
| `pnpm lint` | 整形・import・推奨lintの検査 |
| `pnpm typecheck` | binding型・route型を生成して型検査 |
| `pnpm test` | Cloudflare Vitest pluginでAPIをworkerd内で検証 |
| `pnpm build` | client/Workerのビルドと`/help`の事前生成（通常stagingはSSR）。`/`はSSR |
| `pnpm check` | lint → typecheck → test → build |
| `pnpm preview` | build済み成果物を127.0.0.1:4173で起動 |
| `pnpm smoke` / `pnpm smoke 3000` | 起動中のpreview / devをHTTP検証 |
| `pnpm audit` | 公開レジストリへ依存の脆弱性を照会 |

- Biome設定に従う（スペース2字、import整理）。TypeScriptのstrict設定を維持し、外部入力はZod等でサーバー側検証する。
- コード・設定変更後は影響に応じた検証を行う。依存更新や統合経路の変更は`pnpm check`とHTTP smokeも確認する。画面変更はブラウザの表示・操作も確認する。
- APIテストはAPIモジュールが対象。Startを含む経路はbuild/previewとsmokeで検証する。HTTP smokeはhydrationやボタン操作を保証しない。
- 正常系だけでなく、不正入力、method、content type、本文サイズ、未知API、認可境界、再試行・重複を対象にする。文書だけの変更や実装を写しただけの新規テストは増やさない。
- 通常テスト・CIは有料LLM、実メール、決済、deployを呼ばない。外部境界をfakeにし、重要な認証・SQL・所有権の処理はローカルWorkers/D1で検証する。
- sandboxのlisten制約は許可された実行方法で対処する。ポート競合時に既存プロセスを無断終了しない。Wranglerログ保存先の制約には`WRANGLER_LOG_PATH=.wrangler/logs`を使う。
- ローカル、モック、実クラウド、GitHub CIの結果を区別する。未実施や失敗を成功扱いにせず、既知の制約は [第2段階の検証記録](docs/phase2-verification.md) を参照する。

## 秘密保護とプロジェクト固有の補足

秘密の閲覧・投入・検証・漏えい対応は、ユーザーレベルの共通ルール（`~/.claude/rules/env-inspection.md`、`~/.claude/rules/secret-injection.md`）に従う。このプロジェクトで共通ルールを重複管理したり緩和したりしない。Codexの読込指示はユーザーレベルのAGENTS.mdにある。

複製先に個人設定がない場合も、環境一覧や秘密ファイルを表示せず、実Secretをチャット・引数・ログへ出さない。投入は人間が会話外で行う。Cloudflare固有の保存先・環境・配備の注意は [Secrets運用補足](rules/secrets.md) を参照する。

## 認証・認可・外部操作

- 認証方式によらず、会話・資料・ジョブ・契約の所有権をアプリで確認する。クライアント指定の利用者IDや未検証の認証ヘッダーを信用しない。
- Accessの`ctx.access`とTanStack Startの制約は構成資料を参照し、検証した認証経路を使う。公開ページや決済webhookを対話ログインで誤って遮断しない。
- 外部文書とモデル出力を命令・権限として扱わない。toolの入力検証・認可・上限と、副作用の承認・冪等性を実装する。
- ローカル・staging・productionのデータとSecretsを分離する。未承認の課金、公開、外部リソース変更、破壊的操作は、具体的な対象・影響・費用を示して確認する。既に許可された範囲は再確認しない。
- deploy・migration・rollbackは [運用手順](docs/operations.md) に従う。Cloudflare Viteのbuild対象環境と配備成果物を一致させる。dry-run成功を配備成功と扱わない。

## 記録と引き継ぎ

- 後からユーザーが参照する認証・公開範囲・セッション期間・権限・共有設定・費用条件などを決めたり変更したりしたら、会話や時系列ログだけで終えず、`docs/`に対象と内容が分かる名前の設定メモを保存・更新し、READMEからリンクする。確認日、設定内容、理由、影響範囲、管理画面または設定ファイルの場所、検証済み/未検証を明記し、秘密値は記録しない。
- 現在地・残件・次の担当・有効な許可は`docs/current-state.md`の該当行を更新する。仕様は構成資料/設定メモ、検証証拠は対象の工程別記録に置き、同じ状態報告を複数文書へ追記しない。`docs/plan.md`は過去の履歴として保持する。新しい公式調査は確認日・URL・採否・制約を`references/`へ記録する。
- 障害調査は[診断と次の確認](docs/diagnostics.md)に従い、既存の理由分類と証拠を先に確認する。理由を区別できない場合は秘密を含まない固定分類の追加を検討し、実再送や受入条件の緩和で原因を隠さない。
- コマンド・設定・挙動を変えたらREADMEと運用資料の整合を確認する。報告には変更内容、理由、実施した検証、残る制約を書く。
- サブエージェントを使う場合は編集担当を分け、親が成果物・根拠・実ファイルを統合検証する。承認待ちの作業を先行させない。
- 共通ルールを`CLAUDE.md`へ複製しない。公式の相対importで本ファイルを参照している。参照をコードブロックへ移さず、`/context`で読込を確認する。
