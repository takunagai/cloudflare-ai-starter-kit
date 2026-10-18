> 公開用の履歴整理により、実環境の識別子・個別URL・個人のパスはダミーへ置換しています。記載されたダミーは接続先・照合値として使えません。

# staging初回配備の実行前計画

作成日: 2026-09-27。ユーザーは `staging.example.invalid` アカウントと `staging.example.invalid`、Access限定公開、既存Workers Paid料金を除く月$5の追加費用上限を了承し、後続で専用D1・Worker・Accessアプリ作成、remote migration、Custom Domain/DNS変更を明示許可した。専用D1の作成とremote migrationは実施済み。Worker配備以降の状態と失敗は[作業ログ](../staging-work-log.md)を参照。初回は任意拡張と実AI呼び出しを全OFFにする。

## 推奨する初回の範囲

| 項目 | 提案 | 実行前に確定すること |
| --- | --- | --- |
| Cloudflareアカウント | 準備上の候補として了承された `staging.example.invalid`（ID `00000000000000000000000000000000`）。2026-09-27に読み取りAPIで名称とIDの一致を確認 | DashboardでWorkers Paidがactive、今期の請求可能使用量は$0と確認済み。配備直前に共有枠を再確認 |
| Worker | `cloudflare-ai-starter-kit-staging` の専用Worker。productionと名前・bindingを分離 | 同名Workerは読み取り時点でなし。配備直前に再照合 |
| D1 | `cloudflare-ai-starter-kit-staging` の専用DBを新規作成し、stagingの `DB` bindingへ**実ID**を指定 | 同名DBは読み取り時点でなし。DB名・ID・リージョン・初期空DB、production DBと異なることを配備直前に確認 |
| URL | 準備上の候補として了承された `staging.example.invalid`。専用Custom Domainとして割当。`workers_dev`とpreview URLはOFFを維持 | zoneはactive、候補hostnameのDNS・Custom Domain・Worker routeは読み取り時点で衝突なし。Custom Domainの作成はDNSレコードと証明書を作る外部変更として別に承認が必要 |
| 認証・公開範囲 | **初回は`AUTH_MODE=access`とし、ユーザー了承済み**。専用Worker全体をAccessで保護し、許可した少数のテスト利用者に限定。アプリでもJWTを検証 | Access organizationは存在し、team domainは `example-team1.cloudflareaccess.com`。専用Accessアプリは未作成。アプリAUD、許可する本人・テスター、セッション時間を確定。公開トップやhealthもAccess内になることを了承 |
| 機能 | `LOCAL_DEMO=false`、RAG/agent/Workflows/images/billingは全OFF。AI providerも未設定 | 初回は配備・D1・Access・HTTPの検証であり、AIチャットの実推論やメール認証の受け入れではない |

Access案では初回のアプリSecretは**不要**。`ACCESS_TEAM_DOMAIN`と`ACCESS_AUD`は対象アプリから確定する非Secret設定。初回の認証にはCloudflare Accessアプリとpolicyが必要で、既存のAccessリソースを勝手に変更しない。Cloudflare AccessとWorkersの両方の公開経路を確認し、AccessなしでWorkerへ到達できる別経路を作らない。

公開向けBetter Authもstagingで検証する段階では、別の明示的な変更計画に切り替える。必要なのは `BETTER_AUTH_SECRET`（Secret）、`EMAIL` binding、`EMAIL_FROM`（非Secret）、送信ドメインのonboarding、テスト用の実受信先。Googleログインを選ぶ場合だけ `GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` を追加する。メール認証なしのBetter Authを公開環境の完成としない。外側のAccess制限を併用する場合は認証リンクへの到達経路も検証する。

AI疎通を別途行う段階では、選ぶproviderに応じて `AI` binding（Workers AI）、または `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `OPENROUTER_API_KEY` の該当Secretを追加する。RAG、画像、決済など全OFFの拡張用リソース・Secretは作らない。Secret名は構成資料に基づくもので、値はエージェントが扱わない。

## 費用と停止条件

既存Workers Paidの月額最低$5はアカウント共通で、staging専用の無料枠ではない。Workersはアカウント全体で月1,000万requestと3,000万CPU ms、D1は月250億read行・5,000万write行・5GBを含み、超過は従量課金。2026-09-27に対象アカウントのDashboardでWorkers Paidがactive、今期（9月21日〜10月20日）の表示上の請求可能使用量と予測使用コストが$0、Workers request/CPUとD1 read/writeは含有枠内と確認した。将来の利用量や請求額の保証ではない。初回案では有料AI、アプリの実メール、R2、AI Search、Workflows、fal.ai、Polarを使わないため、その機能の追加料金は想定しない。

Workers AIにはWorkers Paidでも**アカウント共通で1日10,000 Neuronsの無料枠**があり、UTC 00:00にリセットされる。枠を超えると$0.011/1,000 Neuronsの従量課金になる。無料枠内の推論は追加課金なしで利用可能だが、Paidでは10,000到達時に自動停止する保証はない。ほかのWorkerによる利用も合算され、モデル・入出力長で消費量が変わる。初回の配備・Access・D1検証ではAI bindingを付けず、実AI呼び出しは行わない。後続のAI疎通を行うときは、アカウント全体の日次使用量、選ぶモデル、呼び出し回数と入出力上限を確認し、月$5の追加費用上限との関係を改めて判断する。

**追加費用上限は月$5（既存Workers Paidの基本料金を除く）**でユーザー了承済み。提案する検証運用は、許可テスター2名まで、期間7日、手動HTTP確認のみ、有料AI・アプリの認証メール・決済0回。読み取りAPIで確認した既存Access IdPはワンタイムPINが1件だけであり、実ログインはメール送信を伴う。実ログイン前に送信先・回数を具体化して別途承認を得る。Accessの実契約と共有枠の残量を対象アカウントで確認し、この範囲で月$5を超える見込みなら配備前に計画を見直す。Cloudflare Oneの公開料金ではFreeは50ユーザーまで、従量プランは$7/ユーザー/月なので、対象が従量プランならテスター1名でも上限を超え得る。Dashboardの使用量と請求アラートを開始前と毎日確認し、超過が見込まれたら公開経路と検証を停止する。請求アラートは硬い課金上限ではなく、月$5以下を保証しない。

Cloudflare OneのZero Trust Freeは、規約と無料枠超過分の毎月請求許可が必要な画面を本人が操作して有効化した。2026-09-27にDashboardで「プラン Zero Trust Free」を読み取り確認。既存Access IdPはワンタイムPIN1件、Cloudflareアカウントのactive memberは1名。月$5の硬い上限は引き続き設定できておらず、使用量と請求アラートで運用監視する。

**現在の状態（2026-09-28）:** ユーザーの明示許可と最終Authorizeの確認を受け、権限追加・専用Worker・Worker全体のAccess保護・Custom Domain/DNSの配備まで完了。未認証HTTPはAccessへ転送されることを確認した。その後、本人操作でOTP受信とログインに成功し、認証後UIと実D1レート制限書込みを確認。エージェントのメール送信、会話保存・実AIは未実施。詳細・失敗・制約は作業ログを正本とする。追加費用月$5は運用上の目安であり、硬い課金上限ではない。

## 承認後の順序と合格条件

1. Zero Trust Freeは有効化済み。アカウントID、zone/FQDN、Worker名の空き、Access policy、DB名、費用上限を再照合済み。Worker作成の直前にも再照合する。
2. 専用D1を`apac`配置ヒントで作成し、対象IDだけをstaging設定へ反映済み。`APP_ORIGIN`を実HTTPS originへ変更し、stagingに `DB` binding、`ACCESS_TEAM_DOMAIN`を追加済み。`ACCESS_AUD`はAccessアプリ作成後に確定する。配置ヒントは保存場所の厳密な法的制約ではない。
3. 空DBに対して未適用5本と復旧可能点を確認し、`0001`〜`0005`をremote適用済み。再listで未適用0本。適用済みSQLは変更しない。
4. `pnpm check`後、`CLOUDFLARE_ENV=staging pnpm build`。生成された `dist/server/wrangler.json` のWorker名、origin、D1 ID、OFFフラグ、公開ルートなしを確認し、`pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run` を実行する。生成設定に環境が展開済みなのでdeployに`--env staging`を重ねない。
5. 承認された専用Workerを**公開ルートなし**で配備する。`workers_dev=false`・preview URL OFF・Custom Domain未設定を実クラウド側でも確認する。Worker ID取得後、そのWorker全体を対象にAccessアプリと少数利用者のpolicyを作成し、`ACCESS_AUD`をstaging設定へ反映する。アカウント全体のAccess policyは変更しない。
6. Access保護を確認してからCustom Domainを追加したstaging buildとdry-runを再実行し、その成果物を配備する。未許可者が拒否され、許可者だけが `/`、`/help`、`/app`、`/api/health` へ到達できること、Access JWTをアプリ側でも検証していること、D1を使う認証済みAPIと所有権を確認する。モデル一覧が未設定、拡張がOFFであることを確認。テスト利用者以外へURLを案内しない。
7. revision、buildの環境、Worker version、D1 IDとmigration状態、Access policy、実施したHTTP結果、使用量を値や個人情報を含めず記録する。ローカルdry-runは上記のクラウド合格条件の代わりにならない。

## 復旧と中断

初回の空DBにはユーザーデータを持ち込まない。失敗時はまずAccessの許可範囲とWorkerの公開経路を閉じ、追加の呼び出しを止める。配備後の不具合は直前の正常Worker versionと現在のD1 schema/bindingの互換性を照合してWorkerをrollbackする。Worker rollbackはmigrationを戻さない。D1は適用前のTime Travel bookmark/復旧可能時点を確認し、復元によって失われる更新を明示してから、別の承認された操作として復元する。初回が空DBでも認証・会話データが作成された後は無条件復元しない。Access・Custom Domain・D1の削除も別操作として対象を確認する。

## 2026-09-27のローカル事前検証

`WRANGLER_LOG_PATH=.wrangler/logs CLOUDFLARE_ENV=staging pnpm build` は成功し、`/help`を事前生成。生成物への `wrangler deploy --dry-run` も成功。ただし現行 `wrangler.jsonc` のstagingにD1 bindingはなく、`APP_ORIGIN=https://staging.example.invalid` のまま。build時にD1非継承と生成設定の環境節に関する警告が出た。dry-runで確認できたのはstagingの非Secret varsのみで、D1・Access・メール・AI接続は検証していない。最初のsandbox内buildはローカルlistenとWranglerログ先の権限で失敗し、許可されたローカル実行とプロジェクト内ログ先で再実行して成功した。

同日のCloudflare読み取りAPIでは対象アカウント名・IDとactiveなzone、Access organizationの存在を確認。候補のWorker、D1、Accessアプリ、hostnameのDNS/Custom Domain/routeとzoneのwildcard DNS/Worker routeに衝突はなかった。既存Access IdPはワンタイムPIN1件。契約情報APIは認証権限不足で取得できなかったため、契約は後続のDashboardで確認した。これらの照合は2026-09-27時点の読み取り結果で、将来の空きを保証しない。

後続のDashboard読み取りでは、Workers Paid activeと請求可能使用量$0を確認。Cloudflare Oneは当初プラン未選択で、Free申込みの最後に規約同意と無料枠超過分の毎月請求許可が必要だった。エージェントは操作せず本人に引き継ぎ、本人が有効化した後にZero Trust Free表示を確認した。

ローカル準備としてmigration 5本を再確認。`DROP`/`TRUNCATE`/データ削除文はなく、`0005`は課金予約テーブルへの列追加である。最初のD1新規作成試行は自動承認レビューで拒否された。その後ユーザーが対象を列挙して明示許可し、新規の空staging DBを作成してremote適用した。Worker・Access・Custom Domainは未作成。実施結果は[作業ログ](../staging-work-log.md)を参照。

公式根拠と採否は[staging配備調査](../../references/staging-deployment.md)、一般の手順は[運用方針](../operations.md)。
