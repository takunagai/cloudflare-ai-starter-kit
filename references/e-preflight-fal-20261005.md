# 工程E事前整理 ─ falの公開契約と費用

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
