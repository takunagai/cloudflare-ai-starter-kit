# Cloudflare AI Starter Kit

Cloudflare WorkersとTanStack Startで、公開ページ・ログイン後のAIチャット・業務支援アプリを作る共通スターターです。単一のReact/TypeScriptプロジェクトを複製して使えます。

標準機能は **認証、モデル切替、ストリームチャット、D1への履歴保存**。RAG、承認付きツール、Workflows、fal.ai、Polarはコード・テスト・導入手順を持つ任意拡張です。初期状態は全OFF。クラウドアカウントや実Secretなしで、ローカルの固定応答を使って一連の流れを確認できます。固定応答は実AIではありません。

**2026-10-02の追加合意:** [TypeSafe AI Jevを標準の判断基盤として搭載](docs/用途別プリセット-開発計画.md#標準基盤-typesafe-ai-jev2026-10-02)する方針を採用しました。全3用途に型付き判断service・テスト・利用例・手順を含め、工程B〜Dで実装・検証する計画です。実接続は既定OFFで、APIキーなしで起動できる設計を維持します。現在は設計済み・未実装です。[公式仕様と採用範囲](references/typesafe-jev-20261002.md)も参照してください。

同日の追加要件として、[falの画像・動画・音声と参照画像アップロード](docs/fal-画像動画音声-初版設計.md)を初版の設計対象に含めました。対象は画像4・動画4・音声4の12 endpoint。現在の実装は従来の画像1モデルのみで、追加機能は未実装・実接続OFFです。

次期整備方針として、2026-09-29に **1つの共通スターター＋導入時に選べる3つの推奨設定（ローカル試作・個人/社内利用・公開サービス）** を採用しました。2026-10-01に[工程Aの差分設計とB〜Dの実装・検証計画](docs/用途別プリセット-開発計画.md)を具体化しました。設定対応表、導入導線、通常staging案、採用済み/推奨/未決事項を同文書で管理します。新しい設定と用途別導線は未実装で、実接続や配備の許可を含みません。

**2026-10-01の現在地:** 工程Aの設計を確定しました。初版は文書の3入口、通常stagingは別Worker/DB、AIは明示選択を採用し、対話式セットアップは初版対象外です。設定キー・既定動作・buildモードも設計済みで、次の着手単位はその実装とテスト（B-1）です。手元mainとローカルorigin/mainは`66fd90f`で一致し、既存の未commit文書4件を保持して更新しています。このHEADのCI成功は前セッションの引き継ぎ情報で、今回の文書変更に対するCI成功ではありません。以下の取り込み結果は2026-09-29時点の証拠です。

**2026-09-29現在: main確定後、費用再照合と最初の用途選択の段階です。** PR #2/#3の通常merge、PR #3のbase変更、main同期・検査は完了しました。取り込み完了時のmainは`061b0ba20d2f00091b32627fe2e49eae2023b898`で、[そのmain CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36506852047)はcompleted・success。手元main・origin/main・GitHub先端の一致とclean、全32コミットの履歴・tree・生成作者検査も確認済みです。このSHAとCIはPR取り込み完了時の証拠で、以後の文書更新headのCIは別に確認します。

[全工程・現在地・次の作業](docs/plan.md)、[使用量・請求確認](docs/実AI検証-使用量と請求確認.md)、[最終レビュー・取り込み完了結果・用途別の次ステップ](docs/main取り込み-最終レビューと次の用途.md)から、PR本文を開かずに確認できます。実AI検証ソースは`7abc1696`、後続のundici限定修正版`f2f7847c`はローカル/CI検証済み・未配備です。追加配備・実AI再開は行っていません。

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
| 公開ページ | `/`はSSR、`/help`だけbuild時に事前生成 | `vite.config.ts` |
| 認証 | Better Authのメール＋パスワード、Cloudflare Email Service、Google追加可能。社内・個人用途はAccessに切替 | [認証](docs/auth.md) |
| AIチャット | Workers AI / OpenAI / Anthropic / Google / OpenRouter / LM Studio。サーバーの許可モデルだけ選択可 | [モデル接続](docs/providers.md) |
| 履歴・制限 | 所有者分離、同時実行・日次上限、重複防止、中断・失敗状態 | [チャット設計](docs/chat.md) |
| RAG（任意） | R2原本＋AI Search、出典付き回答と履歴 | [拡張](docs/extensions.md) |
| ツール（任意） | 所有者のメモ検索、下書き、画面で人間が承認後に保存 | [チャット設計](docs/chat.md) |
| 長時間処理（任意） | Workflowsで要約→承認待ち→保存 | [拡張](docs/extensions.md) |
| 画像（任意） | fal.aiで画像1枚を受付・状態取得・取消要求 | [拡張](docs/extensions.md) |
| 決済（任意） | Polar sandboxのCheckout・署名付きWebhook・Portal | [決済](docs/billing.md) |

任意拡張は`wrangler.jsonc`の対応`ENABLE_*`を`"true"`にし、必要なbindingやSecretを構成したものだけ使います。OFFの拡張にはアカウントを要求しません。LM Studioと固定応答・簡易ローカル認証はループバック専用です。公開ホストへローカル設定を持ち出すとAPIが拒否します。

現在のstagingは固定窓・指定FP8・総3回の検証専用で、他providerと任意拡張を常に遮断します。検証フラグをfalseにしても通常運用へ解除されません。複製先向けの[通常staging設計](docs/用途別プリセット-開発計画.md#工程a-通常stagingの制御案)は、別Worker/DBと明示ポリシーを使い、旧台帳を保持する採用済み・未実装の設計です。既存環境の解除手順として使わないでください。

AI SearchはOpen Beta、Email ServiceはPublic Betaの採用を合意済みです。実サービスのモデル提供状況、費用、送信ドメイン、Cloudflareのbindings接続はローカルテストだけでは確認できません。実接続の範囲は[検証記録](docs/phase2-verification.md)を参照してください。

## 検証

```sh
pnpm check       # lint → 型生成/型検査 → workerdテスト → build
pnpm audit       # 公開レジストリへ既知の脆弱性を照会
pnpm preview     # build済みアプリを127.0.0.1:4173で起動
```

別ターミナルで`pnpm smoke`。開発サーバー向けは`pnpm smoke 3000`です。HTTP検証はローカル限定で、全拡張OFFの設定を確認してから架空アカウントを作り、固定応答・履歴・ログアウトを検証します。テスト会話は削除しますが、ローカルDBに架空アカウントと利用台帳が残ります。実モデルは呼びません。画面操作はブラウザで登録→送信→再読み込み→会話削除を確認します。

| コマンド | 用途 |
| --- | --- |
| `pnpm format` / `pnpm lint` | Biome整形・import・lint |
| `pnpm typecheck` | WranglerとTanStackの型生成後にTypeScript検査 |
| `pnpm test` | 実workerd・一時D1/R2・ローカルWorkflows。外部APIはfake |
| `pnpm db:migrate:local` | ローカルD1へ未適用SQLを適用 |
| `pnpm build` | client/Workerと公開`/help`の事前生成 |

CIも同じ検証を行い、自動deploy・実メール送信・有料LLM呼び出しは行いません。Nodeだけの成功をWorkersの動作証明にはしません。

## 別プロジェクトとして使う

1. ソース・公開設定・`pnpm-workspace.yaml`・lockfile・migration 0001〜0006・docsを新しいディレクトリへ複製します。2つのundici限定overrideも維持します。`node_modules`、`dist`、`.wrangler`、`.tanstack`、Secrets、生成型、既存Git履歴は持ち込みません。
2. `package.json`の`name`、`wrangler.jsonc`の基本名とstaging/production名、ローカルD1名を変更します。
3. 固定Node/pnpmで`pnpm install --frozen-lockfile` → `pnpm format`（名称変更後の整形）→ `pnpm db:migrate:local` → `pnpm check` → `pnpm dev`を実行します。
4. 表示名・meta・画面を目的に合わせて変更します。公開先、必要リソース、費用、Secret投入先、復旧方法を確定してからクラウドへ配備します。

Git管理する`wrangler.jsonc`はローカル用・配備用のテンプレートです。D1 IDはダミー、Access AUDは空、originは例示用、公開経路は無効です。実配備には管理対象から除外した`.wrangler.staging.local.jsonc`を用意し、`CLOUDFLARE_ENV=staging pnpm build --mode staging-local`で明示的に選びます。このファイルや`.publication-recovery/`は複製・共有しません。詳細は[公開情報と履歴管理](docs/リポジトリ-公開情報と履歴管理.md)を参照してください。

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
