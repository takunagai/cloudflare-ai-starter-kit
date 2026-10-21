# 公開サービス向けに準備する

配備先の認証はBetter Authのメール＋パスワードです。共通のlocalから開始し、実メール/DNS/AI/Jev・配備・公開を行う前に止まります。この入口は本番利用の準備完了や実公開の証拠ではありません。

## 選択した用途・環境・認証・AI・拡張

| 項目 | ローカルでの開始 | 配備先の準備 |
| --- | --- | --- |
| 用途・環境 | [ローカルで試す](local.md)、`APP_ENV=local` | 公開サービス。通常stagingとproductionを別Worker/別DBにする |
| 認証 | `AUTH_MODE=better-auth`、架空登録・確認メール省略 | 同じ方式だが実Secret・メール確認必須。メール未確認ユーザーのsessionを認可に使わない |
| origin | loopbackのdev/preview | 各環境の単一HTTPS origin。実要求と一致が必要 |
| チャット | `LOCAL_DEMO="true"`、`AI_MODE=local-demo` | `LOCAL_DEMO="false"`、`AI_MODE=off`。許可モデル省略、AI binding・provider Secretなし |
| Jev | `JEV_MODE=off` | 同じくoff。`JEV_MODEL`と`TYPESAFE_API_KEY`は不要。チャットモデルとは独立 |
| 任意拡張 | RAG/agent/Workflows/画像/メディア/決済すべてOFF | 同じく6種OFF。公開用途を選んでも決済やGoogleを自動で有効にしない |
| D1・公開経路 | ローカルDB、現行の全migration（0001〜0012・0014〜0016。0013は管理外の欠番） | 各環境専用DB。公開例はダミーDB、routeなし、workers.dev/preview URL無効 |

ローカルのメール確認省略・ダミーSecret・利用者/sessionを非localへ持ち込みません。staging/productionのBetter Authに必要な設定が不足すると認証処理は503で停止し、Accessや別方式へ自動切替しません。所有権は認証後もアプリで確認します。

### 公開例とbuild対象

| 対象 | 公開JSONC断片・適用先 | 別承認後に使うbuildの固定対応 |
| --- | --- | --- |
| 通常staging | [public-staging](../../examples/presets/public-staging.jsonc)、新しい`env.staging`。`STAGING_POLICY=standard` | `standard-staging-local`、`CLOUDFLARE_ENV=staging`、新しい管理外standard-staging設定 |
| production | [public-production](../../examples/presets/public-production.jsonc)、新しい`env.production`。`STAGING_POLICY`は省略 | `production-local`、`CLOUDFLARE_ENV=production`、新しい管理外production設定 |

両例は単独deploy用ではなく、EMAIL bindingの形、空EMAIL_FROM、例示用origin、ダミーDBを示す断片です。実Secret、送信ドメイン、実リソース、公開経路は設定されていません。EMAILは公開向け認証に使う2例だけの項目で、AI/Jevや全用途の必須bindingではありません。

公開wranglerの共通部分を基礎に、vars/bindingを各環境節へ明示する方針です。断片の`env`で浅く上書きしたり、bindingの暗黙継承を前提にしたりしません。[公開プリセットとbuild境界](../公開プリセットとbuild境界.md)と[保存・共有の境界](../リポジトリ-公開情報と履歴管理.md#用途別設定の保存と共有)を参照し、実値を含む完成設定は今回作成・閲覧・複製・変更しません。

mode/環境省略・不一致、必要ファイル不在、解決後の環境節/APP_ENV/ポリシー不一致では停止し、公開例へ代替しません。`-local`は設定の保管場所で、APP_ENV=localではありません。previewはflatten済み成果物を使い、preview時の環境指定でretargetしません。別対象は再buildが必要です。

公開wranglerのstagingは`STAGING_POLICY`を書かない閉鎖経路で、全経路を503 `missing_staging_policy`で閉じます。通常stagingは別Worker/別DBで`STAGING_POLICY=standard`を明示し、0006のtableあり/行なしを用意します。旧台帳の行あり・未適用・照会失敗なら生成/拡張を拒否し、削除・更新・時刻変更で解除しません（[実行時方針](../runtime-policy.md)）。

## 未設定項目

| 項目 | 必要な確認・管理場所 |
| --- | --- |
| 認証Secret | `BETTER_AUTH_SECRET`は32文字以上の実Secretが必要。投入は別承認後に本人が会話外で行う。localダミーを転用しない |
| 実メール | `EMAIL` binding、`EMAIL_FROM`、送信ドメインのonboard/DNS、テスト送信先・回数・費用。本人がEmail Serviceで管理。public例のbinding形だけでは送信成功にならない |
| セッション・利用者 | 現行Better Authは7日/更新間隔1日。初版基準とする既存案を示し、公開前の用途別再確認を残す。新しく期間や許可対象を変更しない |
| Worker・DB・origin・公開経路 | 各環境専用リソース・現行の全migration（0001〜0012・0014〜0016。0013は管理外の欠番）の適用計画、HTTPS origin、公開/保護APIとwebhookの到達性。作成・remote migration・公開切替は別承認 |
| チャットprovider | 初期OFF。必要時だけ`AI_MODE=selected`、非空の`AI_ALLOWED_MODELS`、選んだproviderのSecretまたはAI bindingを準備。資格情報だけではONにならない |
| Jev remote | 選ぶ場合だけ固定`jev-1.13.0`・専用Secret・実契約と運用条件を確認。チャットとは別承認、初期OFFを維持 |
| Google・決済等 | Googleは`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`の両方。Polarや他拡張は必要時だけ。標準起動やメール認証に要求しない |
| 費用・終了方法 | 人数、総予算、期間、メール/AI/Jev/拡張それぞれの上限・停止操作を未確定として残す |

公開トップ/ヘルプ、認証入口、有効な決済webhookを対話Accessで誤って遮断しません。保護APIはアプリのsession・所有権、有効なwebhookは独立した署名検証で保護します。個人・社内向けのWorker全体Accessを、公開ページを持つ用途へ無条件にコピーしません。

localでの確認メール再送・再設定要求は実メールなしでは503です。tokenや認証URLをデバッグ応答/ログへ出す代替は作りません。回復フローのfake試験と実メール受信を区別します。[認証](../auth.md#本番のメール認証)を参照してください。

## 次の操作

1. [local手順](local.md#次の操作)の架空登録・固定応答・履歴・logoutから始めます。公開用途を選んだだけで実メールや有料モデルを呼びません。
2. 通常staging/productionの候補、Better Auth方式、対応公開例、未設定項目を整理します。実値は収集せず、役割名・キー名・管理画面の辿り方だけを記録します。
3. [認証](../auth.md)、[モデル接続](../providers.md#導入手順)、[運用](../operations.md)を読み、AI/Jev/拡張OFFのまま準備します。実Secret投入、送信ドメイン/DNS設定、実メール・Google・決済・build/配備はこの文書の閲覧だけでは実行しません。
4. 最新ソースのfake認証・導入手順・別名空DB・画面の検証は[別プロジェクトとして使う手順](../../README.md#別プロジェクトとして使う)として別許可後に行います。実設定や元DBを複製しません。
5. [実接続前の停止条件](../operations.md#実接続前の停止条件)を未解消として残し、実メールと1provider等の対象・回数・費用・終了方法を具体化するところで止まります。工程E/Fとproduction公開は別の明示承認が必要です。

## ローカル・fake・実接続の確認範囲

| 範囲 | 確認済み・未確認 |
| --- | --- |
| 共通local | `pnpm check`とdev/preview HTTP smokeで架空登録・固定応答・履歴・logoutを確認済み。実メール確認ではない |
| Better Authのfake境界 | 実workerd/D1・本物の認証とscrypt、fakeメール配送で確認前拒否・session・再設定/旧session失効・両方式分離・所有権を検証済み |
| 公開例/build | `pnpm test`の境界テストと`pnpm test:build`の合成build/HTTP試験で確認。キーなしbuild/healthは非local認証・実アプリ利用・メール配送の成功ではない |
| 複製・画面 | 別名・空DBへの複製検証は版ごとに行い、過去の版の成功を流用しない |
| 新環境の実接続 | 通常staging/productionの実メール/DNS、Google、provider/Jev、決済、配備/公開は未実施。削除済みの旧stagingで確認した成功を転用しない |

Jevの本文/結果/hash非保存、終端90日・結果再表示なし、unknown消費/同時枠保持と自動再送/削除/解放なし、GETの要求状態更新なし、復元直後の再有効化禁止を維持します。[契約](../Jev-B3J-実装前契約.md)は認可委譲の許可ではありません。回数枠は硬い請求額上限ではなく、abortは上流停止や未課金の証拠ではありません。

メディアの保持・容量の採用条件は[M-0差分設計](../fal-メディア-M0差分設計.md#b-2時点の採用確認と検証待ち)にあります。実装とローカル/fakeの検証は[M-5](../M5-メディア統合と隔離複製検証.md)までで、falの保存/ACL/保持・Store-IO・実価格・権限・品質の確認ではありません。

[READMEの3入口へ戻る](../../README.md#用途を選んで始める) / [個人・社内向け](internal.md)
