# B-3J: Jev API・型付き応答・D1要求台帳の公式再確認

## B-3J実装時の再照合（2026-10-02）

公式[文書索引](https://docs.typesafe.ai/llms.txt)、[API](https://docs.typesafe.ai/api)、[Choice](https://docs.typesafe.ai/primitives/choice)、[Score](https://docs.typesafe.ai/primitives/score)、[Noul](https://docs.typesafe.ai/primitives/noul)、[Intent routing](https://docs.typesafe.ai/patterns/intent-routing)を再照合した。`.md`形式の一部取得は失敗したが通常ページの取得を完了。固定endpoint/Bearer・state/model/questions、3型のanswer/usageに採用契約の変更が必要な差異は確認しなかった。公式SDKの既定retry/backoffへ切り替えず、アプリ契約の固定版・retry0を維持した。アカウント/Legalの実適用条件・実料金/日本語品質は今回再確認していない。

ローカル実装は固定fetch/3型検証・独立要求台帳/1claim/90日/unknown停止まで完了。公式のCloudflare互換保証や実接続成功とは区別し、[対象版のworkerd/D1/fake検証](../docs/B3J完了-次セッション開始プロンプト.md)を根拠とする。以下の「新migration/コード未作成」「実装許可前」は設計セッションの履歴。

確認日: 2026-10-02。公開公式文書の読取だけ。アカウントAPI/実推論/SDK導入/Secret/実クラウドへ接続していない。[従来の標準採用記録](typesafe-jev-20261002.md)を保持し、[実装前契約](../docs/Jev-B3J-実装前契約.md)のアプリ独自の採用値と公式仕様を分ける。

## 採用回答再確認セッションでの再照合（2026-10-02）

同日の後続セッションで、索引・API・Models・Choice/Score/Noul・Intent routing・Legal/DPA/MCA/Privacy・D1 Database/Prepared Statementsを公開ページで再照合した。固定版、endpoint、型、公開単価、D1 batchの説明に契約案の変更を要する差異は確認しなかった。アカウントの契約・提供継続・実請求・実D1競合は今回も未検証。本人から3組すべての採用回答を受領し、アプリ独自のAPI/枠/全数値/台帳/保持/unknown停止契約を確定した。採用根拠は本人回答であり、公式仕様の要求や実装許可とは区別する。

| 追加で確認した公式根拠 | 確認内容と文書への反映 |
| --- | --- |
| [Confidence](https://docs.typesafe.ai/confidence) | 今回は通常ページを取得できた。Choice/Scoreのconfidenceは確率分布から計算される統計量で、Noulにはない。厳密な計算式はこのページでは確認できないため、独自式との一致を要求しない。0.5/0.9等の例を業務閾値として採用せず、合成fixtureのconfidenceを精度測定にしない |
| [Jev 1.13の既知の限界](https://docs.typesafe.ai/model-jaggedness/jev-1.13) | 文書の最終レビュー日は2026-09-17。数値計算・日時比較はコード側へ置き、敵対的なstateが分類を誘導し得ると説明している。固定指示だけで誤分類を防げるとは説明せず、日本語の否定・複合目的・分類誘導を工程Eの評価対象へ明記する |
| [MCA 4.1/4.3/10.3/10.4](https://typesafe.ai/legal/mca) | 4.1(c)はTelemetry生成・不正利用監視・法令対応の処理権限をin perpetuityと記載し、4.3はTelemetryの処理、10.3は標準backupへの残存、10.4は関連条項の存続を記載。全入力の永久保存義務とは解釈せず、一般アカウントの固定削除日数も確定できない。実適用Order/DPA・本文/派生情報/backupの削除範囲は工程E前に本人が確認する |
| [Privacy Policy / Retention](https://typesafe.ai/legal/privacy-policy) | 必要期間と、削除要請への対応・法令による長期保持を記載。通常要求の固定N日削除保証として扱わない。アプリの終端90日と上流保持を分ける |
| [MCA 8.2](https://typesafe.ai/legal/mca) | credit消費率はアカウント設定等に依存し、購入creditの自動補充はopt-in条件。実設定・残高は閲覧していない。工程E前に適用料金/失敗課金と自動補充の有無・条件を確認し、回数枠を硬い金額上限にしない |

送信対象を`{input}`に限定しても、利用者がinput本文へ書いた個人情報や秘密が自動除去される設計ではない。本人・要求キー・履歴等をアプリが別フィールドとして付加しないことと、入力内容の送信可否を区別する。今回実データは収集・送信していない。

## 上流APIと質問・応答

| 公式根拠 | 現行の事実 | アプリへの反映・留保 |
| --- | --- | --- |
| [文書索引](https://docs.typesafe.ai/llms.txt) / [HTTP API](https://docs.typesafe.ai/api) | 固定評価endpointは`POST https://api.typesafe.ai/v1/systemone`、Bearer/JSON。state/model/questionsを送り、model/answers/usageが返る。質問IDはモデルの推論材料にならない | 固定先・固定版fetchの採用契約。owner/requestKeyをstateへ入れない。任意endpointやチャットproviderへ中継しない。公式によるworkerd互換保証は未確認 |
| [Choice](https://docs.typesafe.ai/primitives/choice) | 選択候補と全候補の確率、confidence。候補は最大255、確率合計1。候補不足に備えother等を入れる | 初回は固定4候補。共通serviceの16候補上限は独自の採用値。最大確率/キー集合/有限数を検査し、品質は別評価 |
| [Score](https://docs.typesafe.ai/primitives/score) | criteriaは順序付き2〜10段階。配列位置は0始まりで、scoreは段階間の値にもなる。legend/確率/confidenceが返る | 初版内部型は文字列2〜5段階の採用契約。任意の1〜5評点や整数へ変換せず、0〜n−1と加重平均を検証 |
| [Noul](https://docs.typesafe.ai/primitives/noul) | yesの確率noulは0〜1。yes/no説明は任意。別confidenceはなく、0.5付近はyes/noが近い | booleanや程度へ自動変換しない。業務閾値を未評価で採用しない |
| [Intent routing](https://docs.typesafe.ai/patterns/intent-routing) | 分類とコードによる振分けを分離する例があり、Choice/Scoreを組み合わせている | 固定分類の形だけを参考にした。cookbookのconfidence閾値・モデル切替・担当者への通知は採用せず、最初は結果表示と人間の確認だけ |

API公式ページのエラーは401/422/429/529、429/529にはbackoffを案内している。SDKの既定retryに合わせる義務ではなく、本スターターのretry 0方針を維持する。[APIのエラー説明](https://docs.typesafe.ai/api)を根拠に固定エラーへ変換し、生の入力抜粋/error本文を返さない。汎用Idempotency-Keyの保証、評価後の状態/結果再取得、課金のexactly-once、取消完了、server側実行deadlineは読んだ公開仕様では確認できなかった。不存在と断定せず、アプリの送信claim・unknown保留・再送禁止を推奨する。

## 固定モデル・費用・データ保持

| 公式根拠 | 確認した事実 | 採否・未検証 |
| --- | --- | --- |
| [Models](https://docs.typesafe.ai/models) | 現行の固定版は`jev-1.13.0`。latest/previewは同版を指す可変alias。64k総context、state＋最長質問32k。テキスト入力のみ。料金は入力100万tokensあたり$0.042、出力無料。公称40要求/秒・100K tokens/秒は変更され得る | B-1の固定版を維持。アカウントの権限・実料金・失敗課金・特別契約は未照合。文字/bytesをtoken数へ等置しない。2,000文字・日次20/200等はアプリ独自の受付案で、公式の固定枠/請求上限ではない |
| [Modelsのデータ/言語説明](https://docs.typesafe.ai/models) | 顧客request/responseをモデル学習に使わないと説明。英語以外も扱うが同等精度を保証しない | 非学習と非保存を同一視しない。日本語評価・閾値は工程Eで別に確認 |
| [Legal](https://docs.typesafe.ai/legal) | DPA/MCA/Privacy Policyへの案内。enterprise向けZDRを案内 | 通常アカウントをZDRと扱わず、注文/適用契約を工程E前に確認 |
| [DPA](https://typesafe.ai/legal/data-processing) | 更新日2026-04-24。Schedule IのDurationは処理目的と適用法等に基づく必要期間で、一般の固定N日を示していない | 本文なしのアプリ90日保持を上流90日削除保証へ転用しない。送信可能なデータ・保存/削除条件の適合は未確定 |
| [MCA](https://typesafe.ai/legal/mca) / [Privacy Policy](https://typesafe.ai/legal/privacy-policy) | MCA更新日2026-09-23。適用関係にはOrderが含まれる。両公開ページを確認した | 特定アカウントにどのOrder/契約条件が適用されるか未確認。契約締結・同意・データ送信はしていない |

公開仕様の再確認はモデルの実提供・日本語品質・秘密値の有効性の確認ではない。実接続前に、対象版/用途/データ/人数/回数/期間/総予算/停止手順と、上流保持・不明要求の修復方法を確定する。今回新たな予算を承認済みへ変更していない。

## D1とアプリ独自の設計判断

| 公式根拠 | 事実 | 設計案と検証境界 |
| --- | --- | --- |
| [D1 Database / batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) | batchはprepared statementを順番に処理し、失敗時は全体をabort/rollbackするtransaction。Sessions APIを使わない既存経路ではprimaryへ照会する | 条件付きINSERT内で同時/日次/短期枠と一意性を検査し、CASで1回の送信権を獲得する設計契約。事前SELECTやreplicaの件数で許可しない。新SQLの原子性は実装後に実D1競合試験が必要 |
| [D1 Prepared Statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) | bindを使うSQL、firstのnull、run結果のmetadataを提供 | 値の手動連結を避け、変更1行の確認を送信条件にする。照会/書込結果不明は成功・未受付にしない。metadataのdurationを不変値として比較しない |

専用`decision_requests`、日付付き要求キー、入力hashを残さず全重複を拒否、終端90日、unknownの同時枠保持、最大100行の保守は公式の要求ではなく本プロジェクトの採用契約。初回設計では回答待ちだったが、後続セッションで本人の3組への回答を受領した。新migration/コードは実装の別許可前で未作成。M-0の媒体台帳や旧検証台帳と統合・流用しない。

## 確認の範囲

以下は初回設計セッションの取得記録。TypeSafeの`.md`形式API/Choice/Modelsはwebツールで取得できず、通常HTMLページで確認を完了した。当時はConfidence単独ページも取得できなかったため、Choice/Score/Noul各公式ページの説明を根拠にした。後続の再照合ではConfidence通常ページを取得できた（上記）。DPA/MCA/PrivacyはLegalの公式リンク先で確認し、両セッションともログイン/管理画面へ入っていない。

現行公開コードは指定された`runtime-policy.ts`、`ai-verification.ts`、`ai/catalog.ts`、`ai/providers.ts`、`chat-store.ts`と指定テストの必要箇所だけを参照した。チャットの入力hash/履歴保存をJevへ転用しない理由を確認した。全実装再読・禁止ファイル・秘密探索は行っていない。B-2の308/B-3の342テスト・当時のbuild/HTTP smokeは履歴として保持し、今回の設計や新serviceの検証結果に読み替えない。
