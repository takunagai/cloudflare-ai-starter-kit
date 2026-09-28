# 環境・更新・配備・復旧の運用方針

更新日: 2026-09-28。第2段階を含む運用手順。専用staging D1・Worker・Access・Custom Domainの配備を実施済み。本人のOTP受信・Accessログイン・認証後UIと実D1レート制限書込みを確認済み。会話保存・実AIは未検証。実行状態は[staging作業ログ](staging-work-log.md)を正本とし、以下の一般手順だけを実行済みの証拠としない。

実AI接続は[最小検証計画](実AI接続-最小検証計画.md)に従い、費用と実操作の承認を経て行う。FP8モデルとstaging専用の総3回・30分・入力制限は[実装・ローカル検証済み](実AI検証制御-実装状況.md)。公開設定のAIはOFFのままで、binding追加だけでは開始しない。実配備設定は本人が管理し、再認証・専用staging D1への0006追加・設定反映・AI有効化/無効化の再配備は別途許可が必要。ローカルbuild/previewの成功を実配備成功と扱わない。

## 環境の分離

| 環境 | 目的 | 方針 |
| --- | --- | --- |
| local | 日常開発・自動テスト | workerdで再現。外部課金・メール配信なし。localhostだけへbind |
| staging | 承認後の実クラウド検証 | 本番とWorker、Secrets、D1、R2等を分離。必要な任意拡張のみ設定 |
| production | 本番利用 | stagingで確認した成果物・migrationの手順を適用。権限と公開範囲を明示 |

`wrangler.jsonc` の `env.staging` / `env.production` は別Worker名を持つ公開用テンプレート。`workers_dev: false`、`preview_urls: false`、`send_metrics: false` を維持し、実D1 ID・AUD・Custom Domainは含めない。既存stagingの非Secret設定はGit管理外の `.wrangler.staging.local.jsonc` に分離した。実配備用buildは `--mode staging-local` で明示選択する。[公開情報と履歴管理](リポジトリ-公開情報と履歴管理.md)を先に確認し、複製先へ手元の実設定を持ち込まない。これらはCloudflareアカウント全体の設定を変えるものではない。

Workersの環境別bindings・vars・Secretsを暗黙継承すると考えない。D1/R2/AI/Workflows等のbindingsは使用する環境ごとに明示する。環境を選ぶだけで本番の設定やデータを流用しない。ローカルDBはダミーIDを持つDB bindingでエミュレートする。staging/productionへは本物の環境別D1を明示追加する。

## ローカルの準備と確認

1. Node.js 26.10.0とpnpm 12.6.0を用意する。
2. `pnpm install --frozen-lockfile` でlockfileどおりに依存を入れる。
3. `pnpm check` でlint・型検査・Workers向けテスト・buildを実行する。
4. `pnpm db:migrate:local`でローカルSQLを適用後、`pnpm dev`、またはbuild後の `pnpm preview` で画面を確認する。
5. READMEに示す対象URL・起動条件で `pnpm smoke` を実行し、SSR本文とHTTP疎通を確認する。

ポート競合時は既存プロセスを無断終了せず、使用中の作業を確認する。dev/previewはローカル検証であり、Cloudflare上の配備成功や実provider接続を証明しない。

## Secretsと設定

ローカルSecretはコミット対象外の専用ファイル、本番SecretはCloudflareのSecretsを使う。項目と投入先はauth.md、providers.md、extensions.md、billing.mdの機能別手順を参照する。全OFFの任意拡張のためにアカウントやSecretを作らない。

秘密の閲覧・投入・検証・漏えい対応はユーザーレベルの共通ルールを正本とする。アプリ固有の事項は [Secrets運用補足](../rules/secrets.md) を参照する。実Secretの投入はユーザーが別ターミナルで行い、エージェントは値を取得・表示しない。最小権限と環境別の資格情報を使う。

Cloudflareの`wrangler secret put`は即時deployを伴う外部変更として扱う。対象環境・設定・影響を確定し、承認された範囲で対話入力を案内する。単なる設定確認として実行しない。

## 第2段階のD1 migration

`migrations/`の連番SQLを履歴管理する。認証はDrizzle schemaとSQLの列・制約一致を実D1テストで確認する。チャットと拡張の枠予約・冪等処理は明示SQLとD1の原子的batchを使う。自動schema pushは使わず、変更ごとに次番号のSQLを追加してレビューする。適用済みSQLを編集しない。空DBへの全適用・再適用と、既存データを保持した追加migrationを検証する。

ローカルは`pnpm db:migrate:local`。認証・会話・資料metadata・ジョブ・課金台帳を同じ環境のD1へ保存する。リモートは環境別DB bindingを設定後、承認された対象に限り`pnpm exec wrangler d1 migrations apply DB --env staging --remote`を実行する。productionは対象を明示して別途適用する。

リモート適用前に対象環境とDBを照合し、バックアップ/復旧可能点、既存コードとの互換性、適用順を確認する。staging検証後にproductionへ進む。削除・rename・型変更など既存データへの影響がある変更は、追加→移行→削除の段階的変更を優先する。SQL生成や型検査が成功しても、DBへ適用済みとは扱わない。

アプリのrollbackはDB schemaを自動で戻さない。古いWorkerとの互換性を残すmigrationを基本とし、復旧が必要な変更はデータ保全を含む手順を別途用意する。D1作成・remote migration・復元を実行する前に具体的な対象と操作範囲を確認する。

## 依存更新と監査

Node/pnpm、フレームワーク、Cloudflareツール、品質ツールを無差別に一括更新しない。関連する依存を小さくまとめ、公式変更履歴・engines・peerを確認してexact versionとlockfileを更新する。

更新時は `pnpm audit`、`pnpm check`、ローカルHTTPのsmokeを行う。auditの成功は安全性全体の保証ではなく、報告された問題も到達経路・実行環境・修正版の有無を確認する。必要な修正を無視するための例外を残さず、例外が必要なら理由と期限を記録する。互換性が崩れたら直前のpackage/lockfileの組み合わせへ戻して再インストールする。

Cloudflareの `compatibility_date` は日付だけ先に更新せず、対応workerdと動作変更を確認して変更する。生成されたbindings型・route型・build成果物は更新後に再生成する。

## 配備の手順

CIはchecks専用とし、有料APIの実行や自動deployを含めない。ローカルでのチェック成功とGitHub Actions上の成功を区別する。

初回配備前に、公開先、環境、必要リソース、費用、Secrets投入方法、戻し方を具体化し、その範囲の承認を得る。第2段階の作業再開を公開の承認とは扱わない。

Cloudflare Vite pluginを使うため、**buildとdeployの環境を一致させる**。stagingは `CLOUDFLARE_ENV=staging pnpm build` で生成し、そのbuildが出力したWorkers設定・成果物を確認して配備する方針とする。productionも同様に環境を選び直してbuildする。build済みの別環境成果物へdeploy時の環境指定だけを足して流用しない。

生成設定は `dist/server/wrangler.json`、Worker本体は `dist/server/index.js`、assetsは `dist/client`。第1段階ではstaging/productionのbuildとdry-runを確認済み。第2段階のbinding設定後は同じ手順で改めて確認する。

```sh
CLOUDFLARE_ENV=staging pnpm build --mode staging-local
WRANGLER_SEND_METRICS=false pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
```

環境選択はbuildコマンドだけに設定する。生成設定には環境が展開済みのため、続くWranglerコマンドに `--env` を重ねない。実配備は公開先・リソース・費用等を承認後、同じ生成設定を使って `--dry-run` を外して行う。初回は公開経路なしでWorkerを配備し、専用Worker全体のAccess保護とAUD反映を確認してからCustom Domainを追加する。実施結果とversionは[staging作業ログ](staging-work-log.md)を参照する。

環境別buildの事前生成時に、生成済み設定に環境節がない旨の警告が出る。buildは成功し、生成Worker名が正しいこととdry-runを確認したが、クラウドの環境別binding接続は第2段階以降に検証する。設定確認時もSecretを含むファイルや環境を表示しない。

配備時には対象環境、ソースのrevisionまたは内容識別子、lockfile、compatibility date、Worker version、migration状態を対応付けて記録する。公開ページ・API・認証境界・webhook到達性を確認し、実LLM疎通は承認した回数と費用内に限定する。

## 復旧

不具合時は影響を確認し、必要に応じて有料処理・拡張の実行を止める。リクエスト本文や認証情報を追加ログへ丸ごと記録しない。

直前の正常なWorker versionと、現在のD1 schema・binding構成の互換性を確認してからrollbackする。公開環境のrollbackも外部変更として具体的な対象と範囲を確認する。旧versionへ戻すと古いbindingや処理方式が復活する場合があるため、Workerだけの復旧で十分かを判断する。

DB復元が必要なら、復元後に失われる更新、契約/外部ジョブとの整合、重複処理を確認する。Workflowsや課金処理など外部副作用はWorkerのrollbackでは取り消されない。復旧後はHTTP・認証・所有権・必要な拡張を検証し、原因と再発防止を作業記録に残す。

## 進行記録

第1段階の停止とユーザーによる`/init 日本語で`を経て、2026-09-27に第2段階の再開が明示承認された。外部変更・実送信・課金は別の具体的な承認範囲として扱う。

## 2026-09-27の依存監査対応

Better Authの任意peerとして解決されたDrizzle CLIの下位依存に、`esbuild <=0.24.2`の開発server CORS脆弱性[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)が検出された。アプリは`better-auth/minimal`とD1 adapterを使い、このCLIのserve機能は使わないが、監査を無視せず対象経路`@esbuild-kit/core-utils>esbuild`だけを既存toolchainと同じ0.28.1へ固定した。通常のCloudflare/Vite依存の版は変更していない。`pnpm audit`で既知の脆弱性0件を確認した。

直接依存のdrizzle-kitは不要なため除外。固定pnpm 12.6.0では任意peerの参照がlockfileに残るため、上記の限定overrideを使う。Drizzle CLIの導入やBetter Auth更新時はこのoverrideの要否を再評価し、DB schema生成を追加する場合はそのCLI自体も検証する。旧esbuild-kitにdeprecated警告は残る。

`minimumReleaseAgeExclude`は導入時に公式配布元を確認したAI SDKの**特定版だけ**を列挙している。広いパターンや全体無効化は使わない。次回更新時には公開後の待機期間を満たした版を選び、不要な例外を削除する。設定構文の根拠: [pnpmの依存解決](https://pnpm.io/settings/dependency-resolution)。
