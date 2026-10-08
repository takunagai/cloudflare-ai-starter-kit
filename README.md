# Cloudflare AI Starter Kit

Cloudflare WorkersとTanStack Startを使い、別プロジェクトへ複製するAIアプリの共通スターター。認証、モデル切替、チャット、履歴保存とJevの判断基盤を持ち、RAG・agent・Workflows・Polar・falメディアを選んで使える。

ローカルは実Secretなしの固定応答から開始できる。実AI接続・通常配備の成功は、ローカル検証とは別に確認する。

- **開発を再開する:** [現在地と次の作業](docs/current-state.md)を読む。全履歴の再読は不要。
- **仕様を確認する:** [合意済み構成と受け入れ条件](docs/architecture-proposal.md)の該当節を読む。
- **問題を調べる:** [診断と次の確認](docs/diagnostics.md)、[開発運用の改善記録](docs/development-workflow.md)を参照する。
- **配備を準備する:** [公開前チェック](docs/launch-checklist.md)と[複製先の実配備で確認した注意点](docs/operations.md#複製先の実配備で確認した注意点)を読む。
- **経緯を調べる:** [開発履歴](docs/plan.md)を対象の工程だけ参照する。

## 用途を選んで始める

| 入口 | 認証・用途 | 到達点 |
| --- | --- | --- |
| [ローカルで試す](docs/presets/local.md) | loopbackのBetter Authと固定応答 | 実Secretなしの起動・履歴確認 |
| [個人・社内向けに準備する](docs/presets/internal.md) | 配備先でAccess | 通常staging/productionの設定例と不足項目を確認 |
| [公開サービス向けに準備する](docs/presets/public.md) | 配備先でBetter Auth | 実メール・公開/保護経路の準備項目を確認 |

用途と環境、AI、Jev、任意拡張は別々に選ぶ。公開5例はJev/任意拡張OFFで、単独deployできる完成設定ではない。[設定とbuild境界](docs/公開プリセットとbuild境界.md)に従って実設定と操作範囲を確定する。現在の実装・検証・実接続の範囲は[現在地](docs/current-state.md)にまとめる。

## 最短の起動

前提: **Node.js 26.10.0 / pnpm 12.6.0**。Nodeは26系Currentで、LTSではありません。`.node-version`と`package.json`を正本に、利用中のバージョン管理ツールで合わせてください。グローバル環境は自動変更しません。

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

[ローカルアプリ](http://127.0.0.1:3000/app)でアカウントを新規登録し、「動作確認用の固定応答（AI未使用）」を選んで送信します。再読み込み後、一覧から会話を選ぶとD1の履歴が復元されます。ローカル専用の架空メールアドレスとテスト用パスワードを使ってください。ローカルでは確認メールを送らず登録できます。本番ではメール確認が必要です。

`.env` / `.dev.vars`の作成、Cloudflareログイン、リモートD1作成、メール設定はこの確認に不要です。ローカルDBは`.wrangler/`に保存されます。`pnpm test`は別の一時DBを使います。停止は起動ターミナルでCtrl+C。

pnpm未導入なら、Nodeを合わせてからユーザー自身の環境設定として`npm install --global pnpm@12.6.0`で導入できます。Corepackの同梱は前提にしません。

## 機能と設定

実配備した環境の設定方針は、[stagingのアクセス制限と公開設定](docs/staging-アクセス制限と公開設定.md)を参照してください。本人限定・セッション期間・変更時の注意をまとめています。実ID・AUD・個別管理URLは記録しません。公開用と手元の配備設定の分離、履歴整理の結果、GitHubメール設定とPR送信前後の検査手順は[リポジトリの公開情報と履歴管理](docs/リポジトリ-公開情報と履歴管理.md)にあります。

[実AI接続の最小検証計画](docs/実AI接続-最小検証計画.md)は、本人限定staging・Workers AIのFP8モデル・固定30分・最大3回です。2026-09-29に修正版で2回の実AI応答・逐次表示・履歴保存/復元・試験会話削除を確認しました。終了後はAI bindingを除去して無効化配備し、期限前のAI OFFとログアウト後のAccess遮断を確認済みです。消費台帳は保持し、再有効化や残枠の使用を自動では行いません。

[実装状況と設定](docs/実AI検証制御-実装状況.md)に、入口修正後の201テストを含むcheck・HTTP smokeと、限定した実接続結果・無効化の確認根拠・制約を分けて記録しています。他モデル・任意拡張・アプリの実メール/決済は未検証です。

[保護フックの原因調査・限定修正](docs/保護フック誤検出-調査と修正案.md)は、個別承認後に適用・検証しました。秘密ファイル判定やGit保護は維持しています。

旧プロジェクトの整理結果と残る確認事項は、[retired-project-workerの廃止記録](docs/旧プロジェクト-廃止記録.md)に記録しています。

| 区分 | 内容 | 詳細 |
| --- | --- | --- |
| 公開ページ | `/`はSSR、`/help`だけbuild時に事前生成。通常stagingは`/help`もSSR（事前生成後のbuild停止を回避） | `vite.config.ts`、`build-policy.ts` |
| 認証 | Better Authのメール＋パスワード、Cloudflare Email Service、Google追加可能。社内・個人用途はAccessに切替 | [認証](docs/auth.md) |
| AIチャット | Workers AI / OpenAI / Anthropic / Google / OpenRouter / LM Studio。サーバーの許可モデルだけ選択可 | [モデル接続](docs/providers.md) |
| 型付き判断 | Jev固定版・Choice/Score/Noul。既定OFF、分類POSTと本人metadata GET | [Jev契約・設定メモ](docs/Jev-B3J-実装前契約.md) |
| 履歴・制限 | 所有者分離、同時実行・日次上限、重複防止、中断・失敗状態 | [チャット設計](docs/chat.md) |
| RAG（任意） | R2原本＋AI Search、出典付き回答と履歴 | [拡張](docs/extensions.md) |
| ツール（任意） | 所有者のメモ検索、下書き、画面で人間が承認後に保存 | [チャット設計](docs/chat.md) |
| 長時間処理（任意） | Workflowsで要約→承認待ち→保存 | [拡張](docs/extensions.md) |
| 旧画像（任意） | 既存FLUX 1枚の受付・状態取得・取消。新12件とは別入口 | [拡張](docs/extensions.md) |
| メディア（任意） | 画像4・動画4・音声4、参照画像、private保存/再生/削除。既定OFF・媒体別の実上流確認gate | [統合・設定・制約](docs/M5-メディア統合と隔離複製検証.md) |
| 決済（任意） | Polar sandboxのCheckout・署名付きWebhook・Portal | [決済](docs/billing.md) |

任意拡張は用途と独立して選び、別許可後に対象環境の対応`ENABLE_*`と必要なbinding/Secretを構成したものだけ使います。OFFの拡張にはアカウントを要求しません。AI_MODEだけでは独立した画像・決済等を止められないため、終了方法も接続別に確定します。LM Studioと固定応答・ローカル認証の省略設定はループバック専用です。公開ホストへローカル設定を持ち出すとAPIが拒否します。

既存stagingは固定窓・指定FP8・総3回の検証専用で、他providerと任意拡張を常に遮断します。検証フラグをfalseにしても通常運用へ解除されません。複製先向けの[通常staging設計](docs/用途別プリセット-開発計画.md#工程a-通常stagingの制御案)は、別Worker/DBと明示ポリシーを使い、旧台帳を保持します。B-3の実行境界、B-3JのJev service/API、B-4の設定/build境界はローカル検証済みです。旧台帳を削除・更新して通常へ転換せず、新環境の実設定・配備は別承認で扱います。

AI SearchはOpen Beta、Email ServiceはPublic Betaの採用を合意済みです。実サービスのモデル提供状況、費用、送信ドメイン、Cloudflareのbindings接続はローカルテストだけでは確認できません。実接続の範囲は[検証記録](docs/phase2-verification.md)を参照してください。

## 検証

```sh
pnpm check       # lint → 型生成/型検査 → workerd＋合成build/HTTP試験 → build
pnpm audit       # 公開レジストリへ既知の脆弱性を照会
pnpm preview     # build済みアプリを127.0.0.1:4173で起動
```

別ターミナルで`pnpm smoke`。開発サーバー向けは`pnpm smoke 3000`です。HTTP検証はローカル限定で、全拡張OFFの設定を確認してから架空アカウントを作り、固定応答・履歴・ログアウトを検証します。テスト会話は削除しますが、ローカルDBに架空アカウントと利用台帳が残ります。実モデルは呼びません。画面操作はブラウザで登録→送信→再読み込み→会話削除を確認します。

| コマンド | 用途 |
| --- | --- |
| `pnpm format` / `pnpm lint` | Biome整形・import・lint |
| `pnpm typecheck` | WranglerとTanStackの型生成後にTypeScript検査 |
| `pnpm test` | 実workerd・一時D1/R2・ローカルWorkflowsと合成build/HTTP試験。外部APIはfake |
| `pnpm test:build` | 公開例/合成Workerの実plugin build・flatten・キーなしHTTP起動/停止。実アプリの複製検証とは別 |
| `pnpm db:migrate:local` | ローカルD1へ未適用SQLを適用 |
| `pnpm build` | client/Workerと公開`/help`の事前生成 |

CIも同じ検証を行い、自動deploy・実メール送信・有料LLM呼び出しは行いません。Nodeだけの成功をWorkersの動作証明にはしません。

## 別プロジェクトとして使う

以下は工程Dの導入手順です。D-2開始時の未commit版を別名・空DBへ複製し、複製先自身の固定install/check・dev/preview HTTP/画面まで確認しました。[明示候補の準備メモ](docs/D2-複製許可リストと依存整理.md)と[完了結果](docs/D2-実行記録と再開.md#ポート解放後の完了結果)で対象版と結果文書更新を区別してください。新しい保存先への再複製・実設定作成・実接続/配備の許可ではありません。[用途を選ぶ文書](#用途を選んで始める)から準備項目を確認できます。

1. 対象版を固定し、許可リストのソース・公開設定/5例・`pnpm-workspace.yaml`・lockfile・対象版の全migration・docs・開発ルールを新しいディレクトリへ複製します。2つのundici限定overrideも維持します。`node_modules`、`dist`、`.wrangler`、`.tanstack`、Secrets、生成型、既存Git履歴・管理外実設定・復旧領域は持ち込みません。ディレクトリ丸ごとのコピーはしません。過去D-2の157/158件リストはM-1追加物を含まないため、次に実複製する版で許可対象を再確認します。過去の件数だけで現在版の必要ファイルを確定しません。
2. `package.json`の`name`、`wrangler.jsonc`の基本名とstaging/production名、ローカルD1名を変更します。
3. 固定Node/pnpmで`pnpm install --frozen-lockfile` → `pnpm format`（名称変更後の整形）→ `pnpm db:migrate:local` → `pnpm check` → `pnpm dev`を実行します。
4. 表示名・meta・画面を目的に合わせて変更します。公開先、必要リソース、費用、Secret投入先、復旧方法を確定してからクラウドへ配備します。

Git管理する`wrangler.jsonc`はローカル用・配備用のテンプレートです。D1 IDはダミー、Access AUDは空、originは例示用、公開経路は無効です。既存の`staging-local`は旧検証専用の解決先を保持します。通常stagingとproductionには別の管理外設定を明示選択するB-4のmodeを用意しました。[5設定例とbuild境界](docs/公開プリセットとbuild境界.md)で対応を確認してください。必要ファイル不在時に公開例へ代替しません。管理外設定と`.publication-recovery/`は複製・共有しません。実設定の作成・実接続・配備は別承認です。詳細は[公開情報と履歴管理](docs/リポジトリ-公開情報と履歴管理.md)も参照してください。

環境分離、migration、buildとdeployの環境一致、復旧は[運用手順](docs/operations.md)、秘密の人間による投入は[Secrets補足](rules/secrets.md)を参照してください。実Secretをチャット・コマンド引数・ブラウザ変数へ入れません。

## 困ったとき

- **engineエラー**: Node 26.10.0とpnpm 12.6.0に合わせてからinstallします。
- **`no such table` / 登録失敗**: dev/preview停止後に`pnpm db:migrate:local`を実行します。
- **ポート使用中**: 既存プロセスの用途を確認します。認証のローカル許可originは3000/4173です。別ポートを使う場合は認証設定も合わせてください。
- **sandboxで`listen EPERM`**: workerdと事前生成にはローカルポートが必要です。許可された実行環境で検証します。
- **Wranglerログ先が書込不可**: `WRANGLER_LOG_PATH=.wrangler/logs pnpm check`でプロジェクト内へ向けます。
- **型がない**: `pnpm typecheck`。生成ファイルは手編集しません。
- **プレビューが古い**: build後にpreviewを再起動します。
- **モデルが選べない**: [モデル接続](docs/providers.md)に従い設定します。設定済み表示は資格情報や残高の有効性を保証しません。
- **429**: 利用回数または同時処理上限です。失敗・中断した生成も日次枠を消費します。

共通開発ルールは[AGENTS.md](AGENTS.md)、公式根拠は[references/README.md](references/README.md)、進捗と合意は[docs/plan.md](docs/plan.md)にあります。
