# Cloudflare AI Starter Kit

Cloudflare WorkersとTanStack Startを使い、別プロジェクトへ複製するAIアプリの共通スターター。標準機能は認証、モデル切替、チャット、履歴保存。Jevの判断基盤、RAG・agent・Workflows・Polar・falメディアは、選んで使える任意拡張。

ローカルは実Secretなしの固定応答から開始できる。実AI接続・通常配備の成功は、ローカル検証とは別に確認する。

- **開発を再開する:** [現在地と次の作業](docs/current-state.md)を読む。全履歴の再読は不要。
- **文書を探す:** [docs の索引](docs/README.md)に、仕様・手順・履歴の役割別の一覧がある。
- **仕様を確認する:** [合意済み構成と受け入れ条件](docs/architecture-proposal.md)の該当節。設定の判定は[実行時方針](docs/runtime-policy.md)。
- **問題を調べる:** [診断と次の確認](docs/diagnostics.md)、[開発運用の改善記録](docs/development-workflow.md)。
- **配備を準備する:** [公開前チェック](docs/launch-checklist.md)と[運用手順](docs/operations.md)、複製先で踏んだ[注意点](docs/operations.md#複製先の実配備で確認した注意点)。
- **経緯を調べる:** [archive](docs/archive/README.md)の開発履歴を、対象の工程だけ参照する。

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

## 機能

| 区分 | 内容 | 詳細 |
| --- | --- | --- |
| 公開ページ | `/`はSSR、`/help`だけbuild時に事前生成。通常stagingは`/help`もSSR（事前生成後のbuild停止を回避） | `vite.config.ts`、`build-policy.ts` |
| 認証 | Better Authのメール＋パスワード、Cloudflare Email Service、Google追加可能。社内・個人用途はAccessに切替 | [認証](docs/auth.md) |
| AIチャット | Workers AI / OpenAI / Anthropic / Google / OpenRouter / LM Studio。サーバーの許可モデルだけ選択可 | [モデル接続](docs/providers.md) |
| 履歴・制限 | 所有者分離、同時実行・日次上限、重複防止、要求台帳と再送、中断・失敗状態 | [チャット設計](docs/chat.md) |

任意拡張は用途と独立して選ぶ。対応する`ENABLE_*`（Jevは`JEV_MODE`）と必要なbinding/Secretを構成したものだけ使い、OFFの拡張にはアカウントを要求しない。ONの拡張だけが画面のナビに出る（`/api/session`の`features`）。

| 任意拡張 | 内容 | スイッチ | 詳細 |
| --- | --- | --- | --- |
| 型付き判断（Jev） | 固定版・Choice/Score/Noul。分類POSTと本人metadata GET | `JEV_MODE=remote` | [Jev契約](docs/Jev-B3J-実装前契約.md) |
| RAG | R2原本＋AI Search、出典付き回答と履歴 | `ENABLE_RAG` | [拡張](docs/extensions.md) |
| ツール | 所有者のメモ検索、下書き、画面で人間が承認後に保存 | `ENABLE_AGENT` | [チャット設計](docs/chat.md) |
| 長時間処理 | Workflowsで要約→承認待ち→保存 | `ENABLE_WORKFLOWS` | [拡張](docs/extensions.md) |
| 旧画像 | 既存FLUX 1枚の受付・状態取得・取消。メディアとは別入口 | `ENABLE_IMAGES` | [拡張](docs/extensions.md) |
| メディア | 画像4・動画4・音声4、参照画像、private保存/再生/削除。媒体別の実上流確認gate | `ENABLE_MEDIA` | [設定・制約](docs/M5-メディア統合と隔離複製検証.md) |
| 決済 | Polar sandboxのCheckout・署名付きWebhook・Portal | `ENABLE_BILLING` | [決済](docs/billing.md) |

`AI_MODE`だけでは独立した画像・決済等を止められないため、終了方法も接続ごとに確定します。LM Studioと固定応答・ローカル認証の省略設定はループバック専用で、公開ホストへ持ち出すとAPIが拒否します。`STAGING_POLICY=standard`を明示しないstagingは全経路を閉じます（[実行時方針](docs/runtime-policy.md)）。

Cloudflare Email ServiceはPublic Beta、AI Searchは2026-10-01にGA（従量課金は11月1日開始予定）です。実サービスのモデル提供状況、費用、送信ドメイン、Cloudflareのbindings接続はローカルテストだけでは確認できません。

## 設定と公開情報の扱い

- Accessの推奨設定（本人限定・セッション期間・変更時の注意）は[認証](docs/auth.md#cloudflare-accessを選ぶ場合)にあります。実ID・AUD・個別管理URLは記録しません。
- 公開用の設定と手元の配備設定の分離、GitHubメール設定とPR送信前後の検査手順は[リポジトリの公開情報と履歴管理](docs/リポジトリ-公開情報と履歴管理.md)にあります。
- 実Secretの投入は人間が会話外で行います（[Secrets補足](rules/secrets.md)）。チャット・コマンド引数・ブラウザ変数へ入れません。

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
| `pnpm test` | 実workerd・一時D1/R2・ローカルWorkflowsの試験に続けて`pnpm test:build`。外部APIはfake |
| `pnpm test:build` | 公開例/合成Workerの実plugin build・flatten・キーなしHTTP起動/停止。実アプリの複製検証とは別 |
| `pnpm db:migrate:local` | ローカルD1へ未適用SQLを適用 |
| `pnpm dev:extensions` | 全拡張ONの画面確認用に127.0.0.1:4198で起動。専用D1・外部fetchはfakeのみ（[手順](docs/extensions.md#全拡張onの画面をローカルで確認する)） |
| `pnpm build` | client/Workerと公開`/help`の事前生成 |

CIは`pnpm check`、ローカルmigration、preview上のHTTP smoke、`pnpm audit`を実行し、自動deploy・実メール送信・有料LLM呼び出しは行いません。Nodeだけの成功をWorkersの動作証明にはしません。

## 別プロジェクトとして使う

1. 対象版を固定し、ソース・公開設定/5例・`pnpm-workspace.yaml`・lockfile・全migration・docs・開発ルール（[AGENTS.md](AGENTS.md)）を新しいディレクトリへ複製します。`pnpm-workspace.yaml`の`overrides`（3件。理由は[運用手順](docs/operations.md#pnpmのoverrides)）も維持します。`node_modules`、`dist`、`.wrangler`、`.tanstack`、Secrets、生成型、既存Git履歴・管理外の実設定・復旧領域は持ち込みません。ディレクトリ丸ごとのコピーはしません。複製する版ごとに、許可対象と必要ファイルを確認し直します（過去の複製の件数は流用しません）。
2. `package.json`の`name`、`wrangler.jsonc`の基本名とstaging/production名、ローカルD1名を変更します。
3. 固定Node/pnpmで`pnpm install --frozen-lockfile` → `pnpm format`（名称変更後の整形）→ `pnpm db:migrate:local` → `pnpm check` → `pnpm dev`を実行します。
4. 表示名・meta・画面を目的に合わせて変更します。配色は`src/theme.css`だけで変更できます（[見た目とテーマ設定](docs/theme.md)）。公開先、必要リソース、費用、Secret投入先、復旧方法を確定してからクラウドへ配備します。

Git管理する`wrangler.jsonc`はローカル用・配備用のテンプレートです。D1 IDはダミー、Access AUDは空、originは例示用、公開経路は無効です。`STAGING_POLICY`を省略したstagingは`missing_staging_policy`で全経路を閉じます。通常stagingとproductionには、別の管理外設定を明示選択する`standard-staging-local` / `production-local`のmodeを使います。[5設定例とbuild境界](docs/公開プリセットとbuild境界.md)で対応を確認してください。必要ファイル不在時に公開例へ代替しません。管理外設定と`.publication-recovery/`は複製・共有しません。実設定の作成・実接続・配備は別承認です。

環境分離、migration、buildとdeployの環境一致、復旧は[運用手順](docs/operations.md)、秘密の人間による投入は[Secrets補足](rules/secrets.md)を参照してください。

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

共通開発ルールは[AGENTS.md](AGENTS.md)、公式根拠は[references/README.md](references/README.md)、現在地と次の作業は[docs/current-state.md](docs/current-state.md)、合意した仕様は[docs/architecture-proposal.md](docs/architecture-proposal.md)、過去の経緯は[docs/archive/](docs/archive/README.md)にあります。

## ライセンス

[MIT](LICENSE)
