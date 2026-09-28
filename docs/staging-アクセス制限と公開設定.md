> 公開用の履歴整理により、実環境の識別子・個別URL・個人のパスはダミーへ置換しています。記載されたダミーは接続先・照合値として使えません。

# stagingのアクセス制限と公開設定

設定確認日: **2026-09-28（JST）**。同日の実配備時にCloudflare API・Dashboard・未認証HTTPで確認した内容をまとめた参照用メモです。以後に設定を変えた場合は、このファイルも更新してください。操作の時系列と失敗の詳細は[staging作業ログ](staging-work-log.md)に残しています。

## 最初に押さえること

**このstagingは本人専用です。全URLでCloudflare Accessのログインを必須とし、Accessアプリのセッション期間は1時間です。** トップページやヘルプ、health API、静的ファイルにもAccessがかかります。

許可条件は本人のメールアドレスとの**完全一致1件**です。メールドメイン全体やCloudflareアカウントの全メンバーを許可する設定ではありません。実メールアドレスはこのメモへ転記せず、管理画面のポリシーで確認します。

## 設定一覧

| 項目 | 設定内容 | 意図・影響 |
| --- | --- | --- |
| Cloudflareアカウント | `staging.example.invalid` | このアカウントの専用stagingリソースを使用 |
| URL | `https://staging.example.invalid` | 専用WorkerのCustom Domain |
| Worker | `cloudflare-ai-starter-kit-staging` | 他のWorkerから分離 |
| Accessの対象 | このWorker全体（`destination.type=worker`） | 全パス・API・静的ファイルを保護。アカウント全体の保護設定は変更していない |
| パスの例外・bypass | なし | `/help`や`/api/health`もログインが必要 |
| 許可対象 | 本人のメール完全一致1件、`allow` | 他のメールアドレスは許可対象外 |
| セッション期間 | `1h`（1時間） | Accessアプリが発行するトークンの有効期間。1時間無操作でログアウトする設定、とは記録しない |
| ログイン画面の組織表示名 | `staging.example.invalid - Cloudflare Access` | 2026-09-28に旧プロジェクト名から変更。全AccessアプリとApp Launcher共通の表示 |
| 認証方法 | 確認時点のIdPはワンタイムPIN（OTP）のみ | ログイン操作はメール送信を伴う |
| IdPの指定 | `allowed_idps=[]` | 特定IdPへの固定ではなく、アカウントで有効なIdPを利用。IdP追加時は影響を再確認 |
| アプリ内部の認証 | `AUTH_MODE=access`、JWTの署名・issuer・audienceを検証 | 外側のAccessに加え、アプリも利用者を検証 |
| workers.dev / preview URL | 両方無効 | 別の公開入口を作らない |
| DNS / 通常のWorker route | 対象DNSはプロキシ有効、通常routeは0件 | Custom Domainで接続 |
| AI・任意拡張・demo | 全OFF、AI binding・アプリSecretなし | 初回は配備と認証境界を検証するため |

## 本人限定ポリシーに関する注意

ポリシー名は **`cloudflare-ai-starter-kit-staging - Owner only`** です。当初は旧プロジェクトの再利用ポリシーを共有していましたが、2026-09-28の旧プロジェクト廃止時に名前を変更し、旧アプリを削除しました。現在の利用アプリはstagingの1件だけです。ポリシーIDと本人メール完全一致1件の条件は維持しています。

再利用可能なポリシーなので、今後ほかのアプリにも関連付けると、条件の編集は関連アプリすべてに影響します。変更前には利用アプリ数を確認してください。旧プロジェクトのクラウド削除・ローカル移動と制約は[廃止記録](旧プロジェクト-廃止記録.md)にまとめています。

## 確認・変更する場所

- [専用Workerの管理画面](https://dash.cloudflare.com/) → **Access**：保護範囲、許可ポリシー、セッション期間。
- [専用Accessアプリの管理画面](https://dash.cloudflare.com/)：Accessアプリの詳細。画面内で共有ポリシーを編集する際は関連アプリも確認。
- [wrangler.jsonc](../wrangler.jsonc) の `env.staging`：Custom Domain、D1、origin、Access team domain/AUD、機能OFFフラグ。
- [ログインページの管理画面](https://dash.cloudflare.com/)：組織表示名。全Accessアプリに共通です。認証先のteam domainとは別設定なので、表示名の変更のためにteam domainを変更しないでください。

DashboardのURL内の`production`は、名前に`-staging`が付いた専用Workerの配備スロットです。このリポジトリの`env.production`へ配備したことを意味しません。

| 識別子 | 値 |
| --- | --- |
| Worker ID | `00000000000000000000000000000000` |
| Accessアプリ名 | `cloudflare-ai-starter-kit-staging - Cloudflare Workers` |
| AccessアプリID | `00000000-0000-0000-0000-000000000000` |
| 再利用ポリシーID | `00000000-0000-0000-0000-000000000000` |
| Access team domain | `example-team1.cloudflareaccess.com` |

Access AUDは非Secret設定として`wrangler.jsonc`に記録しています。Accessアプリを作り直す場合は、実際のAUDとの一致を確認して再build・再配備します。配備順序は[運用手順](operations.md)を参照してください。

## 確認できたこと・まだ確認していないこと

2026-09-28の実クラウド確認では、ページ・API・静的CSSの6経路が未認証時に302で正しいAccessログインへ転送されました。偽のダミー認証ヘッダーでも転送され、無効化したworkers.devは404でした。

同日09:50頃までに本人がOTP受信とログイン成功を報告し、実際のブラウザで認証後UI・ログアウトボタン・空履歴・エラー表示なしを確認しました。専用D1の集計でもレート制限行1件・カウント2、会話0件を確認しました。認証後APIによるD1書込みは確認済みですが、APIのHTTPステータス/本文の直接検査はブラウザ制約で未実施です。

会話保存・復元・削除、実AI、アプリ自身の実メール・決済は未検証です。全モデルOFF時はUIから会話を保存できないため、最初の合意済み実AI検証時に確認します。エージェントによるOTP再送・実AI・Secret投入はしていません。ローカルの157テストとHTTP smoke成功は、実クラウドの未検証部分の代わりにはなりません。

## ログイン画面の古い名前とOTP未着時の確認

**現在の組織表示名は `staging.example.invalid - Cloudflare Access` です。** 以下の07:44の記述は変更前の経緯です。09時台の廃止作業後、API・保存済み編集画面・実際のstagingログイン画面で新しい名前と旧名の消失を確認し、stagingの未認証3経路が引き続き302でAccessへ転送されることを確認しました。その後、本人の再試行でOTP受信とログインが成功しました。名称変更を配送成功の原因とは扱いません。

2026-09-28 07:44 JSTにAPIを照合したところ、Zero Trust組織名は `retired-project-worker - Cloudflare Access` でした。ユーザーによると旧プロジェクト名で、現在はそのプロジェクトを使用していません。この組織の表示名がstagingのログイン画面にも出ます。今回の専用Accessアプリ名・Worker destination・本人限定ポリシーの関連付けは一致しており、古い表示名だけでは別Workerへの接続を意味しません。組織名と共有ポリシーは無断で改名・削除していません。

同時点で、有効なアカウントメンバーは本人1名、Allow条件はそのメールとの完全一致1件、Require/Excludeは0件、IdPはOTP1件と確認しました。ブラウザも期待するAccess teamホストとstaging hostnameを含む経路でした。その後、本人から初回は別のメールを入力していたが、修正後も未着との申告がありました。08:04 JST時点で、現在の画面の宛先が登録メールと完全一致すると本人が確認済みです。Web版iCloudでも未着との申告があり、配送状態は未確認です。

同日08:04〜08:06 JSTにAPIでAllowの本人完全一致とRequire/Exclude各0件を再確認し、そのメールに一致する既存Access identityも1件確認しました。ただし、追加のポリシー評価テストAPI呼び出しは認証エラー10000となり、評価結果は得られていません。設定の照合成功と、実際のログイン許可・メール配送成功は区別します。

09:39 JSTの再試行準備で、許可対象メールのサービスと、以前に受信確認していたサービスの食い違いを確認しました。上記の宛先一致は本人申告であり、エージェントがブラウザ入力値を読み取って照合した結果ではありません。登録メールの受信先を本人へ案内し直した後、本人からOTP受信とアプリ表示成功の報告を受けました。使用済みPINと表示された場合でも、最初の送信でログインできている可能性があるため、まず同じブラウザでアプリを開いて確認します。今回の二重クリックとエラーの因果関係は未確定です。

OTP未着時は次の順で切り分けます。

1. 入力メールが登録済みの本人メールと完全一致するか、手元で確認する。別名・転送先・`+`付きの別アドレスは同一とは扱わない。
2. 迷惑メール・ゴミ箱・隔離領域・受信拒否設定で `noreply@notify.cloudflare.com` を確認する。メール本文・OTPを会話やこの資料へ転記しない。
3. 設定と受信側に問題がなければ、過去の配送失敗によるCloudflare側の送信抑止をサポートで確認する。配送ログなしで抑止と断定しない。

[公式OTP手順](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)では、許可対象外にも送信済みと表示し、実メールは送らない仕様です。また、コード入力前の要求は認証ログに残らず、ログ0件は配送成功・失敗の証拠になりません。PINは10分有効で、再要求すると旧PINは無効になります。再送を連打せず、受信側と送信抑止を先に確認します。

受信先がiCloudの場合は、端末のメールアプリとの同期問題を分けるため、本人が [iCloudメールのWeb版](https://www.icloud.com/mail/) でも受信・迷惑メール・ゴミ箱を確認します。iCloudストレージ上限、メール振り分け/転送設定も必要に応じて確認します。`@icloud.com`・`@me.com`・`@mac.com`等が同じ受信箱へ届く場合でも、Accessには許可した文字列どおりのアドレスを入力します。連絡先への送信元登録は迷惑メール分類への対策であり、Cloudflare側の送信抑止や配送失敗を解消する保証ではありません。根拠: [Appleの未着時手順](https://support.apple.com/ja-jp/102562)、[iCloudの迷惑メール管理](https://support.apple.com/ja-jp/102376)。

### 今回の未着調査の結論

OTPの受信と本人ログインは成功し、配送調査の問い合わせは送信していません。以前用意した問い合わせ文は、受信先に関する前提が不正確で現在の状況にも合わないため取り下げました。Cloudflare側の送信抑止や受信サービス側の拒否は確認されていません。

再発時は入力先と受信先を本人が照合してから、[公式のメール未着手順](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/not-receiving-cloudflare-emails/)に沿って必要な場合だけ配送調査を依頼します。個別のメール本文、OTP、Cookie、トークン、認証URL全文をこのメモやチャットへ貼らないでください。

## 配備用Wrangler認可の状態

2026-09-28 07:27頃（JST）、過去のOAuth認可コード露出への対応として、対象アカウントへのWrangler認可を取り消し、DashboardでWrangler検索結果0件を確認しました。旧/新の認可は1行に集約されていたため、次にCLI配備する際は再認証が必要です。配備済みWorker・D1・Access・Custom Domainの削除や変更は行っていません。

管理場所は [Cloudflareの接続済みアプリケーション](https://dash.cloudflare.com/profile/access-management/authorization) です。再認証時は対象アカウントを限定し、必要な既存scopeを確認します。他のMCP接続やアカウントをまとめて取り消さないでください。認可コード・Cookie・資格情報の値は記録しません。

## 費用と変更後の記録

追加費用の目安は**既存Workers Paid基本料金を除き月$5**です。硬い課金上限ではありません。設定日のDashboard表示は今期課金使用量$0.00でしたが、将来の請求額を保証しません。

設定を変更したら、このメモの「確認日・設定内容・理由・影響・検証結果」を更新し、変更前後の経緯は作業ログへ追記します。秘密値・OTP・Cookie・認可コードは記録しません。
