# 合意済み構成と受け入れ条件

更新日: 2026-09-27。**第1段階を完了後、ユーザーの明示再開により第2段階の標準機能・任意拡張を実装した。ローカル統合検証とクリーン複製検証を完了。** 根拠は[参照索引](../references/README.md)、現在の結果は[第2段階の検証記録](phase2-verification.md)。

2026-09-29の現在地: 当時のクリーン複製に加え、本人限定stagingで指定FP8の実接続2回と終了処理まで確認し、PR #2/#3の通常merge・main同期/検査も完了しました。取り込み完了時のmainは`061b0ba`で、そのmain CIはsuccess。現在はmain確定後、費用再照合と用途選択の段階です。最新依存修正版はローカル/CI検証済み・未配備。下記は合意の保存であり、実施状況は[全工程](plan.md)・[最終レビューと取り込み完了結果](main取り込み-最終レビューと次の用途.md)を参照してください。全provider・全任意拡張の実接続を一律の完了条件に追加しません。

## 採用構成と固定版

単一リポジトリ・単一パッケージ・1つの主Workerを基本にする。独自フレームワーク、独自CLI、モノレポ、汎用プラグインローダーは導入しない。必要な拡張だけ設定・binding・コードを組み込める通常のモジュールと導入手順を用意する。

| 層 | 推奨案 | 目的・代替案・留保 |
| --- | --- | --- |
| 開発環境 | Node.js 26.10.0 / pnpm 12.6.0 | インストール・ローカル検証済み。グローバル環境は変更せず一時toolchainを使用 |
| Web | React 19.3.0 + TanStack Start 1.168.58 / Router 1.170.39 | strict peer解決・SSR・prerender・ブラウザ通信を確認。公式RC表記を了承して採用。基本機能に絞る |
| ビルド | Vite 8.3.1 / CF Vite plugin 1.60.2 / Wrangler 4.141.0 | 開発・previewのWorker処理をworkerdで実行 |
| 品質 | TypeScript 7.0.2 / Biome 2.5.14 / Vitest 4.1.11 / CF Vitest plugin 1.2.8 | 最新Vitest5はCF plugin peer範囲外。対応後に再検討 |
| UI / 入力 | Tailwind CSS 4.3.3 / Zod 4.6.5 | 導入済み。CVA / clsx / tailwind-mergeは現行UIで不要なため未採用 |
| 認証・DB | Better Auth 1.7.6 + D1 + Drizzle ORM 0.45.3（migrationは明示SQL）。社内・個人用はCloudflare Accessも選択可能 | Better Authはメール＋パスワード標準、Google追加可能。認証方式によらず会話・ジョブ・契約権限の所有権をアプリで確認 |
| モデル | AI SDK 7 + 各provider | 選択境界だけ共通化。設定済みかつ許可したモデルのみ実行 |
| 永続チャット | D1の会話・メッセージテーブル | HTTP streamingと履歴保存を標準にする。DO/AIChatAgentによるストリーム再開は今回の標準要件に含めない提案 |
| 可観測性 | Workers Logs + 最小限の構造化ログ | 会話本文・個人情報・秘密値を不要に保存しない。Traces等のBeta機能はコア必須にしない |

第1段階の導入済み版は `package.json` / `pnpm-lock.yaml` が正本。strict peerでインストールし、lint・型検査・18件のworkerdテスト・build・HTTP疎通を確認。`pnpm audit`は既知の脆弱性0件。workerd 1.20260925.1に合わせ、compatibility_dateを2026-09-25に固定した。第2段階の認証/DB/モデル/拡張も固定版を導入した。現在の依存はpackage.json、機能検証の結果はphase2-verification.mdを正本とする。

## フロントエンドの決定

**採用: TanStack Start**。ユーザーは学習コストが急増しない範囲での採用を承認した。WorkersでSSRとprerenderが扱え、公開トップ/ヘルプ等の事前生成とログイン後アプリを同じReact基盤に置ける。SSGは全ページの必須要件にせず、ページ単位で選べる構成にする。公式Overviewは調査時Release Candidate表記で、更新対応を見込む。基本機能から始め、ExperimentalなReact Server Componentsは導入しない。

**代替**: React RouterのSSRは引き続き適切な案。Cloudflare Vite plugin連携ではSPA mode/prerenderが非対応なので、その制約を許容する場合に選ぶ。Next.jsのAPIやRSCを重視するならCloudflare推奨のvinext（Beta、Next.js API再実装）も有力。コンテンツ中心ならAstro、Svelteを使いたいならSvelteKitも比較する。詳しい比較と公式根拠は [フロントエンド比較](../references/frontend-auth-billing.md)。Cの長時間処理はWorkers/Workflows側で設計でき、UIフレームワークだけでは決まらない。

ユーザーは公式が注力するOpen Betaを許容し、TanStack Startを個別に採用した。第1段階の固定版はTanStack Startのpeerとローカル実動で確認済み。比較した代替案への切り替えをこの合意に含めない。

## 第1段階の実装と完了証拠

再開指示に従い下記を構築する。認証・チャット・RAG・課金等の機能実装は第2段階。

| 成果物 | 実行・確認する証拠 |
| --- | --- |
| 依存・ランタイム固定 | 指定版でのpnpm install、lockfile、packageManagerとNode版指定 |
| 公開画面・Worker最小API | 日本語の最小画面、`/api/health`、JSON入力検証用の無害な疎通処理。SSR HTMLとクライアントの疎通表示 |
| 開発・build/preview | 開発起動のHTTP確認、build成功、build後のWorker previewで同じHTTP動作 |
| format/lint/typecheck | route typegen / bindings型生成を含むコマンド実行結果 |
| 意味のあるWorkersテスト | 実workerdでhealth、method不一致、未知API、無効入力、JSON content type、意図しないSPA fallbackの防止を確認 |
| CI | ローカルと同じ検証を実行するGitHub Actions案。実際のGitHub上の実行とローカル成功は区別 |
| 環境・運用 | local/staging/production、Secrets、binding、migration、依存更新、セキュリティ監査、deploy/rollbackの手順 |
| 共通開発ルール案 | docs内に記載。AGENTS.md / CLAUDE.mdは先行作成しない |
| 第2段階計画 | 以下のサンプル・受け入れ条件を確定し、未確認事項を明示 |

第1段階の実クラウド検証は別途公開・操作範囲を確認する。ローカルworkerd検証をCloudflare本番接続成功と読み替えない。必要な接続や検証ができない場合はその項目を未実施として報告する。

## 第2段階: 標準機能の受け入れ条件

| 機能 | 動くサンプルと受け入れ条件 |
| --- | --- |
| 認証 | 公開サービスはBetter Authで登録・ログイン・ログアウト・セッション失効、メール確認/再設定、任意Googleログイン。社内・個人用はAccessを選択可能。未ログイン拒否、CSRF/Origin/Cookie、ログイン制限、両認証方式での所有権を検証。ログにtoken/認証URLを出さない |
| チャット | メッセージ送信→Worker→選択provider→stream表示→履歴保存。入力/出力上限、timeout、中断、429、途中失敗を検証 |
| モデル切替 | Workers AI / OpenAI / Anthropic / Google / OpenRouterをサーバーの許可一覧から選択。未設定providerは無効。秘密値をブラウザへ渡さない |
| LM Studio | ローカル開発でOpenAI互換APIに接続する手順とサンプル。公開Workerから開発PCのlocalhostへ接続できるとは説明しない |
| 履歴 | 再読み込み後の復元、会話一覧・取得・追加・削除、別ユーザーからのアクセス拒否、重複送信、途中失敗状態を検証 |
| 利用制限 | ユーザー別制限・モデル許可・入力/出力/step数上限。厳密な利用枠は永続的な原子的予約を検討し、eventually consistentなrate limitを課金台帳扱いしない |
| 公開ページ | 公開トップ/ヘルプのHTML本文・metaを確認。非公開データを公開HTMLや共有キャッシュへ含めない |

認証方式は合意済み。Better Authはメール＋パスワードを標準、Googleログインを設定で追加可能にする。認証メールはCloudflare Email Service（Public Beta）の採用を追加合意した。メール送信未設定のまま本番のメール確認を省略して完成扱いにしない。Google設定を標準起動の前提にしない。

Cloudflare Accessは社内・個人用へ複製するときの選択肢にする。Accessで認証した利用者もアプリ内の利用者IDへ安全に対応付け、会話・資料・ジョブ・契約権限の認可を省略しない。公開トップ/ヘルプやPolar webhookを対話ログインで遮断しないよう保護範囲・ルーティングを設計する。webhookはログイン不要でも署名検証を必須にする。検証なしの利用者ヘッダーを信用せず、Cloudflare公式統合の保証範囲に合わせた認証検証を行う。

Accessの `ctx.access` はStatic Assetsの内部routerを越えて伝播せず、TanStack Startも影響を受けると公式が明記している。利用者識別をこれだけに依存させず、署名付きJWTをjoseで検証する経路を実装した。詳細と根拠は [認証の比較資料](../references/frontend-auth-billing.md#cloudflare-accessの選択構成) を参照。

## 第2段階: 任意拡張の実装範囲と受け入れ条件

以下のサンプルはすべて承認済みで、第2段階にコード・テスト・導入手順まで実装する。現在の実装と検証結果はphase2-verification.mdを参照。OFF状態で追加Secrets・binding・クラウドアカウントがなくても標準機能が動くことを、個別拡張ON・全OFFの両方で検証する。

| 拡張 | サンプル | 受け入れ条件 |
| --- | --- | --- |
| RAG | 資料を登録→R2原本→AI Search検索→出典付き回答 | 認証済み所有者に基づく検索分離、他ユーザー資料へのアクセス拒否、未索引・0件・削除反映待ちの扱い。AI Search Open Beta採用は合意済み |
| エージェント | 許可した資料検索・メモ下書きツールをモデルが選び、保存は人間の承認後 | Zod検証・認可・step上限、拒否・期限切れ・未許可tool・不正モデル出力を検証。RAG無効でも使える所有者限定メモ検索を用意し、拡張間の強制依存を避ける |
| 長時間処理 | 依頼受付→資料/入力を要約→承認待ち→保存 | Workflowsのjob再取得、retry上限、途中復旧、重複要求、他ユーザーによる承認拒否。外部副作用の冪等性はstep復旧と別に検証 |
| 決済 | Polar sandboxのCheckout→Webhook→契約権限→Customer Portal | raw body署名、再送/同時重複/順序逆転、成功前の永続化、契約変更を検証。Stripeは次回対象 |
| fal.ai画像生成 | プロンプト→画像1枚の受付/状態/結果表示 | モデル・枚数・サイズ上限、job所有権、失敗・timeout・取消を検証。チャットモデルと別UI/機能として扱い、未設定時にkey不要 |

fal.aiの画像生成は標準チャットから独立して有効化する。今回の承認済みサンプルは画像1枚。AI SDK providerのvideo型はExperimentalであり、動画/音声は今回の実装範囲に含めない。全モデル/全機能対応を約束した扱いにしない。

Agents SDK / AIChatAgent / DOは必要性が明確な場合の代替。今回のチャットD1とThinkの履歴・stateを二重管理しないため、エージェントはAI SDKの明示したtoolsから始める提案。ThinkのExperimental留保、Sandbox/Code Mode等を採用したい場合は別途相談する。

AI Gatewayは接続例と導入手順を用意する任意の運用機能案。通常のprovider直接接続も維持し、Gatewayの未設定が標準起動を妨げない。ログ保存・費用制御等のBeta機能を必要条件にしない。

## 検証と費用

通常CIは実LLM・メール・Polar課金を呼ばない。認証・SQL・所有者分離・HTTPはローカルWorkers/D1で確認し、外部境界だけfake化する。実provider疎通、AI Search索引、Workflowsクラウド復旧、Polar sandboxは独立した検証表にし、モデル・回数・費用上限・公開範囲を具体化して実施する。

月額5ドルは全機能使い放題ではない。アカウント共有枠の残量は未確認。推論・画像生成等の価格は利用モデル決定後に見積もる。第1段階はローカル中心で追加の有料推論を行わない。詳細は [費用・運用](../references/costs-operations.md)。

## 合意後の順序

1. 第1段階: 上記環境を構築し、実行検証・ユーザー確認手順・残る制約を報告してGoalを一時停止。
2. ユーザーが環境を確認し `/init 日本語で` を実行。
3. 明示の再開後: 指示ファイルを読み直し、標準機能→各任意拡張の順に実装・検証。
4. 最終: 別のクリーンディレクトリへ複製し、READMEだけでセットアップ・起動・検証。コード・設定・README・AGENTS.md・CLAUDE.mdの整合を監査。
