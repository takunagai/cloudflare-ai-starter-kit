# Polar決済の任意拡張

更新日: 2026-10-02。Polar SDK 0.49.0、standardwebhooks 1.1.1を使用します。標準構成は `ENABLE_BILLING` がOFFで、Polarアカウント・キー・商品設定を要求しません。実決済・sandbox checkout・実webhook配達は未接続です。

B-3で通常環境の設定・旧台帳guardをHTTPと直接SDK adapterへ統合しました。OFF/`STAGING_POLICY=standard`を指定しないstagingは404、通常の対話APIは認証・method/入力・所有権を先に確認し、実行/関連更新直前にもguardを再確認します。AI_MODEやJev設定の不備だけでは決済を停止しません。通常stagingの台帳不適合は503で、認証や履歴の回復導線は維持します。[設定メモと検証範囲](実AI検証制御-実装状況.md#2026-10-02-b-3のモデル選択と別入口統合)を参照してください。

このサンプルは固定した1つの継続課金商品を購入し、署名付き顧客状態から契約状態を保存して、Customer Portalで契約を管理する構成です。税・割引・従量課金・席数等を独自に実装するものではありません。チャット料金に直接連動した課金台帳は含めません。

## 有効化

1. 本番から分離された [Polar sandbox](https://sandbox.polar.sh) でorganizationと継続課金商品を用意します。本番tokenはsandboxで共用できません。
2. 対象環境に `ENABLE_BILLING=true`、`POLAR_SERVER=sandbox`、`POLAR_PRODUCT_ID` を設定します。SDKのデフォルト本番接続を使わず、この実装では未指定もsandboxです。本番へ接続するには `POLAR_SERVER=production` を明示し、別の承認・Secrets・DBを使います。
3. 必要な `checkouts:write` と `customer_sessions:write` 権限を持つ `POLAR_ACCESS_TOKEN` を人間が会話外で投入します。対象のSecrets手順に従い、値を引数・Git・ログ・チャットに載せません。
4. 対象D1へ `0004_billing.sql` と `0005_billing_repurchase.sql` を含むmigrationを適用します。既存DBへも追加列を適用でき、保存済みデータを消しません。local/staging/productionを取り違えないよう [運用手順](operations.md) に従います。
5. 公開可能なHTTPSの `/api/billing/webhook` をPolar webhook宛先として登録し、`customer.state_changed`、`checkout.created`、`checkout.updated`、`checkout.expired` を購読します。`POLAR_WEBHOOK_SECRET` は対象環境へ人間が投入します。
6. Accessや対話ログインでwebhookを遮断しない設定にします。webhookではログインを省く代わりに、raw body・署名・署名時刻を必ず検証します。
7. 承認済みの公開範囲とテスト用顧客でsandbox購入→webhook→状態表示→Portal→契約変更を確認します。ローカルfakeテストを実配達成功と読み替えないでください。

## HTTP契約

| パス | 動作 |
| --- | --- |
| GET `/api/billing/status` | 認証した本人の `{subscription: {...} \| null}`。status、id、periodEnd（epoch ms）、cancelAtPeriodEndを返す |
| GET `/api/billing/member` | 本人・対象環境・対象商品の署名済み契約がactive/trialingかつ期限内の場合のみ、固定会員サンプル `{message}`。それ以外は403 `subscription_required` |
| POST `/api/billing/checkout` | 空JSON `{}` だけを受理し `{url}`。所有者・商品・戻り先はサーバーが固定 |
| POST `/api/billing/portal` | 空JSON `{}` だけを受理し `{url}`。署名webhookで対応付け済みの本人だけ |
| POST `/api/billing/webhook` | 対話認証・Originを要求せず署名を検証し、D1保存成功後だけ2xx |

checkoutとportalは同一Originの認証済み要求だけです。`external_customer_id` とmetadataのownerは検証済み `Identity.id`、商品は `POLAR_PRODUCT_ID`、成功/戻り先は `APP_ORIGIN/app` に固定します。クライアント指定のcustomer/product/URLは受け付けません。返すURLも選択環境のHTTPS Polar hostに限定します。Checkout URL/Portal URLにはアクセス権限が含まれることがあるため、ログへ記録しません。

## 重複・失敗・復旧

checkout前にD1で `(owner, server, product)` の一意な予約を作ります。並行要求は既存URLを返すか409になり、upstream作成を重複実行しません。SDK自動retryは無効、timeoutは8秒です。上流の冪等性保証を確認できないため、timeoutや保存失敗後に新しいcheckoutを無条件作成しません。

`checkout_pending_reconciliation`（409/502）は上流で作成された可能性を示します。`checkout.created/updated` webhookの署名・owner・operation IDが一致すれば既存予約を復旧し、次の要求で同じURLを返します。失敗・期限切れが署名webhookで確認できた場合だけ再作成できます。ローカル時計で期限を過ぎたという理由だけでは新しい購入を開始しません。

webhookが届かない場合は、Polarの配達履歴と対応するoperation metadataを会話外の管理画面で確認して再送してください。上流作成が無いことを確認できた場合だけ、管理者が対象予約の状態を修復します。確認できないまま予約行を削除する復旧手順は使いません。継続中の契約はPortalで管理します。

完全解約後は、最新の署名済み `customer.state_changed` が対象商品を `inactive` と示し、その通知時刻が署名済みcheckout完了時刻以降の場合に再契約できます。期間末解約の予約中、古いinactive通知、署名確認前、矛盾する状態では新規checkoutを許可しません。再契約も同じD1予約を原子的に更新し、同時操作では1件だけ作成します。operation IDを更新するため、以前のcheckout通知が遅れて届いても新しい申込みを上書きしません。0005より前に完了した予約は完了時刻を確認できないため自動解放せず、管理者が署名付き配達履歴を確認して修復します。

契約権限の根拠は `customer.state_changed` の署名済みsnapshotだけです。checkoutの成功画面やURLパラメーターからactiveへ変更しません。対象商品だけを評価し、active/trialingでもperiodEndを過ぎればexpiredです。同じメールアドレスを理由にユーザーを統合せず、認証済み予約が作ったownerとPolar customerを対応付けます。同じorganizationの無関係な顧客は権限を作らず受領します。

event IDと本文hashの一意記録、customer対応付け、契約状態更新をD1 batchで処理します。保存失敗は2xxにせず、再送でやり直せます。同時重複を一度にまとめ、古いsnapshotは新しい状態を巻き戻しません。同時刻に矛盾するsnapshotが来た場合は `ambiguous` として権限を与えず、次の新しい署名イベントまたは配達履歴の確認で復旧します。

webhookはmethod・本文・署名・入力schemaの確認後、既処理イベントの2xx応答前と関連更新直前にも設定・旧台帳を検査します。不適合時は未受領のまま503とし、配達済みと誤認させません。正しい別Worker/別DB構成で同じイベントが再送されれば、既存の重複防止契約で処理できます。旧検証台帳の削除/上書きを復旧方法にしません。checkout予約後にguardが拒否し、upstreamへ未送信と確定している場合だけ予約をexpiredへ閉じます。送信後に結果不明ならuncertainを保持し、自動再作成しません。

署名はStandard Webhooksと旧Polar HMACの両方を検証します。2026-09-08より前後でsecretの署名方式が異なるためです。SDK 0.49.0の `validateEvent` は旧方式に固定されているため、署名検証には公式のstandardwebhooksを直接使い、消費するevent項目をZodで検証しています。raw body、secret、SDKエラー、顧客メールをログへ出しません。

## 検証と制約

`tests/billing.test.ts` はworkerd＋D1でOFF・認証・入力/Origin・owner/product固定・二重checkout・timeout後retry抑止・署名復旧・Portal・新旧署名・改ざん・期限切れ・同時重複・順序逆転・同時刻矛盾・他ユーザー分離・保存失敗rollbackを検証します。再契約は古いinactive通知での拒否、完了時刻以降のinactive通知での受付、同時再受付の抑止、古いoperation通知による上書き防止も検証します。`tests/billing-sdk.test.ts` はインストール済みSDKを使い、fetchだけをfake化して接続先・送信フィールド・自動retryなしを確認します。

B-3の`tests/extension-boundary.test.ts`は直接SDK呼出し、予約後/保存前の再確認、署名/schema不正優先、台帳不適合時の既処理イベント拒否と同じevent IDの再送を実workerd/D1とfake外部境界で検証します。342テストを含むcheckと最終buildのHTTP smokeは成功しています。Polarの実配達・課金やクラウド設定の証拠ではありません。

会員サンプルAPIはstatus表示と同じ所有者・環境・商品条件でD1を読み、サーバー側で契約状態と有効期限を検証します。署名済みactive/trialing、expired、inactive、別ユーザー・別商品・別環境をテストします。Checkout作成やブラウザーのURLパラメーターはアクセス権を与えません。標準チャットには課金制限を追加せず、固定サンプルで業務APIに適用する認可パターンを示します。

外部境界のfakeが成功しても、Polarのorganization権限、商品設定、sandboxの実checkout、Cloudflare配達経路は未確認です。実環境検証でチェックし、版更新時は署名方式とSDK APIを再確認してください。課金権限を業務機能に適用する場合は、業務APIでこの所有者の契約状態を検査します。UIの表示だけを課金ゲートにしないでください。

一次資料: [Sandbox](https://polar.sh/docs/integrate/sandbox)、[Checkout作成](https://polar.sh/docs/api-reference/checkouts/create-session)、[Webhook配達と署名](https://polar.sh/docs/integrate/webhooks/delivery)、[Customer State](https://polar.sh/docs/integrate/customer-state)。
