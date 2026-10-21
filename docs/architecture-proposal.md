# 合意済み構成と受け入れ条件

整理日: 2026-10-21。合意した仕様の参照先。実装・検証・許可の現在地は[current-state.md](current-state.md)、過去の追記と変更理由は[旧版](archive/architecture-history.md)に分離した。状態報告は本書へ重複追記しない。

## 次期整備方針の合意（2026-09-29）

1つの共通スターターと、ローカル試作・個人/社内利用・公開サービスの3つの導入入口を採用する。用途、環境、AI接続、任意拡張は独立に選ぶ。3用途を順番に移行する必要はない。対話式セットアップと認証方式間のID/所有権/session移行は初版に含めない。

通常stagingは専用のWorker/DBにする。AI_MODE（OFF/固定応答/選択モデル）と許可モデルをサーバーで確認し、資格情報だけでは実AIを有効化しない。旧検証モードは2026-10-19に廃止した。`STAGING_POLICY=standard`を明示しないstagingは閉じ、旧台帳に行があるD1を通常stagingに再利用しない。認証・logout・所有者の履歴参照/削除を生成設定の不備で妨げない。[実行時方針](runtime-policy.md)と[公開設定/build境界](公開プリセットとbuild境界.md)を正本とする。

TypeSafe AI Jevは任意拡張（2026-10-21に本人が決定）。Choice/Score/Noul、分類APIと利用画面をチャットから独立して扱い、RAG/agentを前提にしない。既定OFF（`JEV_MODE=off`）、接続時は固定版モデルとサーバー側Secretを要求する。認証・所有権・副作用承認をモデルへ委譲せず、unknownの消費/同時枠を自動解放しない。数値、台帳保持、未確認の上流条件は[Jev契約](Jev-B3J-実装前契約.md)を参照する。

falは従来の画像サンプルに加え、[画像・動画・音声の初版設計](fal-画像動画音声-初版設計.md)と[M-0の設定契約](fal-メディア-M0差分設計.md)を採用する。専用private R2と通常Workerの限定素材取得経路を使う。参照画像7日・生成物30日・所有者1 GiB/環境10 GiB、ジョブ本文終端30日・本文なし台帳終端90日と、unknown保持の補足を維持する。Directorは対象外。媒体ごとの実上流の確認（`MEDIA_VERIFIED_*_MODELS`）が通常生成の解放条件で、ローカル成功だけで解放しない。mediaも任意拡張で、既定OFF。

## 採用構成と固定版

単一リポジトリ・単一パッケージ・1つの主Workerを基本にする。独自フレームワーク、独自CLI、モノレポ、汎用プラグインローダーは導入しない。必要な拡張だけ設定・binding・コードを組み込める通常のモジュールと導入手順を用意する。

| 層 | 推奨案 | 目的・代替案・留保 |
| --- | --- | --- |
| 開発環境 | Node.js 26.10.0 / pnpm 12.6.0 | グローバル環境は変更せず、`.node-version`と`package.json`の`engines`を正本とする |
| Web | React + TanStack Start / Router | strict peer解決・SSR・prerender・ブラウザ通信を確認。公式RC表記を了承して採用。基本機能に絞る |
| ビルド | Vite / Cloudflare Vite plugin / Wrangler | 開発・previewのWorker処理をworkerdで実行 |
| 品質 | TypeScript / Biome / Vitest / Cloudflare Vitest plugin | Vitestはpluginのpeerに合わせる |
| UI / 入力 | Tailwind CSS / Zod | CVA / clsx / tailwind-mergeは現行UIで不要なため未採用 |
| 認証・DB | Better Auth + D1 + Drizzle ORM（migrationは明示SQL）。社内・個人用はCloudflare Accessも選択可能 | Better Authはメール＋パスワード標準、Google追加可能。認証方式によらず会話・ジョブ・契約権限の所有権をアプリで確認 |
| モデル | AI SDK 7 + 各provider | 選択境界だけ共通化。設定済みかつ許可したモデルのみ実行 |
| 永続チャット | D1の会話・メッセージテーブル | HTTP streamingと履歴保存を標準にする。DO/AIChatAgentによるストリーム再開は今回の標準要件に含めない提案 |
| 可観測性 | Workers Logs + 最小限の構造化ログ | 会話本文・個人情報・秘密値を不要に保存しない。Traces等のBeta機能はコア必須にしない |

固定版の正本は`package.json`と`pnpm-lock.yaml`（この表に版を重ねて書かない）。直接依存をexact version、推移依存をlockfileで固定する。compatibility_dateは対応workerdとの整合を確認して更新する。過去の検証は[第2段階の記録](archive/phase2-verification.md)、直近の対象版と未配備差分は[current-state.md](current-state.md)を参照する。

## フロントエンドの決定

**採用: TanStack Start**。ユーザーは学習コストが急増しない範囲での採用を承認した。WorkersでSSRとprerenderが扱え、公開トップ/ヘルプ等の事前生成とログイン後アプリを同じReact基盤に置ける。SSGは全ページの必須要件にせず、ページ単位で選べる構成にする。公式Overviewは調査時Release Candidate表記で、更新対応を見込む。基本機能から始め、ExperimentalなReact Server Componentsは導入しない。

**代替**: React RouterのSSRは引き続き適切な案。Cloudflare Vite plugin連携ではSPA mode/prerenderが非対応なので、その制約を許容する場合に選ぶ。Next.jsのAPIやRSCを重視するならCloudflare推奨のvinext（Beta、Next.js API再実装）も有力。コンテンツ中心ならAstro、Svelteを使いたいならSvelteKitも比較する。詳しい比較と公式根拠は [フロントエンド比較](../references/frontend-auth-billing.md)。Cの長時間処理はWorkers/Workflows側で設計でき、UIフレームワークだけでは決まらない。

ユーザーは公式が注力するOpen Betaを許容し、TanStack Startを個別に採用した。第1段階の固定版はTanStack Startのpeerとローカル実動で確認済み。比較した代替案への切り替えをこの合意に含めない。

## 第1段階の実装と完了証拠

開発基盤の受け入れ条件は、固定依存、型/lint、workerd API、SSR/prerender、build/previewとHTTP smoke、環境別の運用手順。過去の検証版は[第2段階の検証記録](archive/phase2-verification.md)と[構成資料の旧版](archive/architecture-history.md#第1段階の実装と完了証拠)で確認する。現在の進捗は[current-state.md](current-state.md)で管理する。

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

以下は合意済みのサンプルと受け入れ条件。実装・検証の現在地は[current-state.md](current-state.md)、個別の設定は[拡張手順](extensions.md)を参照。OFF状態で追加Secrets・binding・クラウドアカウントがなくても標準機能が動くことを、個別拡張ON・全OFFの両方で検証する。

| 拡張 | サンプル | 受け入れ条件 |
| --- | --- | --- |
| RAG | 資料を登録→R2原本→AI Search検索→出典付き回答 | 認証済み所有者に基づく検索分離、他ユーザー資料へのアクセス拒否、未索引・0件・削除反映待ちの扱い。AI Search Open Beta採用は合意済み |
| エージェント | 許可した資料検索・メモ下書きツールをモデルが選び、保存は人間の承認後 | Zod検証・認可・step上限、拒否・期限切れ・未許可tool・不正モデル出力を検証。RAG無効でも使える所有者限定メモ検索を用意し、拡張間の強制依存を避ける |
| 長時間処理 | 依頼受付→資料/入力を要約→承認待ち→保存 | Workflowsのjob再取得、retry上限、途中復旧、重複要求、他ユーザーによる承認拒否。外部副作用の冪等性はstep復旧と別に検証 |
| 決済 | Polar sandboxのCheckout→Webhook→契約権限→Customer Portal | raw body署名、再送/同時重複/順序逆転、成功前の永続化、契約変更を検証。Stripeは次回対象 |
| fal.ai画像生成 | プロンプト→画像1枚の受付/状態/結果表示 | モデル・枚数・サイズ上限、job所有権、失敗・timeout・取消を検証。チャットモデルと別UI/機能として扱い、未設定時にkey不要 |

fal.aiは標準チャットから独立して有効化する。従来の画像1枚サンプルに加え、追加合意した画像4・動画4・音声4 endpointと参照画像を[メディア初版設計](fal-画像動画音声-初版設計.md)に従って扱う。全モデル/全機能対応は含めない。

Agents SDK / AIChatAgent / DOは必要性が明確な場合の代替。今回のチャットD1とThinkの履歴・stateを二重管理しないため、エージェントはAI SDKの明示したtoolsから始める提案。ThinkのExperimental留保、Sandbox/Code Mode等を採用したい場合は別途相談する。

AI Gatewayは接続例と導入手順を用意する任意の運用機能案。通常のprovider直接接続も維持し、Gatewayの未設定が標準起動を妨げない。ログ保存・費用制御等のBeta機能を必要条件にしない。

## 検証と費用

通常CIは実LLM・メール・Polar課金を呼ばない。認証・SQL・所有者分離・HTTPはローカルWorkers/D1で確認し、外部境界だけfake化する。実provider疎通、AI Search索引、Workflowsクラウド復旧、Polar sandboxは独立した検証表にし、モデル・回数・費用上限・公開範囲を具体化して実施する。

月額5ドルは全機能使い放題ではない。アカウント共有枠の残量は未確認。推論・画像生成等の価格は利用モデル決定後に見積もる。通常の開発・検証はローカル中心とし、実接続は対象と予算を確定した範囲だけで行う。詳細は [費用・運用](../references/costs-operations.md)。

## 合意後の順序

変更の目的に応じ、設計、通常実装、影響範囲のローカル検証、必要な実環境の確認へ進む。現在の工程と有効な許可は[current-state.md](current-state.md)を参照し、完了済みの初期構築や複製検証を理由なく繰り返さない。

失敗時は[診断手順](diagnostics.md)で既存の分類と証拠を確認する。新しい外部操作は対象・回数・費用・終了方法をレビュー可能にしてから、未許可の差分だけ確認する。
