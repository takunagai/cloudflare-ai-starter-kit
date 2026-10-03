# 環境・更新・配備・復旧の運用方針

2026-10-02・C-1: [local](presets/local.md)・[個人/社内](presets/internal.md)・[公開サービス](presets/public.md)の文書3入口と本書の停止条件を整合しました。実設定・認証方針・費用条件は変更せず、実接続/配備を許可していません。[C-1の文書検証と引き継ぎ](C1完了-次セッション開始プロンプト.md)を参照してください。以下のB-4/B-3J等は当時の実施記録です。

2026-10-02・B-4: [公開5設定例とbuild境界](公開プリセットとbuild境界.md)を実装/ローカル検証した。旧staging-localの解決先を保持し、通常staging/productionを新しい管理外設定へ明示選択する。mode/環境不一致・必要ファイル不在・解決後のAPP_ENV/ポリシー不一致で停止。全例Jev/任意拡張OFF。実設定/旧台帳・依存/lockfile/0001〜0007は変更なし。[今回の証拠と最終Git](B4完了-次セッション開始プロンプト.md)を参照。以下のB-4未実装/次工程は過去の記録で、現在の配備/実接続許可ではない。

2026-10-02・B-3J実装/ローカル適用: [0007](../migrations/0007_decision_requests.sql)は本文/結果/hashなしの専用要求台帳1tableとindex/CHECKだけの追加です。既存ローカルD1へ1件適用、再適用0件。空DB/0006からの追加/再適用と合成の既存チャット・旧消費台帳保持をworkerd/D1で確認しました。0001〜0006・既存配備設定・実リソースは変更なし。未適用tableは503、HTTPでschema自動作成しません。rollbackで新台帳をDROPせず、unknownを自動解放/再送/削除しません。復元時はJev OFF/受付停止と照合完了までの再有効化禁止を維持します。[保持・削除遅延・復旧の契約](Jev-B3J-実装前契約.md#保持期限migrationの条件)、[最終検証](B3J完了-次セッション開始プロンプト.md)を参照。以下の実装許可待ちの節は履歴です。

2026-10-02・B-3Jの採用済み設定メモ: 本人の3組への回答で[API/独立枠/全数値/本文なし台帳/保持・削除/復元契約](Jev-B3J-実装前契約.md)を確定しました。終端90日・結果非保存/再表示なし、unknownの消費/同時枠保持と自動再送/削除/枠返却なし、metadata回復の独立を採用。unknown3件で環境停止し得る点、停止環境での物理削除遅延、backup復元によるclaim巻戻りを維持します。新SQLは別の実装許可後に次空き番号へ追加し、現在0001〜0006と配備設定を維持。上流契約の本文/派生情報/backup保持・不明要求の修復、実料金/失敗課金/credit自動補充は実接続前の別確認です。今回コード/SDK/migration/Cron/automation・実環境操作は行っていません。

2026-10-02・B-3: 直接provider・任意拡張・Workflow再開・署名済み決済webhookの設定/台帳境界をローカルで統合しました。[設定メモ](実AI検証制御-実装状況.md#2026-10-02-b-3のモデル選択と別入口統合)を参照してください。通常stagingは別Worker/別DBで0006のtableあり/行なしを前提とし、旧検証stagingを転用しません。公開設定/buildのB-4、Jev service、新メディアと実環境操作は未実施です。以下のB-2追記は当時の境界を保持する記録です。

2026-10-02・B-2: HTTPモデル一覧と標準チャットの通常staging境界をローカル検証しました。別Worker/別DBで0006のtableあり・行なしを使い、旧行あり/照会失敗/未適用なら生成を拒否します。台帳を消したり時刻を変えて旧DBを通常へ転換しません。認証と所有者の履歴回復は継続します。通常stagingの任意拡張はB-3まで閉じ、B-4の設定例/新buildモードも未実装なので、新モード指定や実配備へ進まないでください。既存設定・0001〜0006・実リソースは未変更。管理場所と影響は[境界設定メモ](実AI検証制御-実装状況.md#2026-10-02-b-2の設定境界と統合範囲)、ローカル結果は[進捗](plan.md)を参照。以下の実環境結果は記録当時の証拠です。

2026-09-29の最新結果: 追加承認後の修正版で実AIを2回検証し、逐次表示・履歴保存/復元・試験会話削除を確認しました。終了時はAI bindingを除去して無効化配備し、08:23 JSTに期限前AI OFFとAccess遮断を確認。終了後D1は0006履歴1件・台帳1行・消費2回です。[完了結果](実AI接続-最小検証計画.md#修正版の実接続結果後処理中2026-09-29)。以下の未検証・追加承認待ちは過去の記録です。

2026-09-29追記: 限定承認に基づくAI有効化/無効化の計2配備を完了しました。状態APIの入口登録漏れによる404を検出し、推論0回で中止。期限前のAI利用不可とログアウト後のAccess遮断、終了後の0006履歴1件・台帳0行を確認しています。入口修正版はローカルcheck・HTTP smoke成功、実配備は未実施です。再試験の追加配備・必要な追加OTPは[具体案](実AI接続-最小検証計画.md#修正版の再試験に必要な追加承認)への明示承認後に行います。以下の一般手順と過去の状態は現在の実施結果と区別してください。

更新日: 2026-09-28。第2段階を含む運用手順。専用staging D1・Worker・Access・Custom Domainの配備を実施済み。本人のOTP受信・Accessログイン・認証後UIと実D1レート制限書込みを確認済み。会話保存・実AIは未検証。実行状態は[staging作業ログ](staging-work-log.md)を正本とし、以下の一般手順だけを実行済みの証拠としない。

今後の実AI接続は[最小検証計画](実AI接続-最小検証計画.md)の過去の許可を再利用せず、新しい対象・費用・終了方法を承認してから行います。既存stagingの0006追加・2推論・無効化は完了済みで、migration再適用や台帳リセットは不要です。公開設定はAI OFF、既存stagingもAI OFF・binding除去済み。実配備設定は本人が管理します。[使用量・請求確認](実AI検証-使用量と請求確認.md)と[取り込み後の用途別案](main取り込み-最終レビューと次の用途.md)を参照してください。ローカルbuild/previewの成功を実配備成功と扱いません。

## 環境の分離

| 環境 | 目的 | 方針 |
| --- | --- | --- |
| local | 日常開発・自動テスト | workerdで再現。外部課金・メール配信なし。localhostだけへbind |
| staging | 承認後の実クラウド検証 | 本番とWorker、Secrets、D1、R2等を分離。必要な任意拡張のみ設定 |
| production | 本番利用 | stagingで確認した成果物・migrationの手順を適用。権限と公開範囲を明示 |

`wrangler.jsonc`の`env.staging` / `env.production`は公開用テンプレート。`workers_dev: false`、`preview_urls: false`、`send_metrics: false`を維持し、実D1 ID・AUD・Custom Domainは含めない。公開stagingと既存`staging-local`は旧verificationの閉鎖/省略互換を保持する。用途2/3の通常stagingとproductionは[B-4の公開5例と固定mode対応](公開プリセットとbuild境界.md#buildの選択と拒否)を別に選ぶ。実設定の保存・非共有・複製除外は[公開情報と履歴管理](リポジトリ-公開情報と履歴管理.md#用途別設定の保存と共有2026-10-02)に従う。Cloudflareアカウント全体の設定変更や、管理外ファイルの作成・閲覧をこの文書で許可しない。

Workersの環境別bindings・vars・Secretsを暗黙継承すると考えない。D1/R2/AI/Workflows等のbindingsは使用する環境ごとに明示する。環境を選ぶだけで本番の設定やデータを流用しない。ローカルDBはダミーIDを持つDB bindingでエミュレートする。staging/productionへは本物の環境別D1を明示追加する。

## ローカルの準備と確認

1. Node.js 26.10.0とpnpm 12.6.0を用意する。
2. `pnpm install --frozen-lockfile` でlockfileどおりに依存を入れる。
3. `pnpm check` でlint・型検査・Workers向けテスト・buildを実行する。
4. `pnpm db:migrate:local`でローカルSQLを適用後、`pnpm dev`、またはbuild後の `pnpm preview` で画面を確認する。
5. READMEに示す対象URL・起動条件で `pnpm smoke` を実行し、SSR本文とHTTP疎通を確認する。

ポート競合時は既存プロセスを無断終了せず、使用中の作業を確認する。dev/previewはローカル検証であり、Cloudflare上の配備成功や実provider接続を証明しない。

## 工程E前の停止条件

確認日: 2026-10-02。用途別入口は公開例とローカル/fakeの証拠を説明する文書です。C-1で次の未確定条件は解消しておらず、実設定作成・実接続・配備・公開切替を先行しません。既存の設定方針は[用途別計画](用途別プリセット-開発計画.md)、Jev固有の採用契約は[Jev契約](Jev-B3J-実装前契約.md)を正本とします。

| 確認する条件 | 残す判断・影響・管理場所 |
| --- | --- |
| 対象・認証・分離 | 最初の用途、環境、別Worker/別DB、origin、利用者、Access範囲/sessionまたはBetter Authの実メール/公開経路。本人が対象Worker、Zero Trust → Access → Applications、Email Serviceで照合。旧検証/ローカルの設定・DB/sessionを流用しない |
| 実契約・送信データ | 実適用Order/DPA、送信可能なデータ、本文/派生情報/backup・ログの保持/削除、削除要請の扱い。非学習・アプリ非保存を上流ZDRの保証へ拡張しない |
| 不明要求の運用 | unknownの上流照合・修復・削除要請、停止環境での削除遅延、復元後の照合。Jevの自動再送/削除/枠解放、台帳DROP、復元直後の再有効化を追加しない |
| 実権限・品質 | 選択モデル/固定版の提供継続・権限、日本語品質。fakeの型適合やavailable表示だけでは実権限・精度を保証しない |
| 費用・期間・終了 | 実料金、失敗課金、credit自動補充、人数、総予算、回数、期間、共有利用と終了操作。回数枠は硬い請求額上限ではなく、abortは上流停止/未課金の証拠ではない |
| 実操作の承認 | Access/OTP、メール/DNS、各provider/Jev/拡張、リソース作成、remote migration、build/配備/公開について具体的な対象・影響・費用・終了方法を別に承認。過去の固定窓・残枠・予算・OTP/配備許可は流用しない |

AI_MODE、JEV_MODE、各ENABLE_*、実メールは独立です。必要な接続だけ選び、停止操作も個別に確定します。AI OFFだけで画像/決済/メールを全停止したと扱わず、既に送信した上流処理をWorkerの停止/rollbackで取り消せると説明しません。

Jevは本文/結果/hashなし、終端90日・結果再表示なし、unknownの消費/同時枠保持を維持します。GETは本人metadataの要求台帳読取だけで、既存rate limit counter以外の状態を更新しません。実上流の保持/unknown修復/料金を新しく採用した記録ではありません。

2026-10-03に本人がM-0の[private R2/短期取得経路・入力/生成/同時処理上限・ジョブ保持](fal-メディア-M0差分設計.md#b-2時点の採用確認と検証待ち)の2組を設計採用しました。環境合計10 GiB、本文終端30日/本文なし台帳終端90日と早期本文消去・未終端/受付不明保持・バックアップ区別/復元条件を含みます。参照7日/生成30日/所有者1 GiB・初版除外とJev固有契約は維持します。今回の回答はM-1以降の実装・実Access/R2変更・公開取得経路開設・素材送信・課金・配備の許可ではありません。falの上流保持/ACL/Store-IO/実価格/権限/品質は未検証、Directorは対象外です。

## Secretsと設定

ローカルSecretはコミット対象外の専用ファイル、本番SecretはCloudflareのSecretsを使う。項目と投入先はauth.md、providers.md、extensions.md、billing.mdの機能別手順を参照する。全OFFの任意拡張のためにアカウントやSecretを作らない。

秘密の閲覧・投入・検証・漏えい対応はユーザーレベルの共通ルールを正本とする。アプリ固有の事項は [Secrets運用補足](../rules/secrets.md) を参照する。実Secretの投入はユーザーが別ターミナルで行い、エージェントは値を取得・表示しない。最小権限と環境別の資格情報を使う。

Cloudflareの`wrangler secret put`は即時deployを伴う外部変更として扱う。対象環境・設定・影響を確定し、承認された範囲で対話入力を案内する。単なる設定確認として実行しない。

## 第2段階のD1 migration

`migrations/`の連番SQLを履歴管理する。認証はDrizzle schemaとSQLの列・制約一致を実D1テストで確認する。チャットと拡張の枠予約・冪等処理は明示SQLとD1の原子的batchを使う。自動schema pushは使わず、変更ごとに次番号のSQLを追加してレビューする。適用済みSQLを編集しない。空DBへの全適用・再適用と、既存データを保持した追加migrationを検証する。

ローカルは`pnpm db:migrate:local`。認証・会話・資料metadata・ジョブ・課金台帳・Jev要求metadataを同じ環境のD1へ保存し、対象は0001〜0007。リモートは別承認後に対象の管理外設定・環境・DB bindingを明示して適用する。公開wranglerのダミーIDや、旧verificationの設定を新しい通常stagingへ流用しない。productionも対象を明示して別に適用する。C-1ではローカル/remoteとも追加適用していない。

リモート適用前に対象環境とDBを照合し、バックアップ/復旧可能点、既存コードとの互換性、適用順を確認する。staging検証後にproductionへ進む。削除・rename・型変更など既存データへの影響がある変更は、追加→移行→削除の段階的変更を優先する。SQL生成や型検査が成功しても、DBへ適用済みとは扱わない。

アプリのrollbackはDB schemaを自動で戻さない。古いWorkerとの互換性を残すmigrationを基本とし、復旧が必要な変更はデータ保全を含む手順を別途用意する。D1作成・remote migration・復元を実行する前に具体的な対象と操作範囲を確認する。

## 依存更新と監査

2026-09-29: 実AI終了記録のCIでundici 7.29.0の監査指摘1件を検出したため、2つの既存依存元だけ7.29.1へ限定固定しました。[公式根拠・適用範囲・解除条件](../references/undici-security-20260929.md)を参照してください。固定install・audit（既知の指摘0件）・check（lint57ファイル、型検査、201テスト/15ファイル、build）・ローカルHTTP smokeは成功し、previewも終了しました。監査の除外設定は追加していません。追加配備・実AIは行わず、ローカルbuild後の`dist/`は配備用ではありません。依存修正head `f2f7847c`のpush/PR CIは両方successを再確認済みで、以後の文書更新headも別に確認します。

Node/pnpm、フレームワーク、Cloudflareツール、品質ツールを無差別に一括更新しない。関連する依存を小さくまとめ、公式変更履歴・engines・peerを確認してexact versionとlockfileを更新する。

更新時は `pnpm audit`、`pnpm check`、ローカルHTTPのsmokeを行う。auditの成功は安全性全体の保証ではなく、報告された問題も到達経路・実行環境・修正版の有無を確認する。必要な修正を無視するための例外を残さず、例外が必要なら理由と期限を記録する。互換性が崩れたら直前のpackage/lockfileの組み合わせへ戻して再インストールする。

Cloudflareの `compatibility_date` は日付だけ先に更新せず、対応workerdと動作変更を確認して変更する。生成されたbindings型・route型・build成果物は更新後に再生成する。

## 配備の手順

CIはchecks専用とし、有料APIの実行や自動deployを含めない。ローカルでのチェック成功とGitHub Actions上の成功を区別する。

初回配備前に、公開先、環境、必要リソース、費用、Secrets投入方法、戻し方を具体化し、その範囲の承認を得る。第2段階の作業再開を公開の承認とは扱わない。

Cloudflare Vite pluginを使うため、**buildとdeployの環境を一致させる**。旧検証stagingは既存のstaging-local、通常stagingは`CLOUDFLARE_ENV=staging pnpm build --mode standard-staging-local`、productionは`CLOUDFLARE_ENV=production pnpm build --mode production-local`で対象の管理外設定を明示選択する。必要ファイルは今回作成せず、実設定は本人が別承認後に管理する。公開wranglerだけの環境指定buildはテンプレートの検査であり、完成した配備設定と扱わない。生成物の環境・認証・bindingを確認してから、承認された配備へ進む。preview/deploy時の環境指定だけで別環境へ切り替えない。

生成設定は`dist/server/wrangler.json`、Worker本体は`dist/server/index.js`、assetsは`dist/client`。第1段階のbuild/dry-run、B-4の合成build、実配備の結果はそれぞれの対象版に限る。以下のコマンドは旧verification専用の過去の選択方法で、用途2/3の通常stagingへ転用しない。新しい対象は上の固定対応と、別承認された実設定を使う。C-1ではbuild/dry-run/配備を実行していない。

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
