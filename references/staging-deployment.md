# staging配備の公式確認

確認日: 2026-09-27。以下は公開仕様の確認であり、対象アカウントの契約・残枠・配備成功を示さない。

| 根拠 | 採否・制約 |
| --- | --- |
| [Cloudflare Vite pluginの環境](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/) | `CLOUDFLARE_ENV`はbuild時に選び、生成設定はflattenされる。deploy時に環境を切り替えない。既存の運用手順を維持 |
| [Wrangler設定](https://developers.cloudflare.com/workers/wrangler/configuration/) | 環境別bindingを明示。IDなしbindingのdeploy時自動作成があるため、対象IDを確定してから実配備する |
| [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) | Workerがoriginの専用hostnameに採用候補。追加時にDNSレコードと証明書が作られるため、DNS変更として承認対象。既存CNAMEとの衝突を確認 |
| [WorkersのCloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) | 初回stagingはWorker単位の保護を採用候補にする。routes・Custom Domains・previewをまとめて保護できるが、Worker IDが必要なので、公開ルートなしでWorkerを作成した後に設定する。WebSocketは非対応だが現行の検証対象はHTTP |
| [D1 migrationコマンド](https://developers.cloudflare.com/d1/wrangler-commands/) | `list`で未適用を確認後、承認したDBだけへ`apply --env staging --remote`。ローカル成功と遠隔適用を区別 |
| [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | 復旧可能点の確認に利用。復元は後続更新を失い得るので別の操作として扱う |
| [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)・[D1料金](https://developers.cloudflare.com/d1/platform/pricing/) | 既存のWorkers Paid枠はアカウント全体で共有。超過従量と使用量を事前確認。金額上限の保証にはならない |
| [Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Workers Free/Paidともアカウント共通で1日10,000 Neuronsが無料。Paidでの超過分は$0.011/1,000 Neurons。無料枠はstaging専用ではなく、課金の硬い上限にもならない。初回配備検証ではAI bindingと実推論を使わない |
| [Email Service料金](https://developers.cloudflare.com/email-service/platform/pricing/) | 初回Access案ではアプリのEmail Serviceを使わない。既存のAccess OTPで実ログインするとメール送信が起こる。後日のBetter Auth実送信ではWorkers Paid条件と送信枠を別途確認 |
| [Cloudflare One料金](https://www.cloudflare.com/plans/) | 公開表ではFreeが50ユーザーまで。対象アカウントで当初プラン未選択だったが、ユーザーが有効化しDashboardでZero Trust Freeを確認。Free申込み画面には無料枠超過分の毎月請求許可があり、追加費用月$5を硬く保証できない |
| [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)・[rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) | private repoはGitHub Pro/Team/Enterpriseが必要。現在のprivate repoへのruleset/branch protection APIはともに403でupgradeを要求。現状で有効化できたとは扱わない |

## GitHub main保護の設定案

private維持でGitHub Pro等が利用可能になった場合、`main`にPR必須、CI job `verify` 必須、force pushと削除の禁止、可能なら管理者にも適用する。個人リポジトリでレビュー人数を強制すると一人開発のmergeが止まるため、協力者が決まるまでは承認人数を必須にしない。設定前にブランチの既存ルールとrequired check名を再確認し、変更は別途承認後に実施する。GitHub Freeのままprivateを維持する間は、PR経由・CI成功後mergeを手順として守れるが、サーバー側で強制されない。

## 2026-09-28 再確認

- [WorkersのCloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)を再確認。専用Worker全体はself-hosted Accessアプリの `destinations: [{type: "worker", worker_id: "対象ID"}]` で保護する。`all_workers` は使わない。Static Assets経由では `ctx.access` が伝播しない制約があり、既存のJWT検証を維持する。
- [Wranglerコマンド](https://developers.cloudflare.com/workers/wrangler/commands/)と導入済み4.141.0のhelp/実装を照合。OAuthで既存scopeに `workers_scripts:write` を追加し、ブラウザで対象アカウントを限定する。資格情報はWranglerのkeyring経路で扱い、エージェントは値を取り出さない。
- [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)と対象Dashboardを再確認。Workers Paidが現在のプラン、今期の課金使用量は$0.00。共有枠・将来請求の保証ではなく、追加費用月$5の硬い上限でもない。契約APIは認証エラーのため契約確認の証拠には使わない。
- 07:24〜07:29 JSTに [OAuthアプリの認可・取り消し](https://developers.cloudflare.com/fundamentals/oauth/authorizing-an-application/) と [Wrangler一般コマンド](https://developers.cloudflare.com/workers/wrangler/commands/general/) を確認。Connected Applicationsのアプリ別取り消しを採用し、Wranglerのみ失効。CLIの`logout`は現在のOAuth tokenと保存資格情報を対象にするため、旧/新grantを管理画面で確認する今回の代替には使わなかった。Dashboardでの失効確認と、旧コード単体の再使用試験・不正利用調査は区別する。
- 07:44 JSTに [OTPログイン](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)、[AccessのOTP未着](https://developers.cloudflare.com/cloudflare-one/troubleshooting/access/)、[Cloudflareメール未着](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/not-receiving-cloudflare-emails/) を確認。送信済み表示は配送証明ではなく、許可条件の不一致では実送信されない。送信元は `noreply@notify.cloudflare.com`。認証ログはコード入力後に記録されるため、未入力時の配送判定には使わない。許可条件→受信側の拒否/隔離→Cloudflareの送信抑止の順で調査する方針。抑止の有無は今回未確認で、サポートへの送信も未実施。
- 同日、受信サービスがiCloudとの回答を受け [AppleのiCloudメール未着手順](https://support.apple.com/ja-jp/102562) と [迷惑メール管理](https://support.apple.com/ja-jp/102376) を確認。Web版での受信確認と容量確認を採用。送信元の連絡先登録は迷惑メール分類対策に留まり、配送・Cloudflare送信抑止の解消保証とは扱わない。端末のプライバシー保護やVPNの無効化は今回の対処として行わない。
- 同日08:04〜08:06 JSTに[ポリシーテスト](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/)とAPI仕様を照合。既存Access identityを使う評価を補助診断に採用したが、実呼び出しは認証エラー10000で未検証。[メール未着手順](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/not-receiving-cloudflare-emails/)のSupport Portal → Account → My Profile → Otherを送信抑止の問い合わせ先として採用し、下書きを保存。送信・抑止解除は未実施。
- 同日[Cloudflare未解決障害情報](https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json)を確認。Access OTP配送の障害を明示したincidentは見つからなかったが、個別宛先の配送を証明しない。[Email Sendingの抑止](https://developers.cloudflare.com/email-service/configuration/suppressions/)は送信ドメイン向けの別機能であり、Access OTPの抑止解除手段として採用しない。

## 2026-09-28 旧プロジェクトの廃止

- [Accessログインページの表示設定](https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/access-login-page/)を確認。組織表示名は全Accessアプリに共通で、team domain変更とは別。共有組織自体を消さず表示名を改める手順を採用。
- [Worker削除API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/)を確認。削除時は実装するDO namespaceも失われ得るため、先に他Workerからの参照を検査。force削除は採用せず、Dashboard削除後の再一覧で確認。
- [R2バケットの削除](https://developers.cloudflare.com/r2/buckets/delete-buckets/)とAPI仕様を確認。内容の永久削除を承認後、空にする→オブジェクト0件→バケット削除の順序を採用。新しいSecret取得・S3資格情報投入・削除用Worker配備は行わない。
