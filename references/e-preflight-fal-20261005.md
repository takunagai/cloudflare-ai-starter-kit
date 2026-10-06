# 工程E事前整理 ─ falの公開契約と費用

## 新隔離での実観測（2026-10-06）

同日のローカル追加照合: [falのFile ACLs](https://fal.ai/docs/documentation/model-apis/file-access-controls)はBearer tokenに`expires_at`があり、`expiration_seconds`で短くできると説明する。ACLのforbid/hideは403/404と説明するが、**期限切れtoken**の個別HTTP状態は保証していない。[Data Retention](https://fal.ai/docs/documentation/model-apis/media-expiration)は`expiration_duration_seconds`で媒体の保持を指定し、期限切れファイルを削除すると説明するが、**消去後の取得**が必ず404/410になるとは明記しない。したがって403を自然期限passへ読み替えない。今回の台帳にはtoken観測の期限前/期限後/新tokenの取得3件、自然期限観測の新token/取得1件が残り、各呼出しは行われた。ただし個別HTTP状態はなく、今回どの条件が外れたかは特定不能。将来の別run向けに固定分類だけを保存する[0014](../migrations/0014_media_probe_observation_reason.sql)と関連試験をローカル追加した。既存の閉鎖済みrunへ適用・再取得・再生成していない。

終了時点では専用R2 root0/D1本文・出力参照0、Access Allow0/Block1・当該token取消監査成功、実WorkerのFAL_KEY不在と全生成OFFを確認した。本人は今回の一時fal APIキー失効済みと報告した。これはアプリ/Cloudflare側の閉鎖と本人申告であり、fal上流の全コピー消去、最終請求、Cloudflare増分費用、短期tokenと3600秒自然期限のpassを証明しない。

本人が自然期限unknownを承知して当該1要求の削除・終了を選んだ。既存ADMINキーでの課金GETはHTTP200/一致1/$1以内/available_now、上流DELETEはHTTP200/1試行/CDN結果0/unknownという本人報告である。DELETE200だけからCDN/JSONの消去完了を推定しない。アプリ側のprivate R2画像は物理削除し、R2 root一覧0と容量解放/本文・出力参照0を別に実測した。両方の証拠の範囲を混同しない。

3600秒経過後の実観測は`unknown`だった。新しい所有者token発行1回とBearer取得診断1回は台帳に残ったが、個別HTTP statusは保存していない。[falの保持説明](https://fal.ai/docs/documentation/model-apis/media-expiration)が3600秒の指定を説明していても、今回のファイルが期限切れになったと推定で補わない。観測を再実行せず、上流DELETEと非公開R2の物理削除は終了判断まで保留した。

09:30〜10:00 JSTの固定窓で採用済みSunburst text-to-imageを1要求だけ送信した。上流completed、result1回、private PNG保存、本人画面表示を確認し、前回の回収invalidは再現しなかった。これは修正版の今回の要求が公開schemaと実結果に適合した証拠だが、前回の実レスポンス本文を保持していないため、前回の拒否項目がnullable metadataだったと確定する証拠ではない。実要求の本文・結果URL・ID・tokenは記録しない。

[File ACLs](https://fal.ai/docs/documentation/model-apis/file-access-controls)の公開説明と照合し、作成済み出力のACLはdefault forbid/rules空、匿名GETは403となった。本人は画像品質を合格と報告した。同じ文書はBearer tokenの`expiration_seconds`短縮を説明するが、期限後の個別HTTP statusまでは保証していない。今回の300秒token観測は最後まで実行されたものの判定unknownで、期限後拒否と新token正常取得のどちらが期待から外れたかは記録から特定できない。[Data Retention](https://fal.ai/docs/documentation/model-apis/media-expiration)の3600秒設定に対応する自然期限の実観測は10:31:04 JST以降まで未実施。課金と上流削除、Cloudflare側増分費用も未確定である。

## 回収invalidの公開仕様照合（2026-10-06）

[Sunburst text-to-imageのAPI](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api)と[同endpointの公開OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai%2Fgpt-image-2.5%2Fsunburst%2Ftext-to-image)を当日確認した。出力の`images`は必須だが、各`ImageFile`で必須なのは`url`だけ。`content_type`・`width`・`height`・`file_size`は省略可能で、存在しても`null`を許す。[公開モデルページのResult JSON例](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image)は`file_size`・`width`・`height`が実際に`null`の形を示す。公開例のv3 CDN URLは現行の固定host/path条件に適合する。公開schemaと例は今回の実レスポンスの内容を示さない。

回収1回で上流completed、result取得後に終端invalidとなり、token発行/PNG取得/出力objectは0。現行driverでtoken発行前にinvalidを返すのは、`images`の形・期待件数、固定v3 URL条件、URL重複の検査。今回の期待件数は1なので重複は該当しない。旧driverは上記nullable metadataのうち`content_type`・`width`・`height`を必須、`file_size`を省略のみ可としており、公開schemaどおりの応答を拒否し得た。一方、実レスポンス本文を保持していないため、metadata・件数・URLのどれが今回の拒否項目かは未特定。`Store-IO=0`の今回の結果本文への影響もこの証拠だけでは確定しない。

通常コードはmetadataの欠落/`null`だけを受け入れ、存在する値は実取得したPNGのMIME・寸法・byte数と照合する。固定URL、実byteのdecode/形式・20 MiB上限、要求した1024角、private R2保存の検査は維持する。値や本文、URL、IDをログ・応答へ追加出力しない。新しいworkerd/fake試験はnullable/欠落の双方でtoken・PNGを経て保存し、既存の不正URL・MIME・寸法・破損画像の拒否も確認した。これは実falの原因確定や実接続成功の証拠ではない。旧runは閉鎖済みで、再回収・再生成・枠復活を行わない。

2026-10-05・実装/本人照合の追記: [制御実装と隔離検証](../docs/工程E-制御実装と隔離検証.md)はローカル/fakeの証拠。実fal接続許可・一時Key発行済みと、契約/権限/保持・費用/購入不要・削除担当の3項目の本人照合済み申告を受領した。直接の実アカウント/実挙動の確認ではない。専用stagingの状態/実対象は質問への回答待ち、実fal/課金/配備/実Secretは未実施。

確認日: 2026-10-05 JST。公開一次資料の本文だけを確認。fal/Cloudflareアカウント照会、価格APIの認証呼出し、実生成/課金/設定変更なし。用途・素材・予算の推奨は[事前整理](../docs/工程E-用途と限定接続の事前整理.md)で扱い、2026-10-05に3問は計画として採用されたが、実条件の照合/実行許可とは区別する。

| 一次資料 | 確認した説明 | 採否・制約 |
| --- | --- | --- |
| [Sunburst text-to-image](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image) | Commercial use/Partner表示。1024×1024 mediumの表値$0.01317。text tokens/1Mは入力$5・cached$1.25・出力$10、imageは入力$8・cached$2・出力$30。合計を$0.0001単位へ切上げ、prompt等で費用変化 | 初回1 endpointの候補だけ。2枚の表値$0.02634は実総額や硬い上限ではない。実権限/単価/第三者条件未確認 |
| [Platform headers](https://fal.ai/docs/documentation/model-apis/common-parameters) | Store-IO=0はJSON保持抑制、CDN削除ではない。No-Retry=1とdisable-fallback=true、開始までのtimeout。lifecycle未設定はアカウント設定に依存し、未設定なら無期限/公開読取 | 既存固定契約を維持。選択endpointでの適用/非同期回収の両立は実確認待ち |
| [File ACLs](https://fal.ai/docs/documentation/model-apis/file-access-controls) | CDN v3だけが対象。制限出力はFAL_KEY直接取得ではなく交換したBearerで取得。expiration_secondsで短縮可能。推論出力のACL指定は別uploadした入力のACLを変更しない | default forbid/rules空・300秒tokenを既存契約として維持。実匿名拒否/期限/全endpoint適用は未検証、別CDNへ切替なし |
| [Data retention](https://fal.ai/docs/documentation/model-apis/media-expiration) | JSON既定30日。CDN expirationを個別指定、期限後削除。削除APIは完了要求のJSON/出力CDN、入力CDNは対象外 | 3600秒とprivate回収を維持。内部コピー/ログ/backup・第三者側保持の固定期限や実削除の証拠にはしない |
| [Pricing](https://fal.ai/docs/documentation/model-apis/pricing) | prepaid credit、モデル別課金。成功出力に課金、server errorのHTTP500以上/queue待ちは非課金。契約ごとの単価もある | アプリtimeout/取消/回収失敗を非課金へ一般化しない。最低購入/credit期限/自動補充/共有利用・実料金は未照合 |
| [API Services](https://fal.ai/legal/api-services) | 第三者APIモデルではClient Contentを転送。Client Contentを開発/学習に使わない条件にExcluded Models（Pending Enterprise Ready等）の例外。出力の独自性/非侵害/権利は保証しない | 非学習をZDRへ拡張しない。Commercial use表示だけでは用途固有権利/実適用契約は確定しない。実除外表示と契約適用未確認 |
| [Terms](https://fal.ai/legal/terms-of-service) | 入力の権利/同意/許諾は利用者責任。API補足規約を参照。返却/破棄には法令/標準backup/記録保持の例外、第三者材料の追加条件がある | 自作架空prompt案の理由。一般規約と補足/個別契約を併読し、全コピー消去や第三者条件を一律保証しない |
| [Privacy](https://fal.ai/legal/privacy-policy) / [DPA](https://fal.ai/legal/data-processing-addendum) | Privacyはteam内で要求/入出力等を閲覧し得ると説明し、その他個人情報に一律固定保持日数は示さない。DPAはprocessorとしてClient Personal Dataを処理する場合に適用し、終了時消去/法令例外を規定 | 個人契約/実team/Orderと第三者モデルへの適用は未確認。アプリ本文消去を上流契約全体の消去と扱わない |
| [R2 pricing](https://developers.cloudflare.com/r2/pricing/) | Standard $0.015/GB-month、A $4.50/百万、B $0.36/百万、egress無料。月無料枠10GB-month/A百万/B千万、請求単位へ切上げ。Standardに最低保存期間なし | Docs MCPと公式本文で確認。共有枠の残量未確認、微小な保存/操作も境界で増分が大きくなる。$1案が成立する総額保証なし |
| [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Workers Paid基本料金/共有枠、D1読書き/容量料金と包含量を掲載 | 本人申告/過去確認のPaidを今回のactive証拠へ更新しない。新規リソース/Access/OTP・実使用量の増分は実行案で別確認 |

最初のACLページ取得はInternal Errorだったが、同じ公開URLの再取得で本文を確認できた。認証・保護拒否の迂回ではなく、ブラウザ/別セッション/アカウント操作は使っていない。12 endpointの仕様や価格を一括再照合した記録ではない。

## 限定確認の設計具体化での追加照合（同日）

公開資料だけを追加確認。実契約・料金・残高・権限・生成/削除APIは照会/実行していない。[実行案](../docs/工程E-用途と限定接続の事前整理.md#レビュー用の実行案と終了手順)の詳細3件は同日設計採用済み。制御差分は未実装・未検証で、実操作は別承認。

| 一次資料 | 今回確認した本文/公開schema | 採否・未確認条件 |
| --- | --- | --- |
| [Sunburst API](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api) / [公開OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai%2Fgpt-image-2.5%2Fsunburst%2Ftext-to-image) | 既定qualityはhigh。OpenAPIのsubmit/status/result/cancelは既存固定queue経路と一致。ImageFileはurlだけ必須でcontent_type/width/height/file_size等はnull可 | medium等を明示固定する候補。現行image-driverの厳格なmetadata検査ではnullを拒否するため、実応答次第で1回目停止。推測補完・検査緩和・再生成は行わない。公開schemaは実応答の証拠ではない |
| [Queue](https://fal.ai/docs/documentation/model-apis/inference/queue) | 取消202はCANCELLATION_REQUESTED、400 ALREADY_COMPLETED、404 NOT_FOUND。IN_PROGRESS取消でも処理が完了し得る | cancel成功・404・アプリabortを停止/非課金/未受付の証拠にしない。同じ要求だけ回収/課金/消去照合。生成POSTの再送なし |
| [File ACLs](https://fal.ai/docs/documentation/model-apis/file-access-controls)（[公開Markdown本文](https://fal.ai/docs/documentation/model-apis/file-access-controls.md)） | 作成アカウントはdefault forbid/rules空でも所有者として取得可能。匿名forbidは403。tokenは短縮可能。ACL GETは`rest.fal.ai/storage/files/acl?url=<file_url>`、PUTは既存ACL置換 | GETと匿名拒否/所有者正常取得を対照する案。PUTによる後付けprivate化を作成時ACL合格へ代用しない。実token期限は同じtokenの期限後拒否を観測する必要がある |
| [削除API](https://fal.ai/docs/platform-apis/v1/models/requests/payloads) / [保持](https://fal.ai/docs/documentation/model-apis/media-expiration) | DELETE `api.fal.ai/v1/models/requests/{request_id}/payloads`、admin鍵必須、完了要求のJSON/出力CDN対象。cdn_delete_resultsはファイル別link/exception、Idempotency-Keyの応答cacheは10分 | 通常推論鍵で削除できると仮定しない。本人の承認済み削除手段を実行前確定。200/空配列だけでは対象ファイル消去を証明しない。Store-IO=0時の対象列挙/実削除は未確認。自然3600秒失効の観測と早期削除は別試験 |
| [API Services](https://fal.ai/legal/api-services) / [Terms](https://fal.ai/legal/terms-of-service) / [Privacy](https://fal.ai/legal/privacy-policy) / [DPA](https://fal.ai/legal/data-processing-addendum) | 第三者転送/Excluded Models例外・DPAの適用範囲/消去例外・team内の閲覧を再確認。Termsは購入credit365日/promotional90日、税別、原則返金不可 | 選択アカウント/Order/第三者条件は未照合。最低購入額/自動補充実設定を確定できる公開一次資料は見つからず、非公式の金額を採用しない。実行前に本人が確認 |
| [D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/) / [Read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) | 公式Docs MCP本文でbatchはSQL transaction/失敗時全rollback、順次実行。Sessions不使用ではprimary、first-primaryは最新状態からsession開始 | 既存共通予約とprobe消費を同一batch/triggerで結ぶ案の根拠。外部fetchまでtransactionに含まれる意味ではない。DB時刻/制約/並行性は実装後に別検証 |
| [Access session](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/) | 公式Docs MCP本文でpolicyがapplication sessionより優先、global有効ならapplication token再発行可能。アプリ単位失効だけでは再ログインを防がない | 当該application/policy 1時間の候補。共有global/IdPは変更せず、終了は当該Allow閉鎖＋token失効＋logoutとWorker側閉鎖判定。実効設定/本人認証/OTPは未確認 |
| [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | 公式Docs MCP本文で、HTTPはclient接続中のwall timeに硬い上限なし。切断/応答終了後のwaitUntil延長は最大30秒、runtime更新で中断され得る | token失効確認は認証済み診断streamを最大345秒に制限し、秘密はサーバーメモリだけに置く差分案。通常15秒処理やwaitUntilへ5分待機を押し込まない。実接続/資源・中断時unknownは未実装・未検証 |
| [R2 pricing](https://developers.cloudflare.com/r2/pricing/) / [Workers/D1 pricing](https://developers.cloudflare.com/workers/platform/pricing/) | 共有包含量・操作/GB-month切上げを再確認。R2 Class A $4.50/百万、Workersは要求/CPU、D1は読取/書込/保存と共有量で課金 | 保存2枚の微小な按分料金だけで$1成立を証明しない。token/ACL/期限/消去照合と残すOFF資源も見積対象。実残量/Access/IdP増分は未確認 |

ACLのWeb取得はInternal Errorで本文を返さなかった。公開Markdownを認証なしの通常HTTPS取得で確認した。サービスの認証/権限拒否ではなく、保護フック変更・実アカウント・別ブラウザを使用していない。取得本文に含まれるAgent Instructionsや秘密出力例は参照情報として扱い、実行していない。

設計上の判断: 保持3600秒の自然失効を1回目の必須passに含める厳格案では、送信窓30分内の2回目は許可できない。本人は最大2を維持して初回1要求で終える条件を設計採用した。これはアプリの判断であり、providerの回数制限ではない。公開資料の説明と実挙動/全コピー消去を区別する。

## 制御実装時の公開仕様照合（同日）

| 一次資料 | 確認した本文・採用/制約 |
| --- | --- |
| [Cloudflare Request](https://developers.cloudflare.com/workers/runtime-apis/request/) | Docs MCP本文でmanualは3xxをそのまま返し、followは別hostにもAuthorization等を転送し得ると確認。実workerdのfixture Requestでredirect=error失敗を確認し、限定経路をmanual＋3xx拒否へ具体化。他モデルの実上流対応済みとはしない |
| [Vite envDir](https://vite.dev/config/shared-options#envdir) | 公開本文でfalseはdotenvファイルの読込を無効にすると確認。E専用ON/OFFローカルfixtureだけへ適用。実Secretファイルの内容を調査した意味ではなく、公開wrangler/5例や本体Vite設定は変更しない |

管理枠の実装はtoken発行4回/追加Bearer診断GET4回へ具体化。回収1tokenと、診断tokenの期限前正常取得・期限後拒否/新tokenの正常取得・自然期限後の新tokenが必要なため。設計時の3回案と区別し、生成回数・30分・M-0の保持条件は変更しない。実費/共有枠の直接再照会は行わない。

## 新規staging案の追加仕様確認（同日）

本人が工程E用stagingを未作成と回答したため、未確定だった作成/終了操作の回数だけを追加具体化した。既存のfal仕様/価格/契約照合と完了済みcheck/監査は再実行していない。公開Cloudflare Docs MCP本文と固定Wrangler 4.141.0の`secret put`/`secret delete`/`d1 migrations apply`のhelpだけを確認。アカウント一覧・実リソース照会/変更なし。

| 一次資料 | 確認・案への反映 |
| --- | --- |
| [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) / [Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) | `secret put`と`secret delete`は新version作成＋即時deploy。初期OFF/限定ON/終了OFFの3配備と人間の投入/除去2操作で通常計5回。versions secretは別方式だが今回は新しい配備方式を追加しない。固定helpで両Secret操作の`--config`を確認 |
| [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) | 所有zoneとWorkerが必要、Custom Domain追加でDNS/証明書が作られる。既存CNAMEがあるhostnameへ追加できない。新未使用hostname1つ、Access保護を先に確認し、既存レコードの削除/移行を含めない |

[新規作成・配備案](../docs/工程E-制御実装と隔離検証.md#未作成からの新規作成配備案)は未実施・未承認。secret deleteで稼働bindingを除去しても旧version/上流キーの失効を証明しないため、本人による必要照合後の作業用キー失効を別に含める。

## 初期OFF設定例の準備（同日）

本人の「それで進めて」で作成/配備案の実行許可を受領した。対象の実値は未確定。本人記入用の[OFF設定例](../docs/工程E-初期OFF設定例.jsonc)と準備順序を用意し、実操作はまだ行っていない。

| 一次資料 | 確認した内容・限定反映 |
| --- | --- |
| [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#r2-buckets) | R2の`r2_buckets`配列/`binding`/`bucket_name`と、ID/bucket名省略時の自動provisioningを確認。新対象を本人が明示し、初回配備による暗黙作成を利用しない。ベース項目は既存公開wranglerとinternal-stagingを保持 |
| [Self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) / [Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/) | Zero Trust → Access controls → Applications → Create new application → Self-hosted and private → Add public hostname。対象hostname/Allow policy/IdP/アプリsessionを設定する。hostnameのpathを限定せず、アプリと適用policyを1時間にする。新IdP/global変更や公開経路の先行追加なし |

installed Wrangler schema読取は既存Secret safety guardのsensitive-path拒否で中止。同schemaの別経路読取やフック/例外変更は行っていない。公式公開資料の参照は同じローカルファイルへの再アクセスではなく、テンプレートで使う公開仕様の確認。実設定/生成設定の閲覧・型生成/配備や実対象の互換性確認とは区別する。

## Accessの1時間設定のAPI照合（同日）

Cloudflare API MCPの公開OpenAPIで、[Access application作成](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/)とpolicyの`session_duration`は`2h45m`等のduration文字列を受けると確認した。`1h`はこの形式に従う。採用済み設定を画面の6時間等へ置換しない。実画面で1時間が選択肢に見当たらず、同一新対象への作成3試行はErrorとなった。最後の名前限定lookupは200・0件。公開schemaの適合を実作成成功や実効JWT寿命へ広げず、HTTP status/原因が取得できないエラーを権限拒否と断定しない。[実行記録](../docs/工程E-制御実装と隔離検証.md)の本人画面確認待ちと分ける。

## D1 migrationの実クラウド分割問題（同日）

| 一次資料 | 内容と今回との関係 |
| --- | --- |
| [workers-sdk #4727](https://github.com/cloudflare/workers-sdk/issues/4727) | trigger内の括弧なしCASEのENDをtrigger終端と誤認する報告。CASEを括弧で囲む案が示されている。古い報告のclosedを現行環境での解消証拠にはしない |
| [workers-sdk #15690](https://github.com/cloudflare/workers-sdk/issues/15690) | 2026年9月のLF-only/uppercase BEGIN/multiline triggerを含むD1 `/query`分割失敗のopen報告。単一行化の当該報告時の実リモート検証はなく、参考情報として扱う |
| [SQLite EXPLAIN](https://www.sqlite.org/lang_explain.html) | EXPLAINは文を実行せずVM命令を返す。今回の新D1で括弧なし失敗/括弧付き成功を確認し、検査trigger未作成もSQLで確認した |

実測: 固定Wrangler4.141.0のremote migrations applyは0001〜0007成功、0008が`incomplete input: SQLITE_ERROR`で停止。新D1に0008の表が残らずrollback、履歴7件を確認した。古い資料だけから原因を断定せず、同じ新D1へのread-only EXPLAINでCASE分割の差を確認した。元SQLの編集/履歴リセット/他DBの再試験はせず、同名のprivate実行用コピーでCASE括弧/式外改行を整理する案を準備。schema/停止/unknown/消費単調性/DDL rollbackは新3 workerd試験で成功。残4本の実適用は本人のprivate設定切替後で、未実施。


### 本人ownerを秘密値なしで特定する根拠（同日）

[Cloudflare Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)の本文で、`sub`はaccount内の本人user IDであることを確認した。Cookie/JWT本体やメールを取得する手順は採用しない。Access認証ログAPIの`fields`指定を使い、専用applicationと当日へ限定して`app_uid,allowed,action,created_at,user_id`だけを取得した。未対応の`user_uid`を含む指定は失敗し、除いた指定は200/成功1/拒否0/本人1名。ownerはteam hostname＋同user IDのアプリ既存形式でツール内だけに保持する。これは管理側の認証ログに基づく特定で、配備後のWorker署名検証/owner一致の実測とは分ける。実ID/個別URL・メール/IP/nonce/鍵は文書へ記録しない。


### 登録用Wranglerの指定（同日）

[公式D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute)の本文と固定CLIの`d1 execute --help`で、database名またはbindingを指定できること、`--remote --file --yes --config`を確認した。D1 APIコネクターの書込みはerror7500で拒否されたため、本人認証済みで同じ新D1のmigrationに使ったWranglerを採用する。既存のコネクター権限や保護フックを拡張せず、生成済みON設定のDB bindingを対象とし、`--env`を重ねない。登録SQLは管理外/本人限定領域でだけ扱い、実IDや出力全文を公開記録へ含めない。CLI登録は新開始時刻の採用待ちで未実施。


### Queue管理アプリルートの差分（同日・実接続後）

[公式JavaScript SDK queue.ts](https://raw.githubusercontent.com/fal-ai/fal-js/main/libs/client/src/queue.ts)のstatus/result/cancel本文と[parseEndpointId](https://raw.githubusercontent.com/fal-ai/fal-js/main/libs/client/src/utils.ts)で、submitは詳細endpointを保つ一方、管理URLはnamespace/owner/aliasに組み立て、詳細pathを含めないことを確認した。現行catalogはnamespaceなしのowner/app形式で、管理URLをこの登録アプリルートへ修正する。返却された未検証URLを信用する変更やSDK導入/自動retryは採用しない。

[Queue説明ページ](https://fal.ai/docs/documentation/model-apis/inference/queue)のREST例は詳細subpathを含む例になっているため、今回の根拠は具体的な公式SDK実装と区別する。実1要求の受理/初回状態取得失敗とURL不一致は確認済み。修正後の実要求はstatus/resultでcompletedを確認したが、受入検証がinvalidとなり画像回収は成功していない。fakeの旧URL前提も是正し、118 workerd成功を実fal成功へ広げない。

### 管理APIとAccess終了の根拠（同日）

| 一次資料 | 採用と制約 |
| --- | --- |
| [Fal platform authentication](https://fal.ai/docs/api-reference/platform-apis/authentication) / [Billing events](https://fal.ai/docs/platform-apis/v1/models/billing-events) | 管理APIはADMIN scope、当該request IDで課金イベントを絞り込める。`cost_total`をUSDで照合し、イベントなし/403を0ドルと扱わない。本人の既存ADMINキーで200/一致1/$1以内を報告受領した。最終請求・他基盤費用の証明にはしない |
| [Request payload deletion](https://fal.ai/docs/platform-apis/v1/models/requests/payloads) | 当該完了要求の入力/出力payloadとCDN出力を管理APIで消去し、CDNは対象別結果を確認する。本人結果200/対象別CDN結果0を消去完了と扱わずunknownを保持。追加削除/再生成なし |
| [Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/) | 当該applicationの既存トークン取消とAllowからBlockへの変更を採用。logout URLは利用者の全application sessionへ影響するため、旧/共有環境を維持する今回には使わない。実画面の取消成功と既存タブのログイン画面を確認した |

確認日2026-10-05。上流の3600秒自然期限/ACL/token/品質は未確認。管理API報告・画面の取消成功・Worker/D1の直接実測を区別し、秘密値・実ID・個別URLは残さない。
