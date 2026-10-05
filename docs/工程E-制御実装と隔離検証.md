2026-10-05・実falの終了状態: 本人が既存ADMINキーで終了helperを実行し、課金GET 200・当該イベント1件・$1以内の`available_now`を報告した。24時間以内の当該要求照合は実施済み。最終請求・Cloudflare側増分費用は未確定。上流DELETEは200/1試行だがCDN結果0件で`unknown`、消去完了の証明にしない。管理API結果は本人実行の報告で、エージェントの直接実測と区別する。既存ADMINキーの発行・権限変更・Worker投入・失効は行わない。

アプリに課金pass/上流削除unknownを記録し、確認経路を閉鎖した。D1で消費1/総上限2・停止1/閉鎖1・固定1800000 ms・attempt1/未終端0・本文0/参照0/asset0を確認。既存のprovider IDと最小台帳を保持し、再生成・再回収・枠復活なし。専用Access policyはAllow0/Block1、application/policyの6時間を保持し、当該アプリの既存トークン取消成功を画面で確認した。旧ログインのタブ再読込はアプリ画面に届かずAccessログイン画面となった。全アプリの利用者sessionへ影響するlogout URLは実行せず、既存環境を保持する。

本人の`off --build-and-verify`全10項目trueを受領後、同じ成果物を5回目としてOFF配備しexit0。実bindingでprobe/通常拡張OFF・通常gate空・AI/Jev OFF・専用D1/R2一致・workers.dev/preview無効を確認。その後、本人からWorkerのFAL_KEY除去成功と今回の一時fal APIキー失効済みを受領した。Secret除去の即時配備を6回目と数え、実WorkerでFAL_KEY不在・同じOFF/空gate/専用binding/代替ホスト閉鎖を確認した。fal側のキー失効は本人報告で、キー値の取得や旧キー認証の再試行はしない。共有の既存ADMINキーは対象外。今回の終了操作は完了したが、上流消去unknown・自然期限/品質/ACL/token未確認を保持し、工程EのM-0条件は未達。終了後もOFFのWorker/D1/private R2と本文なし台帳を保持し、保持期限後の退役や追加クラウド操作は別判断とする。

以下は回収と終了準備の各時点の記録。

2026-10-05・実falの回収拒否/終了操作: 本人の修正版照合true・追加ON1回許可後、同じWorkerへ4回目の配備を実施。実bindingのprobe ON・通常OFF/gate空・Secret存在/新D1一致を確認した。同じ要求の2回目statusと1回目resultは取得でき、上流completedとなったが、受入検証に適合せずcollection invalid/終端invalidとなった。回収試行1・token/PNG取得0・保存asset0・出力参照0で、受入拒否の具体的な項目はレスポンス本文を保持していないため未特定。条件の緩和・再生成・再回収/枠復活は行わない。

D1の出力object0、容量reservation released/held0、本文1を確認。専用R2のroot一覧API200/0件を確認し、物理画像がないこととアプリ保存0を区別して記録する。画像品質/ACL/匿名/短期token/3600秒自然期限は未確認。自然期限の必須条件は未達で、生成品質・通常gateの成功扱いにはしない。

本人限定/Git管理外の終了対象ファイルを作成し、実request IDはチャット/公開文書へ出さず本人へ案内する。本人担当の課金/上流削除用[終了操作helper](工程E-fal終了操作.py)を準備した。agentはhelperを実行しない。管理者キーをgetpassで本人が会話外入力し、会話/環境/argv/ログ/ファイルへ保存しない。TLS検証・リダイレクト拒否、当該request ID限定、課金は当日/limit20・共有残高の差から算出しない。削除は20:20 JST以降、永続したIdempotency-Keyと最大3試行で自動retryなし。200/空CDN結果はunknown、対象別exceptionなしの結果をreported_deletedとして本人申告と実測を分ける。キー権限/新規発行は変更しない。構文確認済み、実管理API/本人入力は未検証。

```sh
python3 docs/工程E-fal終了操作.py billing
# 20:20 JST以降
python3 docs/工程E-fal終了操作.py finish
```

結果のJSONはID/URL/キーを含まない。本人報告後、アプリ本文の消去/最小台帳保持・確認経路/Access閉鎖・OFF配備5回目・本人Secret除去即時配備6回目を進める。今回の自然期限はアプリに受入済み出力参照がなく検証できないため、削除成功と混同せず未確認を保持する。本人は「既存ADMINキーを本人が使う」を選択した。新規ADMINキー発行/権限変更は行わず、既存キーを本人の別ターミナルの非表示入力で使い、当該1要求の課金照合と上流DELETEだけを行う。Workerへの投入なし。20:20 JST以降のfinishを1回案内し、キー/ID/URLなしのJSON結果を本人報告待ちとする。

本人から、今回入力したキーのScopeはAPIとの回答を受領した。課金/削除APIに必要なADMIN scopeを満たさず、403の原因となる権限不足を確認した。既存ADMINキーの本人利用を推奨し、なければ一時ADMINキー1つの本人発行/終了直後失効を提案する。キー自体はFalの管理権限が広いことを明示し、新規発行の許可を別に求める。用途は当該要求の課金GET/上流DELETEだけ、Workerへは投入せず、値は会話外getpass・保存/出力しない。生成追加0/購入なし/管理上限/台帳消費/Cloudflare総6配備は維持。新規ADMINキーはまだ未許可・未実施。

本人の追加診断はHTTP403/authorization_error。非JSONのブラウザ拒否ではなくfal側の管理認可拒否と確認した。キー値を読まず、Keys画面で今回入力キーのScope（API/ADMIN）だけ本人確認中。課金/削除APIのADMIN scope要求は[公式認証](https://fal.ai/docs/api-reference/platform-apis/authentication)と各API本文で確認済み。既存の契約/残高/削除担当・権限申告は保持するが、これを当該キーの管理API成功の証拠としない。新規ADMINキー発行/権限変更は未許可・未実施。

本人の課金helper実行結果はHTTP403・matching events0・billing unknown。イベントなしを0ドルと扱わない。削除はまだ実行せず、同じ管理認証が401/403の場合はfinishも削除送信前に停止するようhelperを修正した。403がfalの認可JSONか非JSON拒否か未特定のため、応答本文を出さず既知のerror種別だけ表示する診断を追加し、本人に1回だけ案内した。新規管理者キー発行・既存キー権限変更・実Secretの取得/変更は行わない。

アプリの本文早期消去は実施済み。D1で本文0/出力参照0/body erased1・provider ID保持、消費1/停止1/閉鎖0/attempt1を確認した。上流削除・課金照合の本人報告後にAccess閉鎖・OFF5回目/本人Secret除去6回目を進める。

以下は各時点の記録。

2026-10-05・限定ON配備/実fal1要求受理: 採用済み固定窓18:30〜19:00 JSTを延長せず続行した。コネクター書込みerror7500、Wranglerファイル取込み`/import`の認証error10000を受け、同じ本人認証の通常`/query`でrun/slot 1を登録。owner/origin/承認版/時刻/入力hash一致・上限2/消費0/slot 1だけを確認後、照合済みONを配備（3/5）。実WorkerのprobeのみON・通常生成OFF/gate空・AI/Jev OFF・Secret存在/新D1/private R2一致を確認した。現在Chromeで署名付き本人owner一致・固定窓・消費0/送信可を確認し、固定内容の1要求を送信した。上流queued/消費1/受付停止/生成ボタン無効を確認。実fal1要求受理は確認済みだが、生成完了/出力回収/品質/課金/期限は未確認。

初回status照合1回は失敗し、同じjobはqueued/pending、回収試行0・消費1・停止済み・未閉鎖・provider IDあり・leaseなしを確認した。画像/動画/音声の共通Queue管理URLが詳細endpointを含んでおり、[公式SDK](https://raw.githubusercontent.com/fal-ai/fal-js/main/libs/client/src/queue.ts)のowner/app単位と不一致。新規送信URLは維持し、管理URLだけを修正した。fakeも独立した登録アプリ一覧へ更新し、旧実装の画像4ケース失敗、新実装の関連4ファイル118 workerd成功・3ファイルBiome/型/build/dry-run成功を確認。既存895＋7/HTTP/M-5/D-2/remote/CIは再実行していない。

同じ1要求の回収を再開するため、追加ON配備1回を提案する。対象Worker/DB/R2/Access・固定窓/消費・管理上限・通常gate/秘密・CDN条件は変更しない。追加ONが4回目、終了OFFが5回目、本人Secret除去即時配備が6回目となる変更で、追加配備は未許可/未実施。新しい成果物のbinding等は保護フックによりエージェントが読めず、本人の値なし照合を行ってから追加配備の可否を判断する。再生成・slot追加・台帳リセット/枠復活は行わない。

以下は各時点の記録。

# 工程E ─ 限定確認の制御実装と隔離検証

2026-10-05・初期OFF配備完了: 本人からSQL切替と配備前照合の「両方true」を受領した。同じ照合は再実行せず、未適用0008〜0011だけを同じ新D1へ続行。remote migrationは計2操作、履歴11/11・旧検証台帳/run/slot/media_jobs/image_jobs各0・回復停止0・probe表6を確認した。canonical SQL11本/旧DB/旧隔離先は未変更。

初期OFF dry-run exit0後、Workerの初期OFF deployを1回実施しexit0。実Workerのstaging/standard/Access・全生成/probe/upload OFF・全確認一覧空・AI/Jev OFF・D1/R2各1・FAL_KEYなし・workers.dev/preview無効をAPIの指定項目だけで確認した。Worker配備は現在1/5。所有zoneの当該hostnameだけのDNS/Worker domain0件を確認し、Chrome UIで既存zoneからCustom Domainを1件追加。購入操作はなく、APIで専用Workerとの一致/証明書ありを確認した。専用Access application/policyは各6時間・本人のみ1件、共有global/IdP/旧入口は未変更。

private設定のoriginを読むCLI境界確認はsensitive-path拒否で中止。そのファイルを別経路で読まず、Chromeの実Workerから接続した新入口を開き、Access hostへの転送とメール入力/Send login code画面を確認した。匿名CLI HTTP statusの実測ではなく、現在Chromeの未ログイン到達の証拠とする。本人入力前の欄だけを確認し、メール/OTP/cookie/JWT値は取得していない。

本人からキー投入/ログイン成功の報告を受領した。実WorkerのFAL_KEY存在、probe/通常生成OFF・gate空・AI/Jev OFF・専用入口のWorker一致を値非表示で確認し、配備2/5とする。現在Chromeの専用入口へ再到達するとAccessのメール入力画面で、ログイン到達は未確認。報告したログイン先がWranglerか新stagingかだけを本人へ確認中。OTP実数は未確認、最大3回を維持する。実fal0・run/slot未登録・固定窓未開始で、開始をnowで自動登録しない。

2026-10-05・本人到達と開始待ち: 本人の画面提示と現在ChromeのDOMで、限定確認ページ到達/probe OFF/生成ボタンdisabledを確認した。`button:disabled`の既存`cursor: wait`が待機に見える原因であり、生成中の証拠ではない。照合済みON成果物を維持するためCSSは変更していない。所有者照合のAPI直接表示はChromeにブロックされ、Cookie/JWTを読む方法や同origin fetchによる迂回は使わなかった。認証ログAPIの取得fieldをメール/IPなしへ限定し、初回は未対応fieldで失敗、対応する`user_id`だけに絞って成功した。当該専用applicationだけの当日ログは成功1/拒否0/本人1名。所有者IDはツール内だけで準備し、実値を記録しない。これはAccess認証ログによる本人確認で、Workerの署名付きowner一致はON配備後の専用状態取得で確認する。

固定窓は本人の「1830で進めて」で2026-10-05 18:30〜19:00 JST（09:30〜10:00 UTC）を採用した。run/slotをD1 APIのbatchで登録する1操作を試みたが、コネクターのCloudflare認証権限によりerror7500で拒否された。読取りでrun/slot/attempt各0件・D1変更0を確認し、再送や台帳のリセットは行っていない。これは保護フック/自動承認レビューの拒否とは別のサービス側権限エラー。

既に本人が認証し、同じ新D1のremote migration11本に使ったWranglerで登録する経路を用意した。本人限定/Git管理外領域へ登録用SQLを0600で保存し、値を表示しない。旧18:30時刻のSQLはまだ実行せず、新時刻の採用後にだけ差し替える。[公式d1 execute](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute)と固定CLI helpで、DB binding・remote・file・yes・生成設定config指定を実読確認した。既存の認証権限/フック/例外を変更しない。

18:30までに登録/配備を完了できなかったため、run/slot未登録・実fal0・配備2/5のまま停止。新しい固定窓18:45〜19:15 JST（09:45〜10:15 UTC）を提示して本人回答待ちとする。無回答で時刻を変更しない。自然期限確認は最初の出力観測から3600秒後。ON成果物の照合、本人認証1回、固定入力/ownerの準備は保持する。

### 次の限定ON準備

[本人用の限定配備切替](工程E-限定配備切替.py)は、既存の管理外設定だけを対象に、APP_ORIGINの専用Custom Domainをsourceへ反映し、probeだけをON/OFFへ切り替える。通常gate/生成・upload・DB/R2/認証・時刻/台帳は変更しない。Secretを投入せず、配備/送信を実行しない。確認日2026-10-05。エージェントによるprivate設定更新と生成設定読取の既存sensitive-path拒否を迂回しないため、本人が別ターミナルで実行する。今回のhelperは構文確認済み。本人から`on`実行の`source_prepared: true`・`deploy_performed: false`を受領した。新しい限定ONのstaging build/dry-runは各exit0。本人からON成果物の全10項目true・all_passed trueを受領し、同じ照合は取り直さない。現在Chromeで専用入口を復旧するとAccessメール入力画面で、本人到達は未確認。slot 1の固定入力に基づくrequest key/input hashをツール内だけで準備したが、DB登録/開始時刻設定/実fal送信はまだ行っていない。

```sh
python3 docs/工程E-限定配備切替.py on
```

source切替は本人報告で完了し、ON build/dry-runも成功した。本人の`python3 docs/工程E-限定配備切替.py on --verify-generated`の全項目trueで、新成果物の照合も完了した。初期OFF/今回ONの照合済み結果は取り直さない。次は現在Chromeに開いた専用入口で本人がAccess認証し、到達/認証回数を値なしで確認する。開始絶対時刻/本人ownerを確定し同じ新D1へrun/slot 1を一度だけ登録した後、限定ON配備（3/5）へ進む。終了時は同じhelperの`off`を使い専用入口を維持してOFF配備（4/5）を行い、本人のSecret除去即時配備（5/5）を数える。

2026-10-05・policy保存後の実環境準備: 本人の「保存した」を受領し、本人メール値は読まず、新policy 1件/Allow/6時間/メール完全一致1件/他条件なしを確認。エージェントが新applicationをUI保存し、名前限定APIで1件・専用hostname・Self-hosted・6時間・policy1件を確認した。1時間のAPI作成失敗4試行と、6時間のUI保存成功1回を区別する。

新しい管理外設定を実対象で作成し、0600/本人所有/symlinkなし/Git除外を確認。実ID/名前/URL/AUDを公開文書へ写していない。初期OFFのstaging buildはexit0、`dist`は本人限定0700。Wrangler認証と対象アカウント一致、Worker/D1書込みscopeを値非表示で確認し、account overrideの名指し2変数はunset。環境操作付き補助処理とステータス変数出力はフック拒否で中止し、それらの操作を除いた認証照会/直接buildは成功した。

remote migrationの初回は0001〜0007成功/0008 `incomplete input: SQLITE_ERROR`で停止。0008のDDLはrollbackされ、名前限定履歴7件/旧境界あり/メディアruntime・probe表なしを確認。D1のread-only `EXPLAIN`で括弧なしCASEのtriggerは失敗、括弧付き同内容は成功し、検査triggerの作成0を確認した。[公開一次資料の分割問題](../references/e-preflight-fal-20261005.md#d1-migrationの実クラウド分割問題同日)と今回の実測を分ける。

[SQL実行形式の変換](../scripts/d1-wire.ts)は引用文字列/識別子/数値/演算子を保持し、CASE式だけを括弧で囲み、コメント/式外の改行を整理する。数値/複合演算子の初期変換不備を隔離試験で修正した。新3 workerd試験はschema・回復停止・旧unknown同時枠・probe消費単調性・失敗DDL rollback/既存7本保持を確認し全成功。元SQL11本は内容識別で不変、別の`.wrangler/e-live/migrations`へ0600・同名の実行用コピー11本を作成した。未適用0008〜0011だけを同じ新D1へ続行する案で、履歴/台帳をリセットしない。

生成済み設定読取と、管理外設定の`migrations_dir`だけの切替はsensitive-path拒否で中止。別ツール/別名設定で迂回せず、[本人用のSQL実行形式切替](工程E-SQL実行形式切替.py)と[配備前照合](工程E-配備前照合.py)を用意した。エージェントは両helperを実行しない。本人は次の2コマンドを別ターミナルで実行し、true/false・失敗項目名だけ報告する。既に配備前照合を完了していれば同じ確認を取り直さず、切替だけ行う。

```sh
python3 docs/工程E-SQL実行形式切替.py
```

```sh
python3 docs/工程E-配備前照合.py
```

現在は本人による切替/生成設定照合待ち。private設定の切替はまだ未実施、remote migrationは7/11・初回1操作、Worker配備0/5、FAL_KEY/実fal/OTP0。完了報告後、同じD1へ残り4本を適用し、dry-run/初期OFF配備を続ける。開始絶対時刻とrun/slotは未登録。保護フック/例外・固定版・canonical SQL・既存staging/旧隔離先・Git stage/commit/push/PR・remote/CI再照会は変更していない。

2026-10-05・最新の認証方針: 本人の「短いと不便だから、6hours・認証最大3回」を採用し、application/適用policy session各6時間、本人認証/必要OTP最大3回へ変更して続行する。30分への変更案は採用せず退役。以前の1時間/最大2回は当時の条件を保存する履歴。送信窓30分/総上限2/slot 1だけ/今回は1要求・自然3600秒・$1目安/購入なし・早期消去/Access閉鎖/OFF/台帳保持は変更しない。6時間sessionでも新規送信の窓/枠は増えない。

専用ON時の署名付きAccess JWT寿命上限だけを6時間へ変更した。[定数](../src/server/media/probe-permit.ts)と[HTTP認証の呼出し](../src/server/app-api.ts)へ限定し、署名/issuer/AUD/owner/expiryと既存5秒許容、通常環境は維持する。SQL/依存/lock・枠/時刻/秘密/保護フックは変更しない。[境界試験](../tests/media-probe.test.ts)は1時間/6時間/6時間＋5秒受理、6時間＋6秒/24時間拒否、probe OFFで通常24時間session維持を確認する。関連2ファイル53 workerd試験・3ファイルBiomeは成功。初回typecheckで試験fixtureの余剰プロパティ指定1件を検出し、同じ値の設定に`MediaEnv`型を付けて修正。型/route生成は成功済み、修正後`tsc --noEmit`はexit0。既存895＋7/HTTP/Chrome合成を再実行せず、新しい差分だけを検証した。実CloudflareのJWT寿命/配備はまだ未検証。

現在Chromeの未保存フォームでapplicationと新しい本人Allow policyのsessionを各`6 hours`に設定し、専用hostname/名前・全pathとメール完全一致selectorを準備した。本人の実メールは取得せず、該当入力欄へカーソルを置いて本人に入力/「ポリシーを保存」を案内した。本人は値を返さず「保存した」だけ回答する。受領後、エージェントは当該policyの反映/6時間を値不要で確認し、新applicationの保存・配備準備を続ける。Accessの保存/実効値をフォーム表示だけで成功扱いにしない。

2026-10-05・Access欄の再確認と変更案: 本人の「どこ？やって。人間が必要ならナビして」を受け、エージェントが作成フォーム下部「詳細」の「セッション期間」を開いた。9件全てを確認し、1時間がないことを確認できたため、同じ画面確認を本人へ依頼する必要は解消した。新D1へ状態を変えない`SELECT 1`のAPI照会は200/成功で、POST全体の通信不良ではない。Access固有のエラー情報を限定取得する追加1試行を行ったが、詳細は特定できず、Access作成は計4試行・成功0、終了照合は当該名前GET200/0件。remote migrationは0のまま。

新しい選択案はapplication/適用policy sessionを30分へ短縮し、本人認証・必要OTPを最大3回へ変更すること。画面で30分が選べることは確認済み。送信窓30分/総上限2/slot 1だけ/1要求、自然3600秒確認、$1目安/購入なしと終了構成は維持する。Workerの署名検証は寿命1時間以下を受けるので、30分への変更にコード差分は不要。生成待ち/回収/期限後確認を跨ぐ再認証のため追加1回を提案する。**未採用・未実施、本人判断待ち。** 本人は「30分・最大3回で進める」か「1時間を維持してAccess作成保留」を選べる。無回答なら1時間の採用を保持し、他値で作成しない。これは従来の許可を取り直す質問ではなく、UI制約が判明した後のsession/認証上限だけの変更案。

2026-10-05・現在Chromeからの実環境準備: 本人から「君が進めてくれるんじゃないの？ Cloudflareにログインした状態にしてタブを開いてる」と指示を受領し、作成/配備まで本人へ寄せた担当案を訂正した。既存Chrome/ログイン済みタブを使い、許可済みのCloudflare操作はエージェントが進め、実Secret/OTP/本人メールの入力は本人に限定する。下記の初期準備の本人担当はこの訂正前の案。新D1 1つ・Standard/private R2 1つを作成し、既存zoneのアカウント内で対象一致を確認した。R2はpublic development URLを有効化せず、custom domain行0。既存staging/DB/Accessは未変更。

Accessは未作成。作成フォームで新しい専用hostnameと名前を準備したが、application sessionの選択肢は15分/30分/6・12・24時間/1・2週/1か月等で、1時間が見当たらない。採用済み1時間を他値へ変更しない。公開APIの`session_duration=1h`を確認し、同一zone/account・同一新対象へ、policyなし/既定拒否の作成を3試行したが、いずれもErrorで成功を確認できなかった。最後の当該名前のGETは200・0件。取得できたエラー情報では原因/HTTP status/権限拒否を特定できず、認証や権限の問題と断定しない。追加作成は止め、本人の実画面で1時間の選択可否だけを確認待ち。フォームは未保存で引き渡し、「作成」はまだ押さない。

remote migration0、Worker配備0/5、Secret0、実fal0、OTP0。新DB/bucketは保持し、リセット/削除や別対象への作り直しを行わない。実ID/名前/origin/AUDは公開文書へ記録しない。ブラウザの重複locatorエラーに非SecretアカウントIDが出たため値を再掲せず報告し、以後は例外を捕捉して種類/真偽だけを返した。リポジトリへの転記・ログ削除・鍵失効は行っていない。スクリーンショットの限定領域取得は表示位置が一致せず、session/作成の検証証拠には採用しない。

2026-10-05・新規作成案の実行許可受領: 本人の「それで進めて」を、下記の新規対象/空DB11本・専用Access/入口・管理外保管・通常計5配備/Secret人間操作・最大2回認証/必要OTP2通・固定run/slotと対象限定終了操作への許可として受領した。実fal1要求/本人3項目確認済み・購入不要の許可は引き継ぐ。許可を実施/検証と混同しない。実対象/開始時刻は未確定、クラウド作成・配備・実Secret・実falはまだ0。[本人管理の初期準備](#本人管理の初期準備)から進める。以下の未承認は提案時点の記録。

2026-10-05・実環境準備の再開: 本人は今回の新しい工程E用stagingを「未作成」と回答した。旧実AI検証stagingとは別Worker/別D1であることを説明済み。main `5587e1bc5925420007f1ae611028355119605aa0`・clean、コード/SQL/試験`69d151a`と記録`5587e1b`、実Node26.10.0/pnpm12.6.0をローカルだけで照合した。以下の[新規作成・配備案](#未作成からの新規作成配備案)はレビュー用で、実対象・開始時刻とクラウド操作の承認は未確定。実fal許可/本人3項目確認済み・購入不要を保持し、同じ照合を取り直さない。

同日の追加許可で検証済みコード/SQL/試験28件を`69d151a`へローカルコミットした。文書は許可状態/継続判断を含む別コミットへまとめる。検証済みコードは変更せず同じ検査を繰り返していない。最終HEAD/cleanと再開地点は[plan](plan.md)を参照。以下の未commitは検証終了時点の記録。

確認日: 2026-10-05 JST。開始版はmain `e31571dee6f720e9afc4a2f6a699531b5b508d86`・clean。本人の「許可する。進めて」を制御差分の実装・隔離ローカル検証の許可として引き継いだ。実接続の実施結果とは区別する。採用済み用途/素材/予算・M-0と[詳細設計](工程E-用途と限定接続の事前整理.md)は維持する。

## 実装した境界と管理場所

| 対象 | 動作・理由・変更時の影響 |
| --- | --- |
| [専用policy/台帳](../src/server/media/probe-permit.ts) | `ENABLE_MEDIA_PROBE`は省略/OFFで404。固定承認版`e-sunburst-20261005-v1`、staging/standard/Access、AI/Jev/全通常拡張OFF、通常確認一覧空、別private R2、旧検証台帳空と復旧gateを要求。設定不備・未登録・DB不在/照会失敗は閉じる |
| [専用API](../src/server/media/probe-routes.ts) / [入口](../src/server/api.ts) | `/api/media-probe`と配下。同一origin・署名/issuer/AUD/expiry・本人owner・固定slotを照合。新規POSTはslot 1/request IDだけ、本文/モデル/URL/owner/driver/clockをHTTPから受けない。通常APIの生成/uploadはOFFのまま |
| [固定prompt/入力](../src/server/media/probe-permit.ts) | Sunburst text-to-image、1024角/medium/PNG/opaque/1枚/sync=falseと採用済み本文。normalize/hash/既存の容量・新旧合算・所有権/冪等性を使う。内部WeakSetで発行した承認だけをimage driverへ渡し、verified一覧へ追加しない |
| [0011](../migrations/0011_media_probe.sql) | run/slot/attempt/管理呼出し/判定/私有出力参照の追加だけ。共通予約とprobe消費を同一batch、dispatch claimと既存jobのlease/attemptを同一SQL+triggerで確定。総上限2に加えslotは1だけ、固定30分/末尾15秒拒否、失敗/unknown/取消で消費を戻さない。起動/HTTP/migrationでrunをseedしない |
| 送信直前 | 固定DB時刻・状態/停止・復旧、job/owner/leaseとdispatch claim一致を検査し、直前のサーバー時刻でも締切を照合。D1と外部fetchは原子的にできないため、既にclaimされた要求の停止競合はunknownとして保持。固定No-Retry/No-Fallback/Store-IO=0/3600秒/初期private ACLを維持 |
| [操作別の共通処理](../src/server/media/service.ts) / [image driver](../src/server/media/image-driver.ts) | 専用承認で既存jobのstatus/result/cancel/回収だけを扱い、受付停止後も継続。通常経路は確認一覧を増やしてもprobe jobのrefresh/retry/new POSTを拒否。nullable metadataは従来どおり不適合、別CDN/公開保存/再生成へ切り替えない。再回収で出力URLが変われば拒否 |
| [Access認証](../src/server/auth/access.ts) | probe ONの環境だけ、署名検証後のAccess JWT寿命を最大1時間＋既存5秒許容に制限。通常環境の認証契約は変えない。実Access application/policy/sessionを設定済みとする証拠ではない |
| [所有者配信](../src/server/media/assets.ts) | 閉鎖/24時間照合窓後のprobe job/素材は通常GET・一覧からも拒否。未知/別ownerへサイズ/validator/取得先を返さない。R2の書込み・物理削除・容量解放は既存receipt/CASを使う |
| [保持/復旧](../src/server/media/retention.ts) | private出力参照は本文早期消去/終端30日で消去。本文なしrun/消費/管理枠/判定は閉鎖かつ全job終端90日後だけ退役、unknownは日数で解放しない。witnessに最小probe記録と最初の出力観測時刻を加え、URL/tokenは含めない。不一致なら復旧gateを閉じたまま |
| [画面](../src/components/media-probe.tsx) | `/media-probe`。固定内容/1要求、JSTの固定窓/消費、状態・回収/診断・本文/出力消去・アプリ内閉鎖を表示。品質/課金/上流削除は本人報告と明記し、自動判定へ格上げしない。Access閉鎖・token失効/logoutは外部の別操作 |

既存0001〜0010、依存/lockfile・Node26.10.0/pnpm12.6.0・公開wrangler/5例・元DB/実設定・既存M-5/D-2隔離先・保護フック/例外は変更しない。新しい実リソース、Cron/Workflow/automation、admin鍵のアプリ追加、汎用CLIはない。

## 管理枠・診断と実確認の限界

管理枠はjob単位のD1予約で、再読込/再起動で補充しない。statusは20秒以上間隔・60分/180回、result最大3回、cancel1回、ACL2回、匿名GET2回、token発行4回、追加Bearer診断GET4回、token/自然期限観測各1回。終了後status照合3回を別枠とし、停止時刻＋24時間で専用経路を閉じる。上流admin削除は本人の別手段で最大3試行を管理し、アプリは本人報告だけを記録する。

設計時のtoken3回/診断GET3回案を4回へ具体化した。回収の1tokenに加え、診断tokenの期限前正常取得→同じtokenの期限後拒否→新tokenの正常取得と、自然期限後の新token確認が必要なため。生成POST/画像枚数/30分・採用M-0条件は増やさない。管理操作も実費照合へ含める。

[診断](../src/server/media/probe-diagnostics.ts)は作成時ACLのGET/匿名拒否を対照し、変更APIで後付けprivate化しない。tokenはサーバーメモリだけに最大345秒、各fetchは15秒。中断/通信不明はunknown、HTTP/ログ/DBへtokenを出さない。自然期限は最初の出力観測から3600秒後、有効な所有者tokenでも404/410を確認する。匿名403や期限切れtokenを消去証拠にせず、全コピー/backup消去も保証しない。

workerdの実HTTPでfixtureの新Requestへredirect=errorを指定すると失敗した。限定経路ではmanual＋3xx拒否を採用し、資格情報を別hostへ転送しない。[公式Request仕様](https://developers.cloudflare.com/workers/runtime-apis/request/)と実装試験を区別する。他11件/通常driverの実上流確認は今回に含めない。

## 隔離ローカル検証

- 新しい`.wrangler/e-preview/state`と`.wrangler/e-off/state`だけを使用。旧M-5/D-2や元利用DBを再使用・再複製しない。0011は新隔離DBとVitest内D1だけへ適用。
- [公開テンプレートからのfixture設定作成](../scripts/media-probe-local-config.mjs)は既存フォルダがあれば停止し、状態をリセットしない。追加の実リソース/実Secretはない。
- [合成Worker](../tests/media-probe-preview-worker.ts)はlocal/loopbackのみ、実FAL_KEYがあれば拒否。固定fake/JWKS以外の外部fetchを拒否し、署名付き合成Accessを実検証する。通常gate/生成/uploadはOFF。初回setupもTEST_ONLYの明示POSTだけで、既存runを作り直さない。
- [専用Vite設定](../tests/media-probe-preview.config.ts)と[OFF設定](../tests/media-probe-off-preview.config.ts)はremoteBindings=false、persist先を明示、envDir=false。Viteの[公開仕様](https://vite.dev/config/shared-options#envdir)でdotenv読込無効化を確認した。ブラウザは現在のChrome/既存profileを使用。
- [境界/診断試験](../tests/media-probe.test.ts)と[空/upgrade/再適用/失敗DDL試験](../tests/media-probe-migration.test.ts)をworkerd/D1/R2で実行。競合・同ID/不適合入力・未登録・時間境界・3xx・通常経路/他モデル拒否・1時間超JWT・停止/unknown/容量保持・閉鎖/復旧・90日/早期消去を対象にする。

ChromeのON合成画面で固定内容/1要求・締切不変・1要求消費/再送不可、回収/owner画像表示、ACL/匿名拒否、token期限/自然期限、出力削除・本文/出力参照消去・アプリ内閉鎖を確認した。token/自然期限は合成の時間短縮であり実期限の証拠ではない。合成画像の表示は実生成品質の証拠ではなく、品質/課金/上流admin削除の実確認は行わない。

終了時のON隔離DB集計はmigration11、消費1・閉鎖1、本文0・出力参照0・残素材0・容量保持0。台帳を残しており再起動/再配備で枠を復活させない。新OFF previewの標準HTTP smoke（登録/固定チャット/履歴/再試行/削除/logout・全拡張/Jev OFF）は成功し、probe APIは404。全体checkの最終結果と終了点検は[plan](plan.md)へ記録する。

当該最終checkは895 workerd＋7合成・lint/型/build成功。自身の4199/4173待受とChromeの検証2タブは終了済み。公開設定の本体成果物はOFFで、合成Workerを配備対象へ混ぜていない。元のDB/既存隔離先・実設定・依存・保護フックは保持し、未ステージ/未コミットで引き渡す。実接続に進むときは以下の実対象と承認された成果物を別に照合する。

## 実fal接続の許可と残る条件

2026-10-05、本人からfal.ai実接続の許可と作業用一時API Key発行済みの申告を受領した。キー値/名前/長さ/hashは取得・転記していない。本人は次の3項目を「3項目とも確認済み、購入不要」と回答した。

1. Sunburst利用権限と採用済み公開架空promptを送れる契約/上流保持条件。
2. 実単価・credit残高/最低購入・共有枠を含む追加費用$1目安・自動補充OFF、購入不要。
3. 完了要求の上流削除を行う担当/権限。

これは本人照合の申告で、エージェントによるアカウント再照会・実料金/保持/削除の実測とは区別する。実接続許可は保持し、同じ許可を再質問しない。実接続はまだ0回。キーの人間投入先、今回専用stagingの存在/実対象、非公開対応表、開始絶対時刻と対象Worker版/DB/Access/終了操作が未確定。専用環境の状態への質問は回答待ち。過去の旧検証staging/DB/残枠を転用しない。

未作成の場合の次案は新主Worker1・別D1 1・専用private R2 Standard 1・本人限定Access application/policy、1時間session。参照取得例外/公開R2/追加モデル・メール/決済/AI/Jevはない。実設定は管理外、秘密投入は本人が会話外で行う。候補の外部操作はD1作成/0001〜0011適用、R2/Access作成、初期OFF配備→本人FAL_KEY投入（即時deployを伴う）→限定ON配備→終了OFF配備、本人認証/必要OTP、固定run/slot登録、1生成と承認済みの回収/課金/削除/アクセス閉鎖。実対象・操作回数・共有費用と終了方法を揃えた実行票でクラウド操作を別承認する。既存ならその実対象と当該版への更新差分を先に照合する。どちらも今回の接続許可だけでリソース作成/配備・実Secret操作を始めない。

## 未作成からの新規作成配備案

確認日: 2026-10-05 JST。対象の範囲を以下に限定する案。未実施・未承認。既存stagingのWorker/D1/Access、元DB、M-5/D-2隔離先、既存DNSレコードは変更しない。実リソース名・ID・AUD・メール・originは本書/チャットへ記録しない。

### 対象と本人管理の対応表

| 役割 | 新規対象・操作数・管理場所 |
| --- | --- |
| 工程E用主Worker | 旧検証と同じ利用アカウント内に新規1つ。既存Workerを上書きしない。Workers & Pagesで対象を本人照合 |
| 工程E用D1 | 新規1つ、binding `DB`。空DBへ既存0001〜0011を1回のremote migrations applyで適用。新SQL・既存台帳の削除/移植なし |
| 工程E用素材R2 | 新規Standard bucket 1つ、binding `MEDIA_BUCKET`。RAGと別、r2.dev/custom domain配信なし。追加RAG bucketなし |
| 工程E用Access | 専用Self-hosted application 1つ、本人メール完全一致Allow policy 1つ。Worker全体/全pathを保護、applicationと適用policy session各6時間（最新指示で変更）。共有global/IdPは変更しない |
| 専用入口 | 既存stagingと同じCloudflare zone内の未使用hostname 1つを本人が選ぶ。既存入口を移し替えない。Access保護を先に確認し、その後Custom Domainを1回追加する。自動DNS/証明書作成を操作範囲に含む。競合するレコードがあれば上書きせず停止 |
| 管理外設定 | 既定の`.wrangler.standard-staging.local.jsonc`を本人管理で新規作成する案。既存ファイルがあれば上書きせず停止。非Secret実値だけ、Secretは書かない。旧設定をコピーしない |
| 対応表/復旧witness | `.wrangler/e-live/`を新しい本人限定・Git管理外・外部共有なしの保管先として提案。本人が対応表と本文/URL/tokenなしwitnessを管理。作成/保管は承認後、既存領域を上書きしない。DB全体exportは追加しない |

各実対象は本人の非公開対応表で、アカウント/zone・新Worker/DB/bucket/application/policy・hostname・管理外設定を一対一で固定する。承認された対象と本人の対応表が一致することを、値を返さず確認してから操作する。未確定のまま新規作成しない。実設定・生成設定・秘密・認証画面をエージェントが丸ごと閲覧する手順は含めない。

### build・配備・Secretの回数

コードの基準は`69d151a`、再開HEADは`5587e1b`。通常stagingの固定modeで本体をbuildし、各異なる成果物だけ対象照合/dry-runする。合成Worker/TEST_ONLY設定を使わず、同じcheck/ローカルHTTP/Chrome検証は繰り返さない。初期OFF/限定ON/終了OFFの3段階でbuild。生成設定へ`--env`を重ねない。

| 順序 | 配備操作 | 状態・前提 |
| --- | --- | --- |
| 1 | 初期OFF deploy 1回 | 新Worker、通常gate空/生成・upload/probe OFF、公開routeなし、workers.dev/preview無効。DB/R2/Access設定を対象照合 |
| 2 | 本人の`secret put FAL_KEY` 1回 | 初期OFF版へ対話投入。**即時deploy 1回を数える**。値は入力待ちだけで本人が貼り、コマンド/チャットへ書かない |
| 3 | 限定ON deploy 1回 | Access保護/新しいCustom Domain、固定run/slot登録・復旧準備を確認した後。専用probeだけON、通常gate/生成/uploadと他拡張はOFF。以後の生成は既に許可されたslot 1の1要求だけ |
| 4 | 終了OFF deploy 1回 | 同じ要求の必要な回収/診断/自然期限確認/消去/閉鎖後。異常時は新規受付を直ちに止め、回収不能ならこのOFFを前倒し。bindingと台帳は保持 |
| 5 | 本人の`secret delete FAL_KEY` 1回 | 必要な照合が済んだ終了OFF版から除去。**即時deploy 1回を数える**。unknownで鍵がまだ必要なら保留し、未完了と記録 |

通常は計5回の配備操作（通常deploy 3回＋Secret操作2回）。成功/失敗/中断を個別に数え、再試行や追加の配備を自動で行わない。異常時OFFは予定の1回を前倒しする。Access/Custom Domainの設定操作はこの5回と別に数える。手動追加と管理外設定のrouteを一致させてから後続buildし、再配備で専用入口を消失/置換させない。[Secret削除も即時deploy](../references/e-preflight-fal-20261005.md#新規staging案の追加仕様確認同日)であるため、従来の4回候補から終了の1回を追加した。

本人の別ターミナル用のコマンド形（対象照合・承認後に1操作ずつ案内する。今は実行しない）:

```sh
CLOUDFLARE_ENV=staging pnpm build --mode standard-staging-local
```

```sh
pnpm exec wrangler d1 migrations apply DB --remote --config .wrangler.standard-staging.local.jsonc --env staging
```

```sh
pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
```

```sh
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

```sh
pnpm exec wrangler secret put FAL_KEY --config dist/server/wrangler.json
```

```sh
pnpm exec wrangler secret delete FAL_KEY --config dist/server/wrangler.json
```

秘密投入/除去、非公開設定・対応表、本人メール/OTP・上流admin削除は本人担当。実設定と生成物を扱うbuild/クラウドCLIの出力も個別URL/実IDを含み得るため、本人の会話外端末で実施し、成功/失敗・一致/不一致・件数だけを返す。エージェントは公開手順の準備、値不要の結果照合/次操作案内・記録を担当する。実Secret操作をエージェントへ委譲しない。

### 開始・受付停止・回収・終了

1. 承認後に新リソース/空DB11本/初期OFFを整え、当該Access保護と専用入口だけを設定する。最新指示で本人認証/必要OTPは最大3回・application/policy session各6時間とする。既存IdPを優先し、必要なOTPは本人操作。新IdP設定やこの上限を超える認証/OTPは含めない。
2. 初期OFFで対象と認証が整った後、開始絶対時刻をJST/UTCで具体化する。開始を今日/初回HTTPのnowから自動で決めない。固定終了は開始＋30分。今回の未使用slot 2を登録しない。署名検証済み`/api/session`の本人ownerを本人が非公開で照合し、固定版/owner/origin/時刻/request key/input hashのrun 1行＋slot 1行を一度だけ登録する。既存行があれば停止、UPDATE/UPSERT/DELETEで作り直さない。登録SQLの実値と保管先の照合は開始前の残件。
3. 限定ON後は画面の固定内容/本人/窓/総上限2・送信可能1を確認し、1要求だけ送る。dispatch後は新規受付停止を確認し、同一jobの回収/診断だけを続ける。失敗/unknownでも生成POSTを再送しない。
4. 管理枠は実装版を使う。status最大180回/20秒以上間隔・60分、result3回、cancel1回、ACL2回、匿名GET2回、token発行4回、追加Bearer診断GET4回、token/自然期限観測各1回、停止後status3回。上流admin削除は同一要求に本人の既存の承認済み手段で最大3試行。上限は使い切る目標ではなく、不適合/unknown時は停止する。
5. 回収PNGの実byte/decode/1024角/opaque・private R2・所有者閲覧を確認し、本人が採用用途への品質を報告する。作成時ACL/匿名拒否、同じ300秒tokenの期限前正常取得/期限後拒否と新token正常取得を区別する。
6. 最初の出力観測から3600秒後に、有効な所有者tokenで自然期限を確認する。この観測までは上流を先に削除しない。診断/通信の失敗はunknownで、内部/backup全コピー消去の証拠にはしない。自然期限までの待機は今回の継続作業内で行い、automation/監視を新設しない。
7. 本人が同一要求の課金と上流admin削除結果を照合し、必要なprivate出力・本文/出力参照を早期消去する。R2物理不在/残容量と全job終端を確認後、アプリ内閉鎖1回。unknown・未終端・残容量があれば閉鎖を成功扱いにしない。
8. 当該Access Allow閉鎖1回＋当該application token失効1回＋本人logout、未認証/再ログインで遮断を確認する。共有global session/IdPや旧Accessは変更しない。終了OFFとSecret除去を行い、本人が作業用falキーを必要照合後に失効する。旧versionにSecretが残り得るため、binding除去を上流鍵失効の代わりにしない。共有鍵を対象にしない。
9. 停止時刻＋24時間以内に本人と課金/回収/自然期限/上流削除/R2不在/閉鎖/OFF/鍵失効を照合する。請求明細等が未確定なら未確定で残す。既に許可された今回の対象照合だけとし、追加送信/購入/自動補充はしない。

終了後も新Worker/D1/R2と対応表/witnessはOFF・アクセス閉鎖で保持。本文終端30日/最小台帳は閉鎖かつ全終端90日、unknownは日数で消さない。期限処理/請求の後日照合は本人を担当とする案。新Cron/automation・長期backupは作らず、後日の期限処理/撤去・再開・復元は対象を明示した別作業とする。

### 費用・承認と残件

本人の契約/利用権限・上流保持、実単価/credit/共有枠/自動補充OFF・購入不要、上流削除担当/権限の3項目確認済み申告を保持する。アカウント再照会で同じ条件を取り直さない。追加費用$1目安（硬い請求上限ではない）、新規購入0・新規プラン/座席/ドメイン購入なし。生成1枚、上記の管理操作/Workers・D1・R2・認証/OTPとOFF保持の増分を対象とし、共有枠の切上げ/他用途の帰属・確定請求の遅延は保持する。

この新規対象の作成/空DB適用・Access/専用入口設定・管理外保管・計5配備/Secret人間操作・固定run/slot登録と対象限定の終了操作は「それで進めて」で許可受領済み。認証条件は後続指示でsession各6時間/本人認証・必要OTP最大3回へ変更した。実fal1要求の許可は受領済みで再質問しない。開始絶対時刻、登録実値は未確定。許可だけで未確定値を推定せず、それに依存する操作は値不要の対象一致確認と固定時刻を受領して進める。

### 本人管理の初期準備

上記の作成・配備案は本人の「それで進めて」で許可済み。同じ承認を取り直さない。[初期OFF設定例](工程E-初期OFF設定例.jsonc)を用意した。公開5プリセット/元wranglerは変更せず、新しい公開の本人記入用テンプレートだけを追加した。これは実設定/配備成果物ではない。`REPLACE_WITH_`と`.invalid`/ゼロDB IDを全て承認済みの新対象へ本人が置換する。値はチャットや公開テンプレートへ保存しない。

1. 本人が現在のChromeで、既存stagingと同じ利用アカウント/zoneを確認し、新しい未使用hostname・新Worker名・新D1名・新private R2名を選ぶ。既存と同名/既存レコードありなら別の未使用対象にする。本人限定の対応表を承認済み保管先へ残し、実対象を固定する。
2. 同アカウントのD1から新しい空DBを1つ、R2からStandardのprivate bucketを1つ作成する。R2のpublic development URL/custom domain配信は有効にしない。新Workerは初期OFF deployで作るため、DashboardのサンプルWorkerを先に配備しない。
3. 新hostnameを対象に専用Access application/本人だけのAllow policyを1つずつ作成し、アプリ/適用policyのsessionを各1時間にする。共有IdP/global設定は変更しない。Public hostnameのpathを限定せず全pathを保護する。Worker公開経路はまだ追加しない。旧Accessは編集しない。
4. 本人が公開テンプレートを内容の参考として、新しい管理外設定をリポジトリ直下へ所有者限定で保存する。account、Worker名、origin、Access team domain/AUD、DB名/ID、bucket名だけを新対象へ置換する。`routes=[]`、通常gate空、全生成/upload/probe/他拡張OFFを保持。Secretはまだ投入しない。既存設定があれば上書きせず停止する。
5. 返答は「新DB・private R2・Access・OFF設定を用意した」または未完了の項目名だけ。実ID/hostname/メール/設定全文/端末出力は返さない。受領後、対象一致を前提に空DBへのremote migration、初期OFFのbuild/dry-run/配備を1操作ずつ案内する。これらが未実施の間、生成窓を開始しない。

固定Wranglerのinstalled schemaを読む1操作はSecret safety guardのsensitive-path拒否で中止した。変更/例外追加/別ツールでの同schema再読取は行わない。公開wrangler/既存internal-staging断片・[公式設定/Access本文](../references/e-preflight-fal-20261005.md#初期off設定例の準備同日)を根拠にした。テンプレートの限定整合確認と、本人が実値を記入した配備設定の実build/dry-run検証を区別する。

初期OFF公開例のBiome検査は1ファイル・修正なしでexit0、差分空白も問題なし。OFF条件の追加プログラム照合と新規参照点検をまとめた後続1操作もsensitive-pathで拒否されたため中止し、別経路/言換えで再実行していない。この追加照合は未検証、実設定のbuild/dry-runも未実施。拒否はクラウド権限/認証エラーとは区別する。フック/例外・実設定/キーは未変更。
