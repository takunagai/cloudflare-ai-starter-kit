# Jev B-3Jの実装前契約

2026-10-02・後続B-4: [公開設定例/build境界](公開プリセットとbuild境界.md)を別許可で実装し、全例Jev OFF/キーなし起動を検証した。本書のB-3J採用API/数値/台帳/保持/unknown契約は変更なし。以下のB-4未実施はB-3J当時の記録。C-J画面、M-0未回答、工程E前の未確定条件は残す。

確認日・採用日: 2026-10-02。本人の3組への回答で確定した契約を、同日の別のB-3J実装許可に基づいてコード化した。固定fetch adapter・3種内部service・分類POST/metadata GET・0007追加/ローカル適用・fake上流のworkerd/D1検証まで実施済み。SDK/依存追加、B-4以降、C-J画面、実接続・配備・Git送信は未実施。[工程の正本](用途別プリセット-開発計画.md)、[公式再確認](../references/jev-service-contract-20261002.md)、[実装完了の引き継ぎ](archive/B3J完了-次セッション開始プロンプト.md)を併読する。

## 決定状態と設定の管理

以下のAPI・数値・台帳は**採用済みの実装前契約**。初回設計時は3組とも回答待ちだったが、後続の同日セッションで本人がすべて推奨案の採用を明示した。設計採用、コード実装の許可、実配備済みを区別する。

本人の回答は質問1「固定4候補＋3種内部serviceを採用」、質問2「契約表の独立枠・数値上限を採用」、質問3「台帳・保持・unknown停止の案を採用」。質問2/3にはunknownが3件で環境全体を停止し得ることと、自動解除せず解決まで長期保持する影響を含む。質問UIの初期選択や経過時間ではなく、実際に受領した回答を採用根拠とする。

回答は推奨案どおりで、definition/契約版・数値・schema・予約/claim・保持条件の変更はない。本表と[進捗](plan.md)・[構成資料](architecture-proposal.md)・[用途別計画](用途別プリセット-開発計画.md)・README/索引/引き継ぎの決定状態を揃える。将来これらを変更する場合は応答紛失/保存/削除と受け入れ条件まで再照合する。採用回答と別に受領したB-3J実装許可を根拠にコード化し、上流の保持/削除・unknown修復・料金条件は未確定のまま残した。

| 状態 | 内容 | 理由・変更時の影響・管理場所 |
| --- | --- | --- |
| 採用済み・維持 | 全3用途の標準基盤、Choice/Score/Noul、チャットと独立、既定off、固定版remoteだけ | B-1の`runtime-policy.ts`と用途別計画が正本。RAG/agentや別アカウントを未接続起動の必須条件にしない |
| B-1実装・ローカル検証済み | `JEV_MODE=off\|remote`、remote時の`JEV_MODEL=jev-1.13.0`。offではmodel省略。SecretだけではONにならない | 設定判定のみ。serviceのWorkers適合や資格情報の有効性の証拠ではない |
| 質問1・採用済み | 固定4候補の分類HTTP API＋3種の内部service | 汎用公開質問APIへ広げる場合は入力/出力・悪用・費用の契約を再設計。最初の業務用途の選択とは別 |
| 質問2・採用済み | 独立Jev枠、所有者20/UTC日・5/直近60秒・同時1、環境200/UTC日・同時3、下表の全数値/入力/deadline | 既存チャット60/UTC日・同時1・10/分は維持。共有枠へ変更する場合はSQLの共通化・互換性を再検討 |
| 質問3・採用済み | 本文・結果・入力hashなしのD1要求台帳、終端から90日、結果再表示なし、不明要求の自動再送/削除/枠解放なし | 応答紛失時に結果は復元できず、unknownは消費と同時枠を保持。短期結果保存へ変更する場合は別の保存・削除契約が必要 |

上限・質問定義・契約版は`src/server/decisions/contracts.ts`の静的な定義で管理する。初版で上限を自由な環境変数や利用者入力へ公開しない。環境ごとの変更は定義・テスト・本書を一緒に更新する。`TYPESAFE_API_KEY`はremote時だけサーバーで使い、値の投入は別承認後に本人が会話外で行う。実ID・AUD・個別URL・Secretは本書に記録しない。3種の登録済みdefinitionはintent/clarity/requestで、初回HTTPはintentだけ。

## serviceとHTTP APIの契約

内部の`evaluateDecision(context, definitionId, state, requestKey)`を唯一の受付経路として実装した。contextは検証済みIdentity、対象環境のDB/設定、abort signalと受付時刻。definitionIdからサーバー登録済みの契約ID/版・質問map・入出力検証器を選ぶ。stateはdefinitionごとの検証済みテキストデータ。所有者をクライアント引数で上書きせず、直接service呼出しも設定・旧台帳・枠予約・実行直前guardを省略できない。

共通型はChoice/Score/Noulのdiscriminated union。質問ID・候補/段階・instructionsはサーバー定義だけから構築する。内部serviceを用意することは、3種の自由入力をHTTP公開することや3種すべてを初回に推論することを意味しない。

| API | 入力・応答・副作用 |
| --- | --- |
| `POST /api/decisions/classify` | strict JSON `{requestKey,input}`。固定分類1問を1回評価。初回成功200で検証済み結果・usage・契約版を返す。本文/結果は永続保存しない |
| `GET /api/decisions/requests/:requestKey` | 本人の状態・固定errorCode・受付/送信/終了時刻・保持期限・`resultAvailable:false`だけ。推論/再送/枠返却/要求台帳更新はしない。既存の読取API用rate limit counterは更新する |

一覧・取消・強制枠解除・任意endpoint/モデル/質問/候補指定・streaming APIは初版契約に含めない。チャットやWorkflowへ自動接続せず、判断結果に認可・所有権・副作用承認を委譲しない。C-Jの画面/導入例は別工程で、今回は契約の文書例だけ。

要求キーは`YYYY-MM-DD:UUIDv4`の47文字。日付はUTCの実在日、UUIDは小文字の標準表記。例示値は架空の`2026-10-02:11111111-1111-4111-8111-111111111111`。キー全体を冪等性識別子とし、日付を書き換えたキーは新しい要求になる。新規INSERTは日付がサーバーの現在UTC日と一致する場合だけ許可する。既存キーは日付を跨いでも状態確認/重複拒否が可能。履歴削除後の古いキーは日付不一致で新規実行できない。時計ずれ・日跨ぎの未受付は400 `request_day_mismatch`と現在のUTC日だけを返し、クライアントが自動で新キーへ差し替えない。

### 判定順と回復導線

1. 既存HTTPの実origin/loopback安全検査を維持。既知の新規POST入口では旧検証staging（省略/verification、enabled=falseも含む）または整合するJev OFFを404 `decision_disabled`にする。off＋model残存、空/未知mode等は整合するOFFとみなさず、下記の認証/入力後503にする。旧検証でremote指定があっても推論は開始しない。
2. ONのPOSTと状態GETは既存の認証でIdentityを確定し、未認証401。POSTはmethod405、同一Origin、JSON content type415、実body byte数413、strict schema400の順に検証。未知routeは既存JSON404、未知キー/空入力/不正要求キーは400。機能OFFの404だけをmethodより先にする。
3. GETは要求キーと所有者をSQLで確認。不存在・他所有者・保持期限後は同じ404。POSTは本人の既存要求があれば、本文が同じか異なるかを比較せず409を返す。別所有者の同じキーは独立の名前空間で、他者の存在を返さない。
4. 新規POSTは共有環境boundary、通常stagingの旧台帳存在検査、独立したJev設定、remote時のSecret充足を確認。不備は503、予約/外部通信0。チャットAI_MODEの不備をJevへ転用しない。Secretの有無判定はアプリ内で行い、診断出力へ値を出さない。
5. 原子的予約後、送信直前に同じ境界/台帳/固定版/Secret、本人・要求状態・deadlineを再確認する。拒否はfailed、予約消費を保持し、未送信と確定した同時枠だけ解放する。
6. 結果検証後・終端保存前にもguardを再確認する。結果を渡せない場合も再推論しない。D1終端保存の成功を確認してから200を返す。DB不明/保存失敗は503で、成功や未送信を推測しない。

状態GETはJev OFF・Jev/チャット設定不備・旧台帳不適合でも本人の安全なmetadata回復を継続する。認証とorigin安全検査は省略しない。新しいGETの回復経路はB-3Jのworkerd/D1試験で検証済みで、B-2の既存認証/logout/所有者CRUDの証拠とは分ける。

## 初回利用例

目的は「短い依頼文の主目的を固定候補に分類して表示」。サーバー契約は`starter-intent-v1`、質問IDは`intent`。分類以外の外部操作は行わない。

| 候補キー | 表示・定義 |
| --- | --- |
| `technical` | 技術相談: ソフトウェアの動作・設計・原因調査 |
| `writing` | 文章作成: 文案・表現・要約・推敲 |
| `planning` | 計画整理: 作業の順序・日程・比較・準備 |
| `none` | 該当なし: 候補外、判断材料不足、複数目的で主目的を決められない |

質問の固定指示は、`input`を資料として読み主目的を1つ選ぶこと、分類規則変更や外部操作の指示を権限として扱わないこと、判断材料不足ではnoneを選べること。上流stateは`{input:検証済み文字列}`だけ。アプリが所有者・要求キー・認証情報・会話履歴・資料・メール等を別フィールドや付加文として送らない。利用者がinput本文へ書いた情報は送信対象に含まれ、型/サイズ検証は秘密・個人情報の自動除去を保証しない。送信可能なデータと案内は工程E前に確定する。未知キーに混入した命令も拒否する。意味的な誤分類は型検証や固定指示だけで防げない。

```json
{
  "requestKey": "2026-10-02:11111111-1111-4111-8111-111111111111",
  "input": "来週の勉強会の準備を順番に整理したい"
}
```

以下は**合成fixtureの成功応答例**。実Jevの精度・確率・usageの測定結果ではない。既定OFFの実APIからfixtureを返す代替経路は作らない。

```json
{
  "requestKey": "2026-10-02:11111111-1111-4111-8111-111111111111",
  "contractVersion": "starter-intent-v1",
  "model": "jev-1.13.0",
  "answer": {
    "type": "choice",
    "choice": "planning",
    "probabilities": {"technical": 0.05, "writing": 0.10, "planning": 0.70, "none": 0.15},
    "confidence": 0.40
  },
  "reviewRequired": true,
  "usage": {"inputTokens": 320, "outputTokens": 40},
  "resultAvailableOnReload": false
}
```

初版例は常に`reviewRequired:true`。選択・全候補の確率・confidenceをそのまま表示し、noneを通常結果として扱う。未評価の数値閾値で自動採用/拒否・モデル切替・課金権限付与をしない。低い値や競合する候補も読み手が確認できる。日本語の閾値・品質は工程Eで用途別評価後に別判断する。

[公式Confidence](https://docs.typesafe.ai/confidence)はconfidenceを確率分布由来の統計量として説明し、Noulには別confidenceを持たせない。確認したページに厳密な計算式はないため、上流値を独自式で再計算・置換したり一致判定したりしない。上記の合成fixtureは型/数値整合を示す例で、実際のconfidence計算や日本語品質の証拠ではない。[公式の既知の限界](https://docs.typesafe.ai/model-jaggedness/jev-1.13)を踏まえ、工程Eの日本語評価には否定・複合目的・該当なし・分類規則を上書きしようとする入力を含める。日時/文字数/枠の計算はコードで行う。

## 数値上限の採用契約

| 対象 | 数値・計数方法 |
| --- | --- |
| HTTP POST本文 | 16 KiB = 16,384 bytes。Content-Lengthだけでなく読取streamの実byte数を上限化。圧縮本文は初版で受け付けない |
| 初回input | 1〜2,000 Unicode code pointsかつUTF-8 8,000 bytes以内。空白だけ・不正な単独surrogate・NULを拒否。trim/NFC変換/切詰めで入力を変更しない |
| 共通service state | JSON serialized UTF-8で8,000 bytes、深さ4まで。plain text/object/arrayのみ、URL取得・binary/data URIなし。登録definitionごとの追加検証を必須にする |
| 共通service質問 | 1〜8問/要求。初回はChoice 1問だけ。質問IDはASCII英数字/underscoreで1〜32文字、重複禁止 |
| Choice/Score | Choiceは2〜16候補、Scoreは2〜5段階。候補キー1〜32文字、指示各500 code points、説明各200 code points。Noulはyes/no説明を使う場合も各200以内 |
| 上流入力総量 | model/state/questions全体をserialized UTF-8 16,384 bytes以内に再検査。質問本文合計8,000 bytes以内も満たす。state上限と質問上限を個別充足しても合計を超えれば拒否 |
| 上流応答 | HTTP200のJSONのみ、実読取64 KiB以内、Content-Lengthを信用しない。未知フィールドは検証済みの必要項目へ投影し、HTTP/DB/ログへ転送しない |
| 待機 | HTTP受付から全処理deadline 20秒。fetch送信〜応答body読取は残時間と15秒の短い方。結果検証/終端保存の余裕を5秒確保し、余裕がなければ送信しない |
| 予約・送信lease | 予約30秒。送信claimにも30秒の期限を保存。deadline/中断で外部処理の停止・無課金を保証しない |
| 所有者枠 | 20新規予約/UTC日、直近60秒の新規予約5件、同時1件 |
| 環境枠 | 200新規予約/UTC日、同時3件。対象環境DB内の全所有者・全definition/内部入口を合算 |
| retry/fallback | アプリ/adapter/SDKの自動retry 0。redirectを追わず、別モデル/providerへfallbackしない。429/529も同一要求を自動再送しない |
| 状態GET | 所有者60要求/UTC分。既存`app_rate_limits`を専用scopeで利用し、counterだけを更新する。POSTの直近60秒枠とは異なる固定分窓。POST枠を消費せず、UI自動pollは5秒未満にしない |

文字/bytesを上流token数と同一視しない。公式の64k総context・state＋最長質問32kという制限への厳密なtoken計数は未実装/未検証。上記は小さなアプリ受付上限で、上流422を正しい成功に補正しない。公開仕様にないmax_output_tokens等は送信しない。入力量/回数制限も硬い請求額・上流停止・契約共通枠の保証ではない。

20秒はアプリが応答待機を打ち切るdeadlineであり、進行中のD1書込みを取り消す保証ではない。deadline後にDB処理が完了する場合も、遅れて復帰した処理からfetchを開始しない。予約/claimの結果不明は後の本人GETで状態だけを確認し、新しいキーや再claimで自動救済しない。GETがlease失効状態を表示するときは読取結果から算出し、要求状態の更新は認証済みPOSTの保守に限定する。GETの利用制限counter更新を要求台帳の状態更新と混同しない。

## 応答の検証と失敗分類

固定先`https://api.typesafe.ai/v1/systemone`へサーバー側fetchで接続する契約。POST/Bearer/JSON、固定版のみ。APIキーをmodel/state/questionsへ混ぜず、任意のURLやredirectへ転送しない。要求・上流error・header・stackを丸ごとログに出さない。

| 応答型 | 検証条件 |
| --- | --- |
| 共通 | 応答modelが要求固定版と完全一致。answersのID集合とtypeが登録質問と一致。usageは非負のsafe integerのinput_tokens/output_tokens。未照合を0にしない |
| Choice | choiceが候補内で最大確率の候補（同率はそのいずれか）。probabilitiesのキー集合は候補と完全一致。確率/confidenceは有限の0〜1 |
| Score | scoreは有限で0〜段階数−1。legend/確率のキーは`0`〜`n−1`、legendは登録した文字列説明と一致。scoreと確率加重平均の差は0.001以内、confidenceは0〜1 |
| Noul | type=noul、noulは有限の0〜1。別confidenceを作らず、真である確率として返す |
| 分布 | Choice/Scoreの確率合計と1の差は0.001以内。逸脱を丸め直して成功にしない。許容差は数値整合用で判断品質の閾値ではない |

Scoreの初版内部型は文字列説明だけに絞り、複雑なJSON criterionは公開しない。小さな合成fixtureを3種用意し、未知キー/欠落/余分な回答・不正数値・型の不一致を検証済み。型適合と判断の正しさは別。

| 状況 | HTTP・台帳の契約 |
| --- | --- |
| 所有者/環境の枠超過 | 429 `decision_limit_exceeded`。予約0・上流0。固定上限の状態を返し、他者の識別子/件数を返さない |
| 同じキーがreserved/submitting | 409 `decision_in_progress`、追加予約/上流0 |
| 同じキーがsucceeded/failed | 409 `decision_already_used`、追加予約/上流0。結果を再表示しない |
| 同じキーがsubmission_unknown | 409 `decision_submission_unknown`、追加予約/上流0・同時枠保持 |
| 上流401 / 422 | 503 `decision_upstream_auth` / 502 `decision_upstream_invalid_request`、failed。生の本文を返さず、キー取得/修正を自動実行しない |
| 上流429 / 529 | 503 `decision_upstream_rate_limited` / `decision_upstream_overloaded`、failed、消費保持。Retry-Afterを自動再送の許可にしない |
| 全body取得後の200 schema不正/版不一致 | 502 `decision_invalid_response`、failed、消費保持。別候補への補正なし |
| timeout/切断/Abort/非想定5xx/読取途中上限超過 | 504 `decision_timeout`または502 `decision_submission_unknown`、submission_unknown。sentの可能性があれば未課金/未実行と断定しない |
| D1/table未適用/予約・claim結果不明 | 503 `decision_ledger_unavailable`、上流開始をしない。書込み結果不明を未受付と推測して同キーを実行しない |

レスポンスはprivate/no-store。入力、質問、結果、所有者、requestKey、上流本文/URL、Secretをアプリログへ記録しない。ログは固定イベント/固定errorCodeと非識別集計のみ。実クラウドのログ/trace設定・上流ログは工程E前の別確認で、今回変更していない。

## 原子的利用枠・冪等性・要求台帳

既存`chat_requests`は本文hash/会話/履歴契約を持ちJevには合わないため、専用D1 `decision_requests`を追加する契約を採用した。実装の別許可前には新tableやSQLファイルを作らない。既存認証/Identity・環境専用DBとD1の原子的予約原則を再利用し、既存チャット台帳の行・上限・SQLを書き換えない。

| schema契約 | 列・不変条件 |
| --- | --- |
| 識別 | `owner_id TEXT`、`request_key TEXT`の複合主キー。ownerは既存Identity。キーは日付付き形式、`request_day TEXT`はキー日付と一致 |
| 契約 | `definition_id TEXT`、`contract_version TEXT`、`model_id TEXT`、`question_count INTEGER`。登録値と固定版だけ。任意入力の自由文字列を保存しない |
| 状態 | `state TEXT`のCHECK（reserved/submitting/succeeded/failed/submission_unknown）、`error_code TEXT NULL`は固定列挙、`attempt_count INTEGER`は0/1だけ |
| 時刻 | `created_at`、`reservation_until`、`sent_at NULL`、`execution_until NULL`、`finished_at NULL`、`expires_at NULL`。すべてサーバーepoch ms、状態/時刻の整合CHECK |
| 使用量 | `input_tokens INTEGER NULL`、`output_tokens INTEGER NULL`。検証済みのusageだけ。不明はNULL、0への置換なし。要求単位の消費は予約行1件で数える |
| index | `(owner_id,created_at)`、`(created_at)`、`(owner_id,state)`、`(state)`、終端の`(expires_at)`。当日/直近60秒/同時枠/期限処理の照会を限定 |
| 保存しない列 | 入力/state JSON、instructions/criteria本文、answers/選択結果/確率、入力hash、上流raw response/error、鍵/URL/認証header。結果cache用table/R2も追加しない |

`request_key`は所有者限定metadataの識別子で、所持だけでアクセス権を与えない。auth_userへの削除cascadeで利用枠を消す構成にはしない。アカウント削除/本人の削除要請とowner保持の調整は工程E前に別途確定し、本書で全件永久保持を採用しない。

### 予約と送信の順序

1. 認証・入力・boundary/Jev guard後、サーバーの同じ時刻でUTC日/直近60秒を決める。事前SELECTの件数やWorkerメモリだけでは許可しない。
2. D1 transaction/batch内で期限切れの未送信reservedだけをCASでfailedへ閉じ、期限切れsubmittingはsubmission_unknownへ移す。後者は同時枠から除外しない。期限処理は環境全体の対象を最大100行に限定し、処理残りがあれば安全に拒否できる。
3. 同一transactionの条件付きINSERTで所有者/環境の当日数、所有者の直近60秒数、両同時数、当日キー、一意性を検査しreservedを1行作る。複数SQLへ分けるなら全体を同一batchへ置く。日次/短期枠は失敗・未送信・中断も返却しない。新規行の作成成功を確認した呼出しだけが先へ進む。
4. 再guard後、owner/key/state=reserved/未失効/attempt_count=0を条件とするCASでsubmitting、attempt_count=1、sent_at/leaseを保存。変更1行が確実な場合だけfetchを1回開始する。claimのDB応答が失われた場合もfetchしない。CAS後〜fetch前の停止は送信可能性不明として扱い、自動再claimしない。
5. 応答検証・再guard・終端CASの保存成功後だけ200。完了/確実なfailedで同時枠解放、日次/短期消費は保持。終端の二重更新で消費を増減しない。期限後の遅着応答を自動で成功へ戻さず、新しい要求にも流用しない。

本文/hashを保存しないので「同ID・異なる入力」だけを識別する409契約は持たない。**同じキーは入力にかかわらず二度目を拒否**する。POST応答紛失→本人GETで状態確認→結果再表示不可を説明し、同キーを再推論しない。新キーでの再依頼は利用者の明示操作であり、再課金の可能性を示す。submission_unknownが残る間は新キーでも同時枠で拒否する。

上流のexactly-once/取消/状態取得保証は確認できていない。アプリでclaimを1回にしても、外部推論・請求がexactly-onceとは説明しない。GETや再起動でfetchを再実行せず、Workflows/queue/background replayを今回追加しない。unknownは本人/運営者が上流の終端と利用量を安全に確認し、別承認された修復で解決するまで同時枠保持。unknown3件で環境全体が止まり得るため、この保守的な停止方針も質問2/3の採用対象に含む。修復API・運用コマンドは今回作らない。

## 保持・期限・migrationの条件

- succeeded/failedは最初の`finished_at + 90 × 86,400,000 ms`をexpires_atに固定する。再読込・再POST・error確認で延長しない。期限後のGETは404、POSTは古い日付なので新規受付不可。日次消費判定の対象期間より早く行を消さない。
- reserved/submittingはlease失効を成功/未課金の証拠にしない。未送信をDB状態で確定できるreservedだけfailed、submittingはunknown。unknownはexpires_at=NULLで自動削除/解放せず、解決後の最初の終端時刻から90日。未解決の長期保持と削除要請は実接続前の運用判断として残す。
- アプリは入力・質問本文・結果を最初から永続保存しない。HTTP処理中/画面メモリには存在する。localStorage、会話履歴、R2、通知メールへの暗黙保存はしない。状態取得で結果を復元できないことをC-Jに明記する。
- 物理削除は認証済みPOSTのbounded保守で期限切れ終端行を最大100件削除する契約。GETは要求台帳の読取だけで、利用制限counter以外の状態を変えない。呼出しが止まった環境で「90日目に物理削除完了」と保証しない。厳密な削除deadlineが必要な用途は、別承認の保守手順/定期処理と停止環境の回収を設計してから実接続する。今回はautomation/Cronを追加しない。
- D1の履歴復元/backupに残るmetadata、ログ、上流の保存は別契約。backup復元後に済んだclaimや消費が巻き戻ると再送の危険があるため、復旧中はJev OFF・受付停止、復元時点以後の要求を照合するまで再有効化しない。実上流データの90日削除やZDRを保証しない。

上流については[同日の公式再照合](../references/jev-service-contract-20261002.md#採用回答再確認セッションでの再照合2026-10-02)でMCAのTelemetry/不正利用監視等の処理条項、backup残存、Privacyの必要期間保持を確認した。非学習・アプリ非保存・上流削除保証を分ける。実適用Order/DPA、本文/派生情報/backupの保持・削除、unknown照合/修復、失敗課金とcredit自動補充の有無・条件は工程E前の未確定事項。アカウント設定を今回確認・変更せず、新しい料金条件を採用していない。

必要migrationは専用1tableとindex/CHECKだけの`0007_decision_requests.sql`として追加し、既存ローカルD1へ適用した。既存0001〜0006は変更なし。M-1の番号を先に予約しない。空DBの全適用・0006からの追加適用・再適用と合成既存データ保持を実workerd/D1で検証済み。旧Workerが新tableを無視できる追加設計とし、rollbackで台帳をDROP/消去しない。未適用tableは固定503、HTTP要求中の自動schema作成はしない。

## 実装許可後の受け入れ条件

| 対象 | 必要な証拠（実施結果は実装完了の引き継ぎを参照） |
| --- | --- |
| 設定/回復 | OFF・キーだけ・固定版以外・旧検証・通常staging台帳行あり/未適用/失敗で上流0。AI/Jev独立、認証/logout/所有者CRUDと状態GETの回復 |
| 入力/3種 | UTF-8実byte/code point境界、未知キー、欠落/余分な回答、確率/Score整合/NaN、不正model/usage、redirect/巨大body、fixtureと実AI表示の区別 |
| SQL/所有権 | 実workerd/D1で並行同キー1claim、別所有者分離、20/21・5/6・200/201・同時1/3の競合境界、日跨ぎ・古いキー・初期DB/追加適用/再適用 |
| 故障 | 予約前/後/claim前/後/応答後/終端保存前でguard/DB故障。timeout/Abort/429/529/5xx・応答紛失・遅着・unknown枠保持、追加推論0 |
| 保持/復旧 | 90日境界、延長なし、bounded削除/停止環境の遅延、unknown除外、既存チャット/拡張/検証台帳保持、復元後の受付停止 |
| 統合 | 対象版のcheck/build/HTTP smoke。画面変更なら現在のChromeで操作。B-2の308/B-3の342テストや過去CIで新実装を代用しない |

標準B-3J実装の範囲を超えるC-J画面、B-4設定/build、Dの別名複製、M-1以降、Eの実接続は別工程。アカウント権限、日本語精度、契約の保持/削除、価格・失敗課金・総予算・人数/期間/終了方法はE前の条件として残す。

## M-0と今回の完了範囲

M-0の採用済み参照7日/生成30日/所有者1 GiBと初版除外を保持する。別private R2/短期取得経路、他の上限、ジョブ本文30日/本文なし利用台帳90日は[M-0の回答未受領](fal-メディア-M0差分設計.md#b-2時点の採用確認と検証待ち)のまま。本書のJev採用回答をM-0への回答や構成採用へ流用しない。fal側保持/ACL/Store-IO・実価格/権限/品質は検証待ち、Directorは対象外。

B-3Jのコード・0007・ローカル検証まで完了した。3組の採用回答と別の実装許可を受領済み。工程E前の上流の実契約/実接続検証、M-0未回答、後続工程の別許可は残条件であり、今回解消していない。本文/結果/hashの非保存、unknownの自動解除禁止、復元後のOFF/受付停止を維持する。
