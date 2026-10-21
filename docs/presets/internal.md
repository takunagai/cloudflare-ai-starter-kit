# 個人・社内向けに準備する

配備先の認証はCloudflare Access、開発開始は共通のローカルBetter Authです。ここでは公開例と準備項目を確認し、実Access・OTP・AI/Jev・配備へ進む前に止まります。許可対象やセッション、費用はこの文書では決めません。

## 選択した用途・環境・認証・AI・拡張

| 項目 | ローカルでの開始 | 配備先の準備 |
| --- | --- | --- |
| 用途・環境 | [ローカルで試す](local.md)、`APP_ENV=local` | 個人・社内用。通常stagingとproductionを別Worker/別DBにする |
| 認証 | `AUTH_MODE=better-auth`、架空登録 | `AUTH_MODE=access`。署名・issuer・AUD・期限等を検証したJWTから本人を確定 |
| origin | loopbackのdev/preview | 対象環境の単一HTTPS origin。実要求と一致が必要 |
| チャット | `LOCAL_DEMO="true"`、`AI_MODE=local-demo` | `LOCAL_DEMO="false"`、`AI_MODE=off`。許可モデルは省略、AI binding・provider Secretなし |
| Jev | `JEV_MODE=off` | 同じくoff。`JEV_MODEL`と`TYPESAFE_API_KEY`は不要。AI選択とは独立 |
| 任意拡張 | RAG/agent/Workflows/画像/メディア/決済すべてOFF | 同じく6種OFF。AI_MODEはこれらを止める一括スイッチではない |
| D1・公開経路 | ローカルDB、現行の全migration（0001〜0012・0014〜0016。0013は管理外の欠番） | 各環境専用DB。公開例はダミーDB、routeなし、workers.dev/preview URL無効 |

ローカルの架空登録成功はAccess認証の成功ではありません。AccessモードはBetter Auth cookieや認証APIを受け付けません。所有者IDは認証方式別で、メール一致による自動統合やローカルsessionの移送をしません。

### 公開例とbuild対象

| 対象 | 公開JSONC断片・適用先 | 別承認後に使うbuildの固定対応 |
| --- | --- | --- |
| 通常staging | [internal-staging](../../examples/presets/internal-staging.jsonc)、新しい`env.staging`。`STAGING_POLICY=standard` | `standard-staging-local`、`CLOUDFLARE_ENV=staging`、新しい管理外standard-staging設定 |
| production | [internal-production](../../examples/presets/internal-production.jsonc)、新しい`env.production`。`STAGING_POLICY`は省略 | `production-local`、`CLOUDFLARE_ENV=production`、新しい管理外production設定 |

両例とも単独deploy用ではありません。公開wranglerの共通部分を基礎に、vars/bindingを対象節へ明示する方針です。`env`を断片で浅く上書きしたり、環境間でbindingが自動継承されると考えたりしません。実値を含む完成設定は今回作成・閲覧・複製・変更しません。[公開プリセットとbuild境界](../公開プリセットとbuild境界.md)と[保存・共有の境界](../リポジトリ-公開情報と履歴管理.md#用途別設定の保存と共有)が正本です。

必要ファイル不在、mode/環境の省略・不一致、解決後の環境節/APP_ENV/ポリシー不一致ではbuildが停止します。公開例への代替はありません。`-local`は設定の保管場所を示し、APP_ENV=localではありません。previewはflatten済み成果物を使うので、preview時の環境指定で切り替えず、別対象は再buildが必要です。

公開wranglerのstagingは`STAGING_POLICY`を書かない閉鎖経路で、全経路を503 `missing_staging_policy`で閉じます。通常stagingは`STAGING_POLICY=standard`を明示し、0006のtableあり/行なしが必要です。未適用・行あり・照会失敗なら生成/拡張を拒否します（[実行時方針](../runtime-policy.md)）。旧DB・台帳を新DBへコピーしません。

## 未設定項目

| 項目 | 必要な確認・管理場所 |
| --- | --- |
| Access | `ACCESS_TEAM_DOMAIN`と`ACCESS_AUD`は公開例では空。実設定は本人がZero Trust → Access → Applicationsで管理。実ID/AUD/個別URLを文書・Gitへ記録しない |
| 利用者・保護範囲・session | `/app`と保護APIの範囲、公開トップ/ヘルプ、有効なwebhookの扱いを決める。1時間sessionは推奨案で、新環境ごとに確定する（[Accessの推奨設定](../auth.md#推奨する設定)）。ほかの環境の設定を無断でコピーしない |
| Worker・DB・origin | 新しい通常stagingとproductionそれぞれの専用リソース・HTTPS origin・現行の全migration（0001〜0012・0014〜0016。0013は管理外の欠番）の適用計画。作成・remote migrationは別承認 |
| チャットprovider | 初期OFF。必要時だけ`AI_MODE=selected`、非空の`AI_ALLOWED_MODELS`、選んだproviderのSecretまたはAI bindingを準備。資格情報だけではONにならない |
| Jev remote | 選ぶ場合だけ固定`jev-1.13.0`・専用Secret・実契約と運用条件を確認。チャットと別に承認。既定OFFで起動できる |
| 費用・終了方法 | 人数、総予算、回数、期間、共有利用、外部接続ごとの停止操作を未確定として残す。過去の検証予算を流用しない |

Better Auth用Secret、Google、アプリの認証メール設定はAccessだけの利用に要求しません。ただしAccessのIdP・OTP通知は別の実接続です。アプリメール不要をOTP送信の許可や未送信保証に読み替えません。[認証](../auth.md#cloudflare-accessを選ぶ場合)を参照してください。

## 次の操作

1. まず[local手順](local.md#次の操作)の架空登録・固定応答・履歴・logoutで共通アプリを確認します。
2. 配備候補の環境、Access方式、公開例、未設定項目を上表で整理します。実値を収集せず、役割名・設定キー・管理画面の辿り方だけを記録します。
3. [モデル接続](../providers.md#導入手順)と[認証](../auth.md)の必須条件を読みます。AI/Jev/拡張はOFFのままで準備できます。ON/OFFの変更、実Secret投入、Access作成・OTP・build/配備はこの入口を読んだだけでは実行しません。
4. 最新ソースの導入手順・fake認証・別名空DBの検証は[別プロジェクトとして使う手順](../../README.md#別プロジェクトとして使う)として別許可後に行います。元プロジェクトの実設定・ローカルDB・復旧領域を複製しません。
5. 実配備へ進む場合は、[複製先の実配備で確認した注意点](../operations.md#複製先の実配備で確認した注意点)の順序（全OFF配備 → Access保護 → 専用ホスト）と停止3操作を先に確認します。
6. [実接続前の停止条件](../operations.md#実接続前の停止条件)を未解消として残し、必要な実Accessと1provider等の対象・費用・終了操作を具体化するところで止まります。工程E/Fやproduction公開は別の明示承認が必要です。

## ローカル・fake・実接続の確認範囲

| 範囲 | 確認済み・未確認 |
| --- | --- |
| 共通local | `pnpm check`とdev/preview HTTP smokeで確認済み。Accessへの接続試験ではない |
| Accessのfake境界 | 実workerd/D1、合成RSA署名・JOSE検証、fake JWKSで両方式の分離・所有権・設定不備/台帳拒否時の回復を検証済み |
| 公開例/build | `pnpm test`の境界テストと`pnpm test:build`の合成build/HTTP試験で確認。認証未設定でもbuild/health起動可能であり、Accessログインや実アプリ利用の成功ではない |
| 複製・画面 | 別名・空DBへの複製検証は版ごとに行い、過去の版の成功を流用しない |
| 新環境の実接続 | スターター自身の通常staging/productionは未作成。削除済みの旧stagingで確認した成功を流用しない |
| 複製先の実配備 | 2026-10-06〜08に最初の複製先が本人1名・Access保護の通常stagingで実配備し、Workers AI 1モデルとRAGで受入まで完了。踏んだ注意点は[運用手順](../operations.md#複製先の実配備で確認した注意点)、確認項目は[公開前チェック](../launch-checklist.md)。スターター版のAccess・provider接続の成功証拠ではない |

Jevは本文/結果/hash非保存、終端90日、結果再表示なし、unknownの消費/同時枠保持、自動再送/削除/解放なしを維持します。本人metadata GETは要求状態を更新せず、backup復元後は照合完了までOFF・受付停止です。[契約](../Jev-B3J-実装前契約.md)は認可をJevへ委譲する根拠になりません。回数枠は硬い請求額上限ではなく、abortで上流停止や未課金を保証しません。

メディアの保持・容量の採用条件は[M-0差分設計](../fal-メディア-M0差分設計.md#b-2時点の採用確認と検証待ち)にあります。実装とローカル/fakeの検証は[M-5](../M5-メディア統合と隔離複製検証.md)までで、falの保存/ACL/保持・Store-IO・実価格・権限・品質の確認ではありません。

[READMEの3入口へ戻る](../../README.md#用途を選んで始める) / [公開サービス向け](public.md)
