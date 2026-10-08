# 個人・社内向けに準備する

2026-10-03・D-2完了: 許可済み158件の別名複製先で、固定install・空DB・check（487 workerd＋7合成build/HTTP）・dev/最終preview HTTP・現在Chromeの画面と終了処理を確認。[完了結果](../D2-実行記録と再開.md#ポート解放後の完了結果)を参照する。追加フック例外は除去済み。元環境とGit禁止、実接続/クラウド禁止、M-0/工程E前の条件を保持する。社内向け実設定・認証/実接続の成功へ広げない。以下の許可待ち・保留は各工程当時の記録。

2026-10-02・env依存の判断確認: 本人からAを候補とし未確定条件を未回答で残す回答を受領した。不足条件3組を一度確認し、本人から会話外確認は「未確認・回答保留」、原本への4操作は「保留」、保存先は候補の一時領域・本人限定・外部共有なしで確定という回答を受領。禁止解除・D-2実複製/install/migration/起動は未許可。[判断確認メモ・現在の引き継ぎ](../D2-env依存-判断確認と次セッション.md)を参照。この入口のコマンドを今回の許可にせず、M-0未回答と工程E前の未検証条件を保持。以下は各工程当時の記録。

2026-10-02・D-2着手前の整理完了: [複製候補/内容識別・未解消env依存と別判断・将来の導入検証順序](../D2-複製許可リストと依存整理.md)を文書化した。実複製/install/migration/起動は未許可・未実施。この入口のコマンドを今回の許可にしない。次は本人による依存の別判断で、M-0未回答と工程E前の条件は保持。[準備完了時の引き継ぎ](../D2準備完了-次セッション開始プロンプト.md)を参照。以下は各工程当時の記録。

2026-10-02・D-1完了: 通常staging/productionの合成設定で、実Access署名検証/JWKS fakeとC-J通信→API→D1の統合を検証した。487 workerd＋7合成build/HTTPを含むcheck、dev/preview HTTP smokeと共通local画面の操作・終了点検が成功。[D-1の証拠](../D1完了-次セッション開始プロンプト.md)を参照する。実Access/OTP/provider/Jev・別名複製・非local実画面は未実施で、以下のC-J/C-1/B-4は履歴。

2026-10-02・C-J追記: 共通の[Jev標準分類例](../Jev標準利用例.md)を追加しました。合成fixtureは公開表示用、API依頼/状態確認は既存認証と所有権を維持。Access設定やJEV_MODEを変更せず、実接続・新環境の検証には進みません。今回のローカル証拠は[C-J引き継ぎ](../CJ完了-次セッション開始プロンプト.md)、以下のC-1/B-4検証は当時の履歴です。

確認日: 2026-10-02。C-1の導入文書。配備先はCloudflare Access、開発開始は共通のローカルBetter Authです。ここでは公開例と準備項目を確認し、実Access・OTP・AI/Jev・配備へ進む前に止まります。許可対象やセッション、費用を新しく決定していません。

## 選択した用途・環境・認証・AI・拡張

| 項目 | ローカルでの開始 | 配備先の準備 |
| --- | --- | --- |
| 用途・環境 | [ローカルで試す](local.md)、`APP_ENV=local` | 個人・社内用。通常stagingとproductionを別Worker/別DBにする |
| 認証 | `AUTH_MODE=better-auth`、架空登録 | `AUTH_MODE=access`。署名・issuer・AUD・期限等を検証したJWTから本人を確定 |
| origin | loopbackのdev/preview | 対象環境の単一HTTPS origin。実要求と一致が必要 |
| チャット | `LOCAL_DEMO="true"`、`AI_MODE=local-demo` | `LOCAL_DEMO="false"`、`AI_MODE=off`。許可モデルは省略、AI binding・provider Secretなし |
| Jev | `JEV_MODE=off` | 同じくoff。`JEV_MODEL`と`TYPESAFE_API_KEY`は不要。AI選択とは独立 |
| 任意拡張 | RAG/agent/Workflows/画像/決済すべてOFF | 同じく5種OFF。AI_MODEはこれらを止める一括スイッチではない |
| D1・公開経路 | ローカルDB、現行の全migration（0001〜0012・0014・0015。0013は管理外の欠番） | 各環境専用DB。公開例はダミーDB、routeなし、workers.dev/preview URL無効 |

ローカルの架空登録成功はAccess認証の成功ではありません。AccessモードはBetter Auth cookieや認証APIを受け付けません。所有者IDは認証方式別で、メール一致による自動統合やローカルsessionの移送をしません。

### 公開例とbuild対象

| 対象 | 公開JSONC断片・適用先 | 別承認後に使うbuildの固定対応 |
| --- | --- | --- |
| 通常staging | [internal-staging](../../examples/presets/internal-staging.jsonc)、新しい`env.staging`。`STAGING_POLICY=standard` | `standard-staging-local`、`CLOUDFLARE_ENV=staging`、新しい管理外standard-staging設定 |
| production | [internal-production](../../examples/presets/internal-production.jsonc)、新しい`env.production`。`STAGING_POLICY`は省略 | `production-local`、`CLOUDFLARE_ENV=production`、新しい管理外production設定 |

両例とも単独deploy用ではありません。公開wranglerの共通部分を基礎に、vars/bindingを対象節へ明示する方針です。`env`を断片で浅く上書きしたり、環境間でbindingが自動継承されると考えたりしません。実値を含む完成設定は今回作成・閲覧・複製・変更しません。[公開プリセットとbuild境界](../公開プリセットとbuild境界.md)と[保存・共有の境界](../リポジトリ-公開情報と履歴管理.md#用途別設定の保存と共有2026-10-02)が正本です。

必要ファイル不在、mode/環境の省略・不一致、解決後の環境節/APP_ENV/ポリシー不一致ではbuildが停止します。公開例への代替はありません。`-local`は設定の保管場所を示し、APP_ENV=localではありません。previewはflatten済み成果物を使うので、preview時の環境指定で切り替えず、別対象は再buildが必要です。

旧`staging-local`と公開wranglerのstagingは、固定FP8・30分・総3回・単一所有者・失敗消費の検証専用経路です。閉鎖と消費台帳を保持し、検証フラグfalse、台帳削除・更新、開始日時変更で通常へ転換しません。通常stagingは0006のtableあり/行なしが必要で、未適用・行あり・照会失敗なら生成/拡張を拒否します。旧DB・台帳を新DBへコピーしません。

## 未設定項目

| 項目 | 必要な確認・管理場所 |
| --- | --- |
| Access | `ACCESS_TEAM_DOMAIN`と`ACCESS_AUD`は公開例では空。実設定は本人がZero Trust → Access → Applicationsで管理。実ID/AUD/個別URLを文書・Gitへ記録しない |
| 利用者・保護範囲・session | `/app`と保護APIの範囲、公開トップ/ヘルプ、有効なwebhookの扱いを決める。新環境の1時間sessionは既存計画の推奨案で未確定。既存の本人限定検証環境から無断コピーしない |
| Worker・DB・origin | 新しい通常stagingとproductionそれぞれの専用リソース・HTTPS origin・現行の全migration（0001〜0012・0014・0015。0013は管理外の欠番）の適用計画。作成・remote migrationは別承認 |
| チャットprovider | 初期OFF。必要時だけ`AI_MODE=selected`、非空の`AI_ALLOWED_MODELS`、選んだproviderのSecretまたはAI bindingを準備。資格情報だけではONにならない |
| Jev remote | 選ぶ場合だけ固定`jev-1.13.0`・専用Secret・実契約と運用条件を確認。チャットと別に承認。既定OFFで起動できる |
| 費用・終了方法 | 人数、総予算、回数、期間、共有利用、外部接続ごとの停止操作を未確定として残す。過去の検証予算を流用しない |

Better Auth用Secret、Google、アプリの認証メール設定はAccessだけの利用に要求しません。ただしAccessのIdP・OTP通知は別の実接続です。アプリメール不要をOTP送信の許可や未送信保証に読み替えません。[認証](../auth.md#cloudflare-accessを選ぶ場合)を参照してください。

## 次の操作

1. まず[local手順](local.md#次の操作)の架空登録・固定応答・履歴・logoutで共通アプリを確認します。今回のC-1では起動・migration・実設定検査を追加していません。
2. 配備候補の環境、Access方式、公開例、未設定項目を上表で整理します。実値を収集せず、役割名・設定キー・管理画面の辿り方だけを記録します。
3. [モデル接続](../providers.md#導入手順)と[認証](../auth.md)の必須条件を読みます。AI/Jev/拡張はOFFのままで準備できます。ON/OFFの変更、実Secret投入、Access作成・OTP・build/配備はこの入口を読んだだけでは実行しません。
4. 最新ソースの導入手順・fake認証・別名空DBの検証は[工程D](../用途別プリセット-開発計画.md#別名クリーン複製の手順と証拠)として別許可後に行います。元プロジェクトの実設定・ローカルDB・復旧領域を複製しません。
5. 実配備へ進む場合は、[複製先の実配備で確認した注意点](../operations.md#複製先の実配備で確認した注意点)の順序（全OFF配備 → Access保護 → 専用ホスト）と停止3操作を先に確認します。
6. [工程E前の停止条件](../operations.md#工程e前の停止条件)を未解消として残し、必要な実Accessと1provider等の対象・費用・終了操作を具体化するところで止まります。工程E/Fやproduction公開は別の明示承認が必要です。

## ローカル・fake・実接続の確認範囲

| 範囲 | 確認済み・未確認 |
| --- | --- |
| 共通local | B-4の最終checkとdev/preview HTTP smokeで確認済み。Accessへの接続試験ではない |
| Accessのfake境界 | 実workerd/D1、合成RSA署名・JOSE検証、fake JWKSで両方式の分離・所有権・設定不備/台帳拒否時の回復を検証済み |
| 公開例/build | B-4の30境界テストと7合成build/HTTP試験で確認。認証未設定でもbuild/health起動可能であり、Accessログインや実アプリ利用の成功ではない |
| 最新文書・複製・画面 | C-1は文書検査だけ。今回の導入文書による工程Dの複製/操作は未実施 |
| 新環境の実接続 | スターター自身の通常staging/productionは未作成。旧本人限定stagingの過去の成功を流用しない |
| 複製先の実配備 | 2026-10-06〜08に最初の複製先（非公開の資料検索チャット）が本人1名・Access保護の通常stagingで実配備し、Workers AI 1モデルとRAGで受入まで完了。踏んだ注意点は[運用手順](../operations.md#複製先の実配備で確認した注意点)、確認項目は[公開前チェック](../launch-checklist.md)。スターター版のAccess・provider接続の成功証拠ではない |

検証版は[B-4記録](../B4完了-次セッション開始プロンプト.md)、文書の終了点は[C-1引き継ぎ](../C1完了-次セッション開始プロンプト.md)を参照してください。

Jevは本文/結果/hash非保存、終端90日、結果再表示なし、unknownの消費/同時枠保持、自動再送/削除/解放なしを維持します。本人metadata GETは要求状態を更新せず、backup復元後は照合完了までOFF・受付停止です。[契約](../Jev-B3J-実装前契約.md)は認可をJevへ委譲する根拠になりません。回数枠は硬い請求額上限ではなく、abortで上流停止や未課金を保証しません。

M-0の参照7日/生成30日/所有者1 GiB・初版除外と[採用済み構成/追加数値/ジョブ保持](../fal-メディア-M0差分設計.md#b-2時点の採用確認と検証待ち)を保持します。M-1〜M-4の実装と[M-5の当該版検証](../M5-メディア統合と隔離複製検証.md)はローカル/fakeの範囲です。falの保持/ACL/Store-IO/実価格/権限/品質は未検証、Directorは対象外です。

[READMEの3入口へ戻る](../../README.md#用途を選んで始める) / [公開サービス向け](public.md)
