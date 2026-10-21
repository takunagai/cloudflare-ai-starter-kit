# 公開プリセットとbuild境界

用途別の公開JSONC断片5例と、ローカルbuildで選べる設定の固定対応を定める。導入文書は[local](presets/local.md)・[個人/社内](presets/internal.md)・[公開サービス](presets/public.md)で、実操作は[実接続前の停止条件](operations.md#実接続前の停止条件)と別承認に従う。実運用設定、クラウド、認証の許可対象/セッション期間、料金条件はこの文書では決めない。

## 設定内容と管理場所

共通のWorker設定を保ち、用途別の公開JSONC断片を5例用意した。単独でdeployするファイルではない。`main`・互換日等は[公開wrangler設定](../wrangler.jsonc)の共通部分を基礎とし、vars/bindingは対象節へ明示する。fragmentの`env`を既存の`env`へ無条件に浅く上書きしない。実値を含む完成設定の作成・投入は本人が別承認後に行う。

| 公開例 | 適用先・認証 | 初期動作・不足項目 |
| --- | --- | --- |
| [local](../examples/presets/local.jsonc) | top-level、Better Auth | `APP_ENV=local`、`AI_MODE=local-demo`、loopback。架空登録・固定応答・D1に実Secret不要 |
| [internal-staging](../examples/presets/internal-staging.jsonc) | 新しい`env.staging`、Access | `STAGING_POLICY=standard`。別Worker/別DB、空team domain/AUD。実Accessは未設定 |
| [internal-production](../examples/presets/internal-production.jsonc) | 新しい`env.production`、Access | stagingポリシー省略。production専用Worker/DB、空team domain/AUD |
| [public-staging](../examples/presets/public-staging.jsonc) | 新しい`env.staging`、Better Auth | `STAGING_POLICY=standard`。別Worker/別DB、EMAIL bindingの形だけ、空EMAIL_FROM。認証Secret・実メール設定なし |
| [public-production](../examples/presets/public-production.jsonc) | 新しい`env.production`、Better Auth | stagingポリシー省略。production専用Worker/DB、同じメール/Secret不足 |

全例で`JEV_MODE=off`、JEV_MODEL/TYPESAFE_API_KEYなし、任意拡張6種OFF。非localはAI_MODE=off/LOCAL_DEMO=false。AI/R2/Workflow等の未使用bindingは追加しない。EMAILは公開向け認証に使う2例だけへ列挙し、AIやJevのための必須項目にはしない。認証未設定の非local例もbuild/公開healthの起動は可能だが、認証・アプリ利用・実メールの成功を示さない。

DB IDは全ゼロのローカル用ダミー、originは`.invalid`、routeなし、workers_dev/preview_urls=false。公開wranglerのlocalは従来のAI_MODE省略からlocal-demoを解決する互換を保持し、用途別local例では明示する。productionは明示OFFと専用ダミーDB、各環境のJevはOFF。公開stagingは`STAGING_POLICY`を書かず、`missing_staging_policy`で全経路を閉じる（[実行時方針](runtime-policy.md)）。AI_MODE/STAGING_POLICYを追加して通常へ転換しない。実設定と旧台帳を整理目的で書き換えない。旧検証用の`staging-local` modeは廃止済みで、指定すると`build_mode_invalid`で停止する。

## buildの選択と拒否

[純粋判定](../build-policy.ts)を[Vite設定](../vite.config.ts)から呼び、固定対応だけを許可する。外部入力から任意のconfigPathを作らない。build前の環境チェックを通過した場合だけ選択先が通常ファイルかを確認し、不在/読取不可では公開例へ代替せず停止する。実設定の本文を独自に読み集める診断は追加していない。

| Vite mode | 設定ファイル | build時のCLOUDFLARE_ENV・APP_ENV/ポリシー |
| --- | --- | --- |
| development / production / test | `wrangler.jsonc` | 省略はlocal。明示stagingはポリシー省略（実行時に閉鎖）、productionはproduction。Viteのproduction名だけではAPP_ENVを変えない |
| standard-staging-local | `.wrangler.standard-staging.local.jsonc` | staging必須、APP_ENV=staging、STAGING_POLICY=standard |
| production-local | `.wrangler.production.local.jsonc` | production必須、APP_ENV=production、STAGING_POLICY省略 |

未知mode、空/未知環境、private modeの環境省略/不一致は、ファイル照会前に固定エラーで停止する。pluginの`config` callbackでは、最終targetEnvironment・環境節の存在・APP_ENV・STAGING_POLICYも照合する。環境節欠落をtop-levelで代替しない。認証やprovider/Secretの完全性検査は既存のruntime guardで行い、build成功を実接続の許可にしない。

新しいprivate modeはshellでCLOUDFLARE_ENVを明示する。Vite/pluginがdotenvから異なる環境を解決した場合もcallbackで拒否する。dotenvを独自に一覧化/転記する仕組みは作らない。公開用例をそのまま実配備しない。`-local`は設定の保管場所で、APP_ENV=localの意味ではない。

`.gitignore`とBiomeは新しい管理外2ファイルを除外する。既存の管理外staging設定と復旧領域の除外も維持。フック・例外・baselineは変更しない。管理外ファイルは共有/複製に含めず、実ID/AUD/個別URL/Secretをリポジトリへ戻さない。

previewはbuild済みのflattenされた成果物を使用する。元のprivate設定が不在でもpreviewでき、preview時のCLOUDFLARE_ENVで別環境へ切り替わらない。別環境には該当ソース設定で再buildし、生成物を確認する。buildと配備の対象一致が必要な理由は[公式Cloudflare environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)も参照。

## 検証範囲と変更時の注意

`pnpm test`は実workerdテストの後に`pnpm test:build`を実行する。追加の[test:build](../tests/build-fixtures.test.mjs)は、公開buildモジュール2件と公開設定から一時ディレクトリに合成Workerを作り、固定版pluginのbuild/flatten/ローカルHTTP起動と拒否を確認する。実アプリの別名クリーン複製、実Access/メール/AIの検証ではない。実設定や元DBは複製しない。合成previewは自身のchildだけを終了し、一時fixtureも回収する。

mode/環境対応を変更するときは、[境界/公開例テスト](../tests/build-policy.test.ts)・実plugin試験・本書・[実行時方針](runtime-policy.md)を一緒に更新する。通常check/buildと、そのbuild後のHTTP smokeも確認する。

Vite設定のTypeScript importは拡張子を明示する。`tsconfig.json`では既存のstrict/noEmitを維持し、allowImportingTsExtensionsを有効にした。固定版で追加されたnative config loader向けの拡張子省略警告を解消するためで、型検査の省略や警告の抑制はしていない。
