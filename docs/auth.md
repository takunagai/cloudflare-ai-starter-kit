# 認証の導入と検証

2026-10-02・C-1: 導入は[local](presets/local.md)・[個人/社内](presets/internal.md)・[公開サービス](presets/public.md)から選びます。全用途の開発開始はlocal Better Auth、配備先の認証はinternal=Access、public=Better Authです。[公開5例/build境界](公開プリセットとbuild境界.md)に沿って必要項目を整理した文書更新で、実設定・許可対象・session期間は変更していません。非localの認証が未設定でもbuild/公開healthは起動し得ますが、認証や実アプリ利用の成功を示しません。実操作は[工程E前の停止条件](operations.md#工程e前の停止条件)の確定と別承認後です。

標準は Better Auth のメール＋パスワード認証です。Google は追加設定した場合だけ有効になります。社内・個人用では `AUTH_MODE=access` に切り替えられます。いずれもアプリの会話・資料・ジョブ・契約の所有権チェックを省略しません。

2026-10-02・B-3: 通常stagingの拡張一括404を各入口へ置き換え、OFFは認証前404、ONは認証・入力/所有権/状態の後に設定/台帳を検査します。決済webhookはsessionを要求せず署名を先に確認します。B-2で検証した両認証方式と回復境界を維持し、AI OFF・設定不備・旧台帳による生成拒否でも認証/session/logout/所有者の会話CRUDは継続します。認証方式・session期間・実Access設定は変更していません。[設定メモ](実AI検証制御-実装状況.md#2026-10-02-b-3のモデル選択と別入口統合)。

## ローカルの標準起動

`APP_ENV=local` かつ `APP_ORIGIN` が localhost / 127.0.0.1 / ::1 の完全な origin の場合だけ、公開された開発用ダミーsecretとメール確認省略を許可します。実Secret・実Google設定・実メール送信は不要です。パスワードは12〜128文字で、D1にハッシュとして保存されます。

1. READMEの固定Node/pnpm環境と依存を用意します。
2. ローカルD1にmigrationを適用します。プロジェクトのDB適用コマンドまたは `pnpm exec wrangler d1 migrations apply DB --local` を使います。`--remote` を付けないでください。
3. `pnpm dev` を起動し、ログイン画面でテスト用ユーザーを登録します。
4. ログアウト、再ログイン、再読み込み後の履歴を確認します。`pnpm preview` の4173番も開発用の許可originに含みます。

この省略はローカル試作用です。Better Authを使うstaging / productionはHTTPS、32文字以上の本物のsecret、メール送信設定を必須とし、未設定なら認証処理を503で停止します。Accessだけの用途にBetter Auth用Secretやアプリメールを要求しません。ダミーsecretを本番へ転用できません。非localのBetter Authではメール未確認ユーザーのセッションを認可に使いません。localから実運用へDB・session・secretを流用しないでください。

メール未設定のlocalでは確認メールの再送・パスワード再設定要求は503を返します。確認リンク・リセットtokenをAPIのデバッグ応答やログへ出す代替経路はありません。ローカルの回復フローはテストのfakeメール送信境界で検証します。

## 本番のメール認証

`BETTER_AUTH_SECRET` は人間が会話外で対象環境のSecretsへ投入します。詳しくは [Secrets運用](../rules/secrets.md) に従い、値をコマンド引数・Git・チャットへ載せないでください。`APP_ORIGIN` は実サービスのHTTPS originに固定します。

認証の入口は `/api/auth/*`、利用者識別は `getIdentity()` です。メール認証の流れは次のとおりです。

- 登録 → 確認メール → 確認リンク → ログイン。メール未確認ではログインできません。
- ログイン → HttpOnly / SameSite=Lax / Secure cookieとD1セッション。
- パスワード再設定要求 → メール中のURL → `/app` の再設定フォーム → 一度だけ使えるtokenで更新。更新時に既存sessionを失効します。
- ログアウト → D1 session削除。同じ古いcookieでの再アクセスを拒否します。

`src/server/auth/email.ts` の `AuthMailer` が送信境界です。テストはここだけをfake化し、Better Auth・scrypt・D1は本物を使います。HTTP経路はBetter Authのbackground taskをWorkers `waitUntil`へ接続します。失敗ログは固定イベント名だけで、宛先・token・認証URL・外部SDK例外を記録しません。

**採用provider:** Cloudflare Email Service（Email Sending、Public Beta）。`EMAIL.send({from,to,subject,html,text})` のadapterを実装済みです。認証URLをHTML属性用にescapeし、送り先や外部SDK例外をログへ出しません。

本番または通常stagingへの導入は、対象・送信先/回数・費用・終了方法を別承認した後に次の順で行います。C-1の文書整備を設定変更の許可にせず、[工程E前](operations.md#工程e前の停止条件)で止まれます。現在、アプリの実メール設定・実送信は未実施です。

1. 対象ドメインをCloudflare DNSで管理し、Cloudflare Dashboard → Compute → Email Service → Email Sendingから送信ドメインをonboardします。DNS変更を伴うので、対象と変更内容の承認後に行います。
2. 対象Wrangler環境に `send_email: [{ name: "EMAIL" }]` と非秘密設定 `EMAIL_FROM` を追加します。fromはonboard済みドメインの送信アドレスです。設定は必要な環境だけに追加します。
3. `BETTER_AUTH_SECRET` をSecrets手順に従って人間が投入し、承認済みの対象へ配備します。
4. テスト用アドレス1件で登録→受信→メール確認→ログイン→再設定→既存session失効を確認します。送信数・費用・送信先を事前に具体化し、tokenやメール本文を共有ログへ貼らないでください。

localでCloudflare送信adapterを呼びません。Wranglerのlocal emailシミュレーションは本文をログ出力するため、認証メールには使いません。`remote: true` をlocalへ設定して実送信する検証も通常テストには含めません。送信adapterのテストは `tests/auth-email.test.ts` のfake bindingで行います。

公式手順: [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)、[送信ドメイン導入](https://developers.cloudflare.com/email-service/get-started/send-emails/)、[ローカル送信の挙動](https://developers.cloudflare.com/email-service/local-development/sending/)。

## Googleを追加する場合

Google OAuthアプリを対象環境ごとに用意し、callbackを `https://対象origin/api/auth/callback/google` に設定します。`GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を両方設定した場合だけ有効です。一方だけの設定は誤構成として認証を停止します。値の投入はSecrets手順に従います。標準のlocal起動はGoogleに依存しません。

Googleの本物のアプリ・資格情報・callback疎通は通常CIでは検証しません。認証フローを実公開する前に対象環境で別途確認します。

## Cloudflare Accessを選ぶ場合

新しい通常staging/productionの利用者・保護範囲・session期間は未確定です。新環境の1時間は既存計画の推奨案、Better Authの7日/更新間隔1日は現行実装の値で、今回変更・適用していません。Accessの実ID/AUD/個別URLは本人管理とし、公開例では空欄です。Accessの通知/OTPはアプリメールとは別の実接続で、追加送信を自動で行いません。

`AUTH_MODE=access`、`ACCESS_TEAM_DOMAIN=自分のteam.cloudflareaccess.com`、`ACCESS_AUD=対象AccessアプリのAUD` を設定します。team domainにURL scheme・pathは入れません。Access app/policyの作成や変更はここでは自動実行しません。

アプリは `cf-access-jwt-assertion` をJOSEで検証します。RS256署名、固定teamのissuer、対象appのaudience、有効期限、発行時刻、not-before、subject、email、アプリ用tokenであることを確認します。公開鍵は設定したteamの `/cdn-cgi/access/certs` から取得し、期限付きでcacheします。メールを名乗るヘッダーだけでは認証しません。JWT検証不能・鍵取得失敗時も拒否します。

IDは `access:example-team1.cloudflareaccess.com:subject`、Better Authは `better-auth:userId` に分けます。同じメールアドレスを理由に自動的に同一ユーザーへ統合しません。認証方式やAccess teamの変更時は所有権移行を明示的に設計してください。AccessモードではBetter Authのcookieや認証APIを受け付けません。

Accessの保護範囲は `/app` と保護対象APIに絞り、公開トップ/ヘルプ、Polar webhookを対話ログインで遮断しないように設定します。webhookは独立した署名検証で保護します。TanStack Startでは `ctx.access` 伝播に制約があるため、アプリは未検証のcontext情報に依存しません。Access logoutの導線はAccessの `/cdn-cgi/access/logout` を使い、アプリに残った利用者stateも消去します。

## データとmigration

`src/server/db/auth-schema.ts` と `migrations/0001_auth.sql` を対応させています。物理テーブルは `auth_user`、`auth_session`、`auth_account`、`auth_verification`、`auth_rate_limit`。session/accountの外部キーはuser削除に追従し、token・email・provider/account・rate-limit keyには一意制約があります。

Drizzle adapterではD1が対応しないinteractive transactionを無効化しています。migrationはSQLファイルとしてレビュー・適用し、認証リクエスト中に自動でschema変更しません。Drizzle側のschema型検査だけでは実DBの適用漏れを証明できないため、必ず実D1でテストします。session/token/passwordのテーブル内容を通常ログへdumpしないでください。

ログイン制限はD1に保存し、Workerのプロセスメモリに依存しません。アプリのAI利用上限や課金台帳とは別物です。`auth.api` の直接呼出しはBetter AuthのHTTP rate limit対象外なので、ログインを独自server functionから呼ばずHTTP handlerへ通します。trusted origin/CSRFチェックは無効化しません。

## 検証範囲

`tests/auth.test.ts` はworkerd＋D1で登録・ログイン・ログアウト・失効・cookie属性・Origin拒否・永続rate limit・認証方式分離・メール確認・一度だけのパスワード再設定を検証します。`tests/auth-access.test.ts` は実RSA署名とJOSE検証を使い、署名/issuer/audience/期限/不正claims/鍵/方式を検証します。Access JWKS取得とメール配送だけをfake化します。

アプリの実メール配送、Google認証、新しい通常staging/productionのCloudflare Accessは未接続です。旧本人限定検証stagingでは過去のAccessログイン確認を実施済みですが、新環境の実Access/JWKS/OTP・公開サービスのメール確認には流用しません。ローカル/fakeのテスト合格を実疎通成功と読み替えないでください。[B-4までの証拠](B4完了-次セッション開始プロンプト.md)と[C-1文書検証](C1完了-次セッション開始プロンプト.md)を区別します。

一次資料: [Better Auth Email & Password](https://better-auth.com/docs/authentication/email-password)、[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)、[Security](https://better-auth.com/docs/reference/security)、[Rate Limit](https://better-auth.com/docs/concepts/rate-limit)、[Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。確認日: 2026-09-27。
