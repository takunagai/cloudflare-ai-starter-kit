# 認証の導入と検証

導入先は[local](presets/local.md)・[個人/社内](presets/internal.md)・[公開サービス](presets/public.md)から選ぶ。開発開始はlocalのBetter Auth、配備先の認証はinternal=Access、public=Better Auth。必要項目は[公開5例/build境界](公開プリセットとbuild境界.md)に沿って整理する。非localの認証が未設定でもbuildと公開healthは起動し得るが、認証や実アプリ利用の成功を示さない。実接続の操作は[実接続前の停止条件](operations.md#実接続前の停止条件)の確定と別承認が先。

標準は Better Auth のメール＋パスワード認証です。Google は追加設定した場合だけ有効になります。社内・個人用では `AUTH_MODE=access` に切り替えられます。いずれもアプリの会話・資料・ジョブ・契約の所有権チェックを省略しません。AI OFF・設定不備・旧台帳による生成拒否でも、認証・session・logout・所有者の会話CRUDは継続します。拡張の入口の判定は[実行時方針](runtime-policy.md)に従います。

## ローカルの標準起動

`APP_ENV=local` かつ `APP_ORIGIN` が localhost / 127.0.0.1 / ::1 の完全な origin の場合だけ、公開された開発用ダミーsecretとメール確認省略を許可します。実Secret・実Google設定・実メール送信は不要です。パスワードは12〜128文字で、D1にハッシュとして保存されます。

1. READMEの固定Node/pnpm環境と依存を用意します。
2. ローカルD1にmigrationを適用します。`pnpm db:migrate:local`を使います。`--remote`は付けません。
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

本番または通常stagingへの導入は、対象・送信先/回数・費用・終了方法を別承認した後に次の順で行います。現在、アプリの実メール設定・実送信は未実施です。

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

`AUTH_MODE=access`、`ACCESS_TEAM_DOMAIN=自分のteam.cloudflareaccess.com`、`ACCESS_AUD=対象AccessアプリのAUD` を設定します。team domainにURL scheme・pathは入れません。Accessの実ID/AUD/個別URLは本人管理とし、公開例では空欄です。Access app/policyの作成や変更はアプリからは自動実行しません。Accessの通知/OTPはアプリメールとは別の経路で、追加送信を自動で行いません。

アプリは `cf-access-jwt-assertion` をJOSEで検証します。RS256署名、固定teamのissuer、対象appのaudience、有効期限、発行時刻、not-before、subject、email、アプリ用tokenであることを確認します。公開鍵は設定したteamの `/cdn-cgi/access/certs` から取得し、期限付きでcacheします。メールを名乗るヘッダーだけでは認証しません。JWT検証不能・鍵取得失敗時も拒否します。

IDは `access:example-team1.cloudflareaccess.com:subject`、Better Authは `better-auth:userId` に分けます。同じメールアドレスを理由に自動的に同一ユーザーへ統合しません。認証方式やAccess teamの変更時は所有権移行（利用者ID、会話・資料・ジョブ・契約の所有権、全session失効、復旧）を明示的に設計してください。AccessモードではBetter Authのcookieや認証APIを受け付けません。

Accessの保護範囲は用途で決めます。公開トップ/ヘルプやPolar webhookを持つ構成では、`/app` と保護対象APIに絞り、それらを対話ログインで遮断しないようにします。webhookは独立した署名検証で保護します。本人専用で公開ページを持たない環境は、Worker全体を保護してbypassを置かない構成にできます。TanStack Startでは `ctx.access` 伝播に制約があるため、アプリは未検証のcontext情報に依存しません。Access logoutの導線はAccessの `/cdn-cgi/access/logout` を使い、アプリに残った利用者stateも消去します。

### 推奨する設定

本人1名だけの個人・社内向けstagingで採用した方針です（2026-09-28〜29に確認した旧stagingの設定。そのWorker・Accessアプリは2026-10-19に削除済みで、新環境の設定は新たに確定します）。実メール・AUD・ホスト名・個別URLは記録しません。

| 項目 | 方針 | 影響・理由 |
| --- | --- | --- |
| 保護対象 | 専用Worker全体（公開ページを持たない場合） | 全URL・API・静的ファイルでログイン必須 |
| bypass | なし | トップ、ヘルプ、healthも保護される |
| 許可条件 | 本人1名のメール完全一致、Allow | ドメイン全体やアカウントメンバー全員を許可しない |
| セッション期間 | 1時間（推奨案） | 発行したセッションの期限で、無操作時間ではない。Better Authの7日/更新間隔1日とは別の設定 |
| 認証方法 | ワンタイムPIN（OTP） | ログインのたびにメール送信を伴う |
| IdPの固定 | なし（有効なIdPを利用） | IdPを追加したら影響を再確認する |
| アプリ側の検証 | Access JWTの署名・issuer・audience | 外側のAccess保護だけに依存しない |
| 公開入口 | Custom Domainのみ | `workers_dev=false`・`preview_urls=false`、通常routeなし |
| データ | 専用のD1 | ローカル・productionから分離 |

### 変更時の注意

- 管理場所は、Cloudflare Dashboard → Workers & Pages → 対象Worker → Access（保護範囲）と、Zero Trust → Access → Applications（対象アプリ、セッション期間、ポリシー）。実メールは本人が管理画面で照合する。
- 許可ポリシーは再利用できる。複数のアプリで共有している場合、条件の編集は関連アプリすべてへ影響する。
- ログイン画面の組織表示名は組織内のAccessアプリで共通。表示名を変える目的で認証用のteam domainを変更しない。
- Accessアプリを再作成するとAUDが変わる。手元の設定を更新し、再build・dry-run・配備後に、未認証の遮断と本人ログインを確認する。生成済みの設定へ`--env`を重ねない。
- 新しい公開入口は、専用WorkerのAccess保護を確認してから追加する（[運用手順](operations.md)）。

### OTPが届かない場合

1. 許可ポリシーの本人メールと入力文字列・受信先を本人が照合します。
2. 迷惑メール・隔離・受信拒否設定を確認します。OTP、メール本文、Cookieを会話やリポジトリへ貼りません。
3. 再送を連打せず、最新コードを一度だけ送信します。使用済みと出た場合は、同じブラウザでアプリを開き、既にログインできていないか確認します。
4. 解決しなければ[Cloudflareのメール未着手順](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/not-receiving-cloudflare-emails/)を確認します。配送状態を確認せず送信抑止と断定しません。

送信済み表示だけでは配送成功を証明できません。[公式OTP手順](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)を参照してください。

## データとmigration

`src/server/db/auth-schema.ts` と `migrations/0001_auth.sql` を対応させています。物理テーブルは `auth_user`、`auth_session`、`auth_account`、`auth_verification`、`auth_rate_limit`。session/accountの外部キーはuser削除に追従し、token・email・provider/account・rate-limit keyには一意制約があります。

Drizzle adapterではD1が対応しないinteractive transactionを無効化しています。migrationはSQLファイルとしてレビュー・適用し、認証リクエスト中に自動でschema変更しません。Drizzle側のschema型検査だけでは実DBの適用漏れを証明できないため、必ず実D1でテストします。session/token/passwordのテーブル内容を通常ログへdumpしないでください。

ログイン制限はD1に保存し、Workerのプロセスメモリに依存しません。アプリのAI利用上限や課金台帳とは別物です。`auth.api` の直接呼出しはBetter AuthのHTTP rate limit対象外なので、ログインを独自server functionから呼ばずHTTP handlerへ通します。trusted origin/CSRFチェックは無効化しません。

## 検証範囲

`tests/auth.test.ts` はworkerd＋D1で登録・ログイン・ログアウト・失効・cookie属性・Origin拒否・永続rate limit・認証方式分離・メール確認・一度だけのパスワード再設定を検証します。`tests/auth-access.test.ts` は実RSA署名とJOSE検証を使い、署名/issuer/audience/期限/不正claims/鍵/方式を検証します。Access JWKS取得とメール配送だけをfake化します。`tests/auth-email.test.ts` は送信adapterをfake bindingで検証します。

アプリの実メール配送、Google認証、通常staging/productionのCloudflare Accessの実疎通は、リポジトリ側では未確認です（複製先では個人・社内向けのAccess保護を実配備で確認済み。実績は複製先の文書で管理する）。ローカル/fakeのテスト合格を実疎通成功と読み替えないでください。

一次資料: [Better Auth Email & Password](https://better-auth.com/docs/authentication/email-password)、[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)、[Security](https://better-auth.com/docs/reference/security)、[Rate Limit](https://better-auth.com/docs/concepts/rate-limit)、[Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。確認日: 2026-09-27。
