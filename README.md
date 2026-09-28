# Cloudflare AI Starter Kit

Cloudflare WorkersとTanStack Startで、公開ページ・ログイン後のAIチャット・業務支援アプリを作る共通スターターです。単一のReact/TypeScriptプロジェクトを複製して使えます。

標準機能は **認証、モデル切替、ストリームチャット、D1への履歴保存**。RAG、承認付きツール、Workflows、fal.ai、Polarはコード・テスト・導入手順を持つ任意拡張です。初期状態は全OFF。クラウドアカウントや実Secretなしで、ローカルの固定応答を使って一連の流れを確認できます。固定応答は実AIではありません。

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

実配備した環境の設定方針は、[stagingのアクセス制限と公開設定](docs/staging-アクセス制限と公開設定.md)を参照してください。本人限定・セッション期間・変更時の注意をまとめています。実ID・AUD・個別管理URLは記録しません。公開用と手元の配備設定の分離、履歴整理の結果は[リポジトリの公開情報と履歴管理](docs/リポジトリ-公開情報と履歴管理.md)にあります。

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

1. ソース・設定・lockfile・docsを新しいディレクトリへ複製します。`node_modules`、`dist`、`.wrangler`、`.tanstack`、Secrets、生成型、既存Git履歴は持ち込みません。
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
