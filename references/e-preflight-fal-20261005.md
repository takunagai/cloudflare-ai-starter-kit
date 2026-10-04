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
