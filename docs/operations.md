# 環境・更新・配備・復旧の運用方針

現在の進捗・有効な許可・次の担当は[current-state.md](current-state.md)を参照する。失敗時の固定分類と確認順は[診断手順](diagnostics.md)を使う。この文書は手順と方針で、新しい実行許可ではない。

2026-10-19に工程Eの専用経路（`/api/media-probe`、`/media-probe`画面、`ENABLE_MEDIA_PROBE`、専用の準備script・試験）をコードから撤去した。migration 0011・0012・0014は履歴として残し、そのtableとtrigger（`media_jobs`に付いていた1本を含む）は[0016](../migrations/0016_drop_media_probe.sql)で外した。撤去前の実装はコミット`a719d99`にある。経緯は[工程Eの記録](archive/工程E-制御実装と隔離検証.md)。

## 環境の分離

| 環境 | 目的 | 方針 |
| --- | --- | --- |
| local | 日常開発・自動テスト | workerdで再現。外部課金・メール配信なし。localhostだけへbind |
| staging | 承認後の実クラウド検証 | 本番とWorker、Secrets、D1、R2等を分離。必要な任意拡張のみ設定 |
| production | 本番利用 | stagingで確認した成果物・migrationの手順を適用。権限と公開範囲を明示 |

`wrangler.jsonc`の`env.staging` / `env.production`は公開用テンプレート。`workers_dev: false`、`preview_urls: false`、`send_metrics: false`を維持し、実D1 ID・AUD・Custom Domainは含めない。公開テンプレートのstagingは`STAGING_POLICY`を書かない閉鎖状態で、`missing_staging_policy`により全経路を閉じる（[実行時方針](runtime-policy.md)）。用途2/3の通常stagingとproductionは[公開5例と固定mode対応](公開プリセットとbuild境界.md#buildの選択と拒否)を別に選ぶ。実設定の保存・非共有・複製除外は[公開情報と履歴管理](リポジトリ-公開情報と履歴管理.md#用途別設定の保存と共有)に従う。Cloudflareアカウント全体の設定変更や、管理外ファイルの作成・閲覧をこの文書で許可しない。

Workersの環境別bindings・vars・Secretsを暗黙継承すると考えない。D1/R2/AI/Workflows等のbindingsは使用する環境ごとに明示する。環境を選ぶだけで本番の設定やデータを流用しない。ローカルDBはダミーIDを持つDB bindingでエミュレートする。staging/productionへは本物の環境別D1を明示追加する。

## ローカルの準備と確認

1. Node.js 26.10.0とpnpm 12.6.0を用意する。
2. `pnpm install --frozen-lockfile` でlockfileどおりに依存を入れる。
3. `pnpm check` でlint・型検査・Workers向けテスト・buildを実行する。
4. `pnpm db:migrate:local`でローカルSQLを適用後、`pnpm dev`、またはbuild後の `pnpm preview` で画面を確認する。
5. READMEに示す対象URL・起動条件で `pnpm smoke` を実行し、SSR本文とHTTP疎通を確認する。

ポート競合時は既存プロセスを無断終了せず、使用中の作業を確認する。dev/previewはローカル検証であり、Cloudflare上の配備成功や実provider接続を証明しない。

## 実接続前の停止条件

用途別入口は、公開例とローカル/fakeの証拠を説明する文書。次の条件が確定するまで、実設定の作成・実接続・配備・公開切替を先行しない。設定方針は[実行時方針](runtime-policy.md)、Jev固有の採用契約は[Jev契約](Jev-B3J-実装前契約.md)を正本とする。

| 確認する条件 | 残す判断・影響・管理場所 |
| --- | --- |
| 対象・認証・分離 | 最初の用途、環境、別Worker/別DB、origin、利用者、Access範囲/sessionまたはBetter Authの実メール/公開経路。本人が対象Worker、Zero Trust → Access → Applications、Email Serviceで照合。ほかの用途のローカル設定・DB/sessionを流用しない |
| 実契約・送信データ | 実適用Order/DPA、送信可能なデータ、本文/派生情報/backup・ログの保持/削除、削除要請の扱い。非学習・アプリ非保存を上流ZDRの保証へ拡張しない |
| 不明要求の運用 | unknownの上流照合・修復・削除要請、停止環境での削除遅延、復元後の照合。Jevの自動再送/削除/枠解放、台帳DROP、復元直後の再有効化を追加しない |
| 実権限・品質 | 選択モデル/固定版の提供継続・権限、日本語品質。fakeの型適合やavailable表示だけでは実権限・精度を保証しない |
| 費用・期間・終了 | 実料金、失敗課金、credit自動補充、人数、総予算、回数、期間、共有利用と終了操作。回数枠は硬い請求額上限ではなく、abortは上流停止/未課金の証拠ではない |
| 実操作の承認 | Access/OTP、メール/DNS、各provider/Jev/拡張、リソース作成、remote migration、build/配備/公開について具体的な対象・影響・費用・終了方法を別に承認。過去の固定窓・残枠・予算・OTP/配備許可は流用しない |

`AI_MODE`、`JEV_MODE`、各`ENABLE_*`、実メールは独立している。必要な接続だけ選び、停止操作も個別に確定する。AI OFFだけで画像/決済/メールを全停止したと扱わず、既に送信した上流処理をWorkerの停止/rollbackで取り消せると説明しない。

Jevは本文/結果/hashなし、終端90日・結果再表示なし、unknownの消費/同時枠保持を維持する。GETは本人metadataの要求台帳読取だけで、既存rate limit counter以外の状態を更新しない。メディアの保持・容量・復旧の採用条件は[M-0差分設計](fal-メディア-M0差分設計.md#b-2時点の採用確認と検証待ち)にある。falの上流保持/ACL/Store-IO/実価格/権限/品質は未検証。

## Secretsと設定

ローカルSecretはコミット対象外の専用ファイル、本番SecretはCloudflareのSecretsを使う。項目と投入先は[認証](auth.md)、[モデル接続](providers.md)、[任意拡張](extensions.md)、[決済](billing.md)の機能別手順を参照する。全OFFの任意拡張のためにアカウントやSecretを作らない。

秘密の閲覧・投入・検証・漏えい対応はユーザーレベルの共通ルールを正本とする。アプリ固有の事項は [Secrets運用補足](../rules/secrets.md) を参照する。実Secretの投入はユーザーが別ターミナルで行い、エージェントは値を取得・表示しない。最小権限と環境別の資格情報を使う。

Cloudflareの`wrangler secret put`は即時deployを伴う外部変更として扱う。対象環境・設定・影響を確定し、承認された範囲で対話入力を案内する。単なる設定確認として実行しない。

## D1 migration

`migrations/`の連番SQLを履歴管理する。認証はDrizzle schemaとSQLの列・制約一致を実D1テストで確認する。チャットと拡張の枠予約・冪等処理は明示SQLとD1の原子的batchを使う。自動schema pushは使わず、変更ごとに次番号のSQLを追加してレビューする。適用済みSQLを編集しない。空DBへの全適用・再適用と、既存データを保持した追加migrationを検証する。

ローカルは`pnpm db:migrate:local`。認証・会話・資料metadata・ジョブ・課金台帳・Jev要求metadata・メディアのジョブ/素材を同じ環境のD1へ保存する。現行は0001〜0012と0014〜0016の15本（0013は管理外の欠番）。0006は旧検証の台帳で、通常stagingの再利用拒否のために残している（[実行時方針](runtime-policy.md#通常stagingの台帳確認)）。0007は本文を持たない要求台帳で、DROPしない。リモートは別承認の後に、対象の管理外設定・環境・DB bindingを明示して適用する。公開wranglerのダミーIDを実環境へ流用しない。productionも対象を明示して別に適用する。

複製先はスターターの履歴を引き継がず、複製時点の番号から自分の連番を続ける。スターターへ汎用の列・表を逆輸入するときは、複製先の番号を流用せずスターター側の次番号で新設し、両者の履歴が分岐することを許容する（2026-10-08合意）。複製先を再同期する操作は行わない。

リモート適用前に対象環境とDBを照合し、バックアップ/復旧可能点、既存コードとの互換性、適用順を確認する。staging検証後にproductionへ進む。削除・rename・型変更など既存データへの影響がある変更は、追加→移行→削除の段階的変更を優先する。SQL生成や型検査が成功しても、DBへ適用済みとは扱わない。

アプリのrollbackはDB schemaを自動で戻さない。古いWorkerとの互換性を残すmigrationを基本とし、復旧が必要な変更はデータ保全を含む手順を別途用意する。D1作成・remote migration・復元を実行する前に具体的な対象と操作範囲を確認する。

## 依存更新と監査

Node/pnpm、フレームワーク、Cloudflareツール、品質ツールを無差別に一括更新しない。関連する依存を小さくまとめ、公式変更履歴・engines・peerを確認してexact versionとlockfileを更新する。更新の根拠は`references/`に日付付きで残す（例: [依存更新の記録](../references/dependency-update-20261018.md)）。

更新時は `pnpm audit`、`pnpm check`、ローカルHTTPのsmokeを行う。auditの成功は安全性全体の保証ではなく、報告された問題も到達経路・実行環境・修正版の有無を確認する。必要な修正を無視するための例外を残さず、例外が必要なら理由と期限を記録する。互換性が崩れたら直前のpackage/lockfileの組み合わせへ戻して再インストールする。

Cloudflareの `compatibility_date` は日付だけ先に更新せず、対応workerdと動作変更を確認して変更する。生成されたbindings型・route型・build成果物は更新後に再生成する。

### pnpmのoverrides

`pnpm-workspace.yaml`の`overrides`は、監査で検出された脆弱性に対応する限定固定で、現在は3件。Better Authの更新、Drizzle CLIの導入、miniflareやTailwindの更新のときは、各overrideの要否を再評価する。

| 対象 | 固定先 | 理由 |
| --- | --- | --- |
| `@esbuild-kit/core-utils>esbuild` | 0.28.1 | Better Authの任意peerとして解決されるDrizzle CLIの下位依存に、`esbuild <=0.24.2`の開発server CORS脆弱性（[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)）。アプリは`better-auth/minimal`とD1 adapterを使い、このCLIのserve機能は使わないが、監査を無視せず対象経路だけを固定した。drizzle-kitは直接依存に入れない |
| `@ai-sdk/provider-utils@5.0.49>undici` | 7.29.1 | [GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v)。残る1つの依存元だけを修正版7.xに固定する。miniflareは自身でundici 7.29.1を固定している。根拠と解除条件は[undiciの記録](../references/undici-security-20260929.md) |
| `@tailwindcss/node@4.3.3>source-map-js` | 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。修正版の実装を、その依存元のスコープに限って使う |

`minimumReleaseAgeExclude`は置いていない（2026-10-21に削除）。導入時の例外はAI SDKの旧い特定版2件だけで、lockfileの版とは一致せず、現在のlockfileは例外なしで供給網ポリシーの検査（`pnpm install --frozen-lockfile`）を通る。公開直後の版を使う必要が生じたら、版を指定した例外を一時的に追加し、待機期間を満たしたら削除する。広いパターンや全体無効化は使わない。設定構文の根拠: [pnpmの依存解決](https://pnpm.io/settings/dependency-resolution)。

## 配備の手順

CIは`.github/workflows/ci.yml`の検証専用で、有料APIの実行や自動deployを含めない。順序は`pnpm check` → `pnpm db:migrate:local` → build済みpreviewのHTTP smoke（失敗時はpreviewログの末尾を出力）→ `pnpm audit`。pushはmainと`codex/**`、およびpull requestで走る。ローカルでのチェック成功とGitHub Actions上の成功を区別する。

初回配備前に、公開先、環境、必要リソース、費用、Secrets投入方法、戻し方を具体化し、その範囲の承認を得る。作業の再開を公開の承認とは扱わない。

Cloudflare Vite pluginを使うため、**buildとdeployの環境を一致させる**。通常stagingは`CLOUDFLARE_ENV=staging pnpm build --mode standard-staging-local`、productionは`CLOUDFLARE_ENV=production pnpm build --mode production-local`で対象の管理外設定を明示選択する。実設定は本人が別承認の後に管理する。公開wranglerだけの環境指定buildはテンプレートの検査であり、完成した配備設定と扱わない。生成物の環境・認証・bindingを確認してから、承認された配備へ進む。preview/deploy時の環境指定だけで別環境へ切り替えない。

生成設定は`dist/server/wrangler.json`、Worker本体は`dist/server/index.js`、assetsは`dist/client`。通常stagingの例は次のとおり。

```sh
CLOUDFLARE_ENV=staging pnpm build --mode standard-staging-local
WRANGLER_SEND_METRICS=false pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
```

環境選択はbuildコマンドだけに設定する。生成設定には環境が展開済みのため、続くWranglerコマンドに `--env` を重ねない。実配備は公開先・リソース・費用等を承認後、同じ生成設定を使って `--dry-run` を外して行う。初回は公開経路なしでWorkerを配備し、専用Worker全体のAccess保護とAUD反映を確認してからCustom Domainを追加する（[Accessの推奨設定](auth.md#cloudflare-accessを選ぶ場合)）。dry-run成功を配備成功と扱わない。

環境別buildの事前生成時に、生成済み設定に環境節がない旨の警告が出る。buildは成功し、生成Worker名が正しいこととdry-runで確認できるが、クラウドの環境別binding接続は配備後に確認する。設定確認時もSecretを含むファイルや環境を表示しない。通常stagingだけ`/help`をSSRにしている（`build-policy.ts`の`prerenderHelpFor`）。

配備時には対象環境、ソースのrevisionまたは内容識別子、lockfile、compatibility date、Worker version、migration状態を対応付けて記録する。公開ページ・API・認証境界・webhook到達性を確認し、実LLM疎通は承認した回数と費用内に限定する。

## 複製先の実配備で確認した注意点

確認日: 2026-10-09。最初の用途別複製先（本人1名・Access保護の通常staging）が2026-10-06〜08に実配備で踏んだ事項。根拠は複製先リポジトリの配備履歴・運用文書で、スターター自身の実環境では再現していない。個人・社内向けの通常stagingを作るときの既定手順として扱う。

| 段階 | 注意点 | 対処 |
| --- | --- | --- |
| リモートmigration | 複数文のtriggerを含む0008以降で、WranglerのリモートSQL分割により`incomplete input`（7500）が出た。0001〜0007は成功し、途中で止まった | 正本SQLは編集せず、[`scripts/d1-wire.ts`](../scripts/d1-wire.ts)の`renderD1Wire(sql)`で生成した送信用SQLを未適用分だけ適用する。この関数を呼ぶCLIはリポジトリになく（呼び出しは`tests/d1-wire.test.ts`のみ）、呼び出す小さなscriptは複製先で用意する。管理画面のテーブル数は更新前表示のことがあり、部分適用なしの証拠にしない |
| 実D1の照合 | `wrangler d1 migrations list`は対象DBに管理テーブルを作り得る | 実DBの適用状況は読み取り専用のSELECTで履歴表とschemaを照合する |
| 失敗・結果不明 | 送信後に応答が不明なmigrationを同じ内容で再送すると二重適用の恐れがある | 再送せず、SELECTで履歴・列・初期行を確認してから次を決める。1回の操作で1本ずつ適用する |
| リモート認証 | 対象ID一致でもリモートD1操作が認可エラー（7403）になった | 既存OAuthの再認証と同一対象への`SELECT 1`成功を確認して進めた。因果は未確定のため、再発時は対象アカウントと権限を先に照合する |
| build | 通常stagingの実設定ON buildで`/help`事前生成後にprocessが終了しなかった | スターターも通常stagingだけ`/help`をSSRにした。本人用の事前確認には段階表示と時間上限（build 120秒、dry-run 60秒）を付ける |
| deploy | build用の`CLOUDFLARE_ENV=staging`をdeployへ引き継いだ結果、意図しない別名Workerが作られ、削除が必要になった | 環境はbuildだけに指定し、deployは生成設定と既存Worker名を明示する。`--env`も重ねない。dry-run成功を配備成功と扱わない |
| 初回公開 | ― | 公開経路なし・全OFFで配備 → 管理画面でURLなし/workers.dev・preview無効/想定bindingを確認 → Access保護 → 専用ホスト接続、の順を守った |
| 停止 | Access policyをBlockにしても、発行済みセッションではアプリへ到達できた | 停止はOFF版配備、Access policyのBlock、対象アプリ単位の既存トークン取消の3操作に分ける。自然期限を取消の証拠にしない |
| ログアウト | Accessのlogout URLは全アプリのセッションに効く | アプリ単位の停止・終了操作に使わない |

RAG拡張に固有の事項（AI Search同期の30秒cooldown、結果不明時に自動再同期しない原則、検索専用の限定試行台帳）は複製先の文書で管理し、スターターの標準手順には含めない。受入と本番前の確認項目は[公開前チェック](launch-checklist.md)で管理する。

## 復旧

不具合時は影響を確認し、必要に応じて有料処理・拡張の実行を止める。リクエスト本文や認証情報を追加ログへ丸ごと記録しない。

直前の正常なWorker versionと、現在のD1 schema・binding構成の互換性を確認してからrollbackする。公開環境のrollbackも外部変更として具体的な対象と範囲を確認する。旧versionへ戻すと古いbindingや処理方式が復活する場合があるため、Workerだけの復旧で十分かを判断する。

DB復元が必要なら、復元後に失われる更新、契約/外部ジョブとの整合、重複処理を確認する。Workflowsや課金処理など外部副作用はWorkerのrollbackでは取り消されない。復旧後はHTTP・認証・所有権・必要な拡張を検証し、原因と再発防止を作業記録に残す。
