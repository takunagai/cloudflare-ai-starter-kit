# 任意拡張の導入と確認

確認日: 2026-09-27。標準構成では `ENABLE_RAG` / `ENABLE_WORKFLOWS` / `ENABLE_IMAGES` はすべて `false`。OFFの機能は追加binding・APIキーなしで標準認証/チャットを妨げない。ここでは実装済みのRAG・長時間要約・画像生成を説明する。エージェント/決済はそれぞれの運用資料を参照する。

通常テストは追加課金なし。AI Searchの本物の索引、外部AI、falの本物の画像生成、クラウドWorkflows、公開配備はこの検証に含めていない。実接続は対象環境・モデル・回数・費用上限を決めてから行う。

2026-10-02・B-3: 通常stagingの一括404を各入口guardへ置き換えました。OFFは認証前404、ONは認証・method/input・所有権/状態を先に確認し、設定/台帳不適合を503で拒否します。RAG検索/原本操作、既存画像の受付/状態/結果/取消、承認ツール、Workflow受付/再開/承認後保存、決済の関連更新/外部処理に適用済み。AI_MODE/JEV_MODEの不備だけで独立したRAG/画像/決済を止めません。Workflow推論とチャットは明示した選択モデルが必要です。旧検証stagingの拡張404は保持し、台帳を削除して通常へ解除しません。[設定メモ](実AI検証制御-実装状況.md#2026-10-02-b-3のモデル選択と別入口統合)と[正本の入口契約](用途別プリセット-開発計画.md#判定順と台帳の扱い)を参照してください。B-4の設定/build境界と実接続は未実施です。

## 共通の準備

1. 標準認証とD1を先に設定する。ローカルはREADMEのセットアップを行い、`pnpm db:migrate:local` で `0003_extensions.sql` まで適用する。実クラウドへのmigrationは [運用手順](operations.md) に従う。ローカルで済んだmigrationを本番適用済みと扱わない。
2. 下記のbindingと公開可能な設定値だけを対象環境の `wrangler.jsonc` に追加する。環境ごとのbinding/varsは継承されないため、staging/productionを明示して設定する。サンプルの名前をそのまま実リソースとして使わない。
3. Secretは人間が会話外で投入する。[Secrets運用補足](../rules/secrets.md) とユーザー共通の秘密管理ルールに従い、実値をチャット・ソース・引数・ログへ出さない。`wrangler secret put` は配備を伴うので、単なる保存操作として実行しない。
4. 使う拡張だけ `ENABLE_*: "true"` にする。ONでも設定不足ならAPIは503の固定コードを返す。無効化時は404（アプリ入口は`feature_disabled`）。画面はサーバーから返される機能flagを参照するが、表示は台帳/実資格情報/残枠の確認結果ではない。

APIはすべて認証必須。変更リクエストは同一Originが必要で、JSON本文を検証する。APIの利用者IDはセッションから決め、資料・ジョブ・承認の所有者をSQLで確認する。クライアントに他者のIDが見えてもアクセスできない。

## RAG: 資料→R2→AI Search→引用

このサンプルはタイトルとMarkdown/プレーンテキスト本文の登録に対応する。本文50,000文字、HTTP本文200,000バイト、所有者ごと未削除100資料まで。PDF抽出・OCR・任意URLクロールは追加実装の対象で、対応済みとは扱わない。

1. 専用の非公開R2 bucketを用意し、AI Searchインスタンスのデータソースにする。R2のpublic URL/公開ドメインは有効にしない。
2. AI Searchのcustom metadata schemaに **`owner_key` (text)** と **`document_id` (text)** を登録する。索引がこれを取り込むことを少数のダミー資料で確認する。owner値はアプリが利用者IDのSHA-256（64文字）として生成する。クライアントからmetadataや検索filterを受け取らない。
3. 新しいinstance bindingを設定する。旧 `env.AI.autorag()` は使わない。

```jsonc
{
  "r2_buckets": [{ "binding": "RAG_BUCKET", "bucket_name": "YOUR_PRIVATE_BUCKET" }],
  "ai_search": [{ "binding": "AI_SEARCH", "instance_name": "YOUR_EXISTING_INSTANCE" }],
  "vars": { "ENABLE_RAG": "true" }
}
```

上の断片だけで既存varsを置換しない。AI Search instanceはdefault namespace内に事前作成する。namespace bindingはインスタンス管理権限まで持つため、このサンプルは検索対象1つのinstance bindingを使用する。

4. 画面のRAGで資料を登録する。R2へ `ownerハッシュ先頭32文字/資料UUID.md` と所有者metadataを保存し、D1で `pending_index` を返す。R2同期は非同期なので、登録直後の検索成功は保証しない。
5. 索引後に検索またはRAG付きチャットを試す。検索前にowner metadataとfolderのAND条件を付け、similarity cache/query rewriteを無効にする。返ったchunkはD1所有権・削除状態とR2 metadataを再照合する。認可後の最大5件（各4,000文字）だけを親チャットへ渡す。資料文中の命令を権限やツール実行の指示にしない。

| API | 入力/応答 |
| --- | --- |
| `POST /api/extensions/rag/documents` | `{title,text}` → `{id,title,state:"pending_index"}` |
| `GET /api/extensions/rag/documents` | `{documents:[{id,title,state,created_at}]}` |
| `GET /api/extensions/rag/documents/:id` | 所有者限定の原文。引用URLもこのAPIを指す |
| `DELETE /api/extensions/rag/documents/:id` | D1で先に削除印を付け、R2を削除。再実行可能 |
| `POST /api/extensions/rag/search` | `{query}` → `{sources,indexState}` |

検索が0件なら `empty_or_indexing`。未索引と真の0件を区別できないため、「資料が存在しない」「索引済み」と断定しない。`indexed` は少なくとも一度検索で見つかった印で、すべてのchunkの索引完了を保証する状態ではない。

削除直後もAI Search側に古いchunkが残り得るが、D1の削除印で回答から直ちに除外する。アップロード中に削除された場合も削除印を維持し、遅れて完了したR2書込みを補償削除する。アップロード成功/失敗で削除済み資料を復活させない。R2削除が失敗した場合は `RAG_DELETE_PENDING` を返し、同じDELETEを再試行できる。AI Search metadataが欠落/一致しないときは結果を除外する。**filterを外して再検索するfallbackはない。** 本番を有効にする前に、2利用者のダミー資料でmetadata反映と分離を実索引上でも検証する必要がある。

AI Searchはローカルで動かない。通常CIでは検索bindingだけfakeを使用する。開発時のremote bindingは実サービスの利用・費用を伴うため、無断で `remote: true` を追加しない。

検索は直接API/チャット共通で1所有者につきUTC日次60回まで。D1の原子的な予約を検索前に行い、失敗/timeoutも枠を消費する。応答待ちは15秒で504 `RAG_SEARCH_TIMEOUT`。bindingはAbortSignalを受け取らないため、これはアプリの待機deadlineであり、AI Search実処理や課金を停止する保証ではない。失敗時にfilterなしでの再試行や枠返却を行わない。

根拠: [新Workers binding](https://developers.cloudflare.com/ai-search/api/search/workers-binding/)、[検索filter](https://developers.cloudflare.com/ai-search/configuration/retrieval/filtering/)、[R2 custom metadata](https://developers.cloudflare.com/ai-search/configuration/data-source/r2/#custom-metadata)。

## Workflows: 要約→人間の承認→保存

1. 対象環境で主Workerの `SummaryWorkflow` exportをbindingへ結び付ける。公開用の許可モデルを1つ以上設定する。ローカルでは `local/demo`（固定応答・AI未使用）で状態遷移を確認できる。

```jsonc
{
  "workflows": [{
    "binding": "SUMMARY_WORKFLOW",
    "name": "YOUR_SUMMARY_WORKFLOW",
    "class_name": "SummaryWorkflow"
  }],
  "vars": { "ENABLE_WORKFLOWS": "true" }
}
```

2. 画面でモデルと最大8,000文字の入力を送る。受付時にモデル許可一覧を確認し、所有者とrequestIdから安定したWorkflow IDを作る。1所有者につき直近24時間に10件までをD1で原子的に予約する。
3. native `step.do` が要約する。出力上限1,024 tokens、1回のモデル呼出し60秒、SDK retryなし、step retry最大2回（初回を含め最大3回）。待機中にページを閉じてもGETで再取得できる。
4. `awaiting_approval` になったら24時間以内に承認または拒否する。所有者以外は404、期限切れ/矛盾する決定は409。決定をD1へ先に保存し、その後 `sendEvent` を送る。配送失敗は `APPROVAL_DELIVERY_PENDING` で同じ決定だけ再送可能。
5. 承認済みの要約だけを `saved_summaries` へ保存し、ジョブを `completed` にする。job IDの主キーとD1 batchにより保存処理を再実行しても1件。拒否は `rejected`、期限内に決定されなければ `expired`。

| API | 入力/応答 |
| --- | --- |
| `POST /api/extensions/workflows` | `{requestId:UUID,model,input}` → ジョブ |
| `GET /api/extensions/workflows` | `{jobs:[...]}`。所有者の直近50件 |
| `GET /api/extensions/workflows/:id` | `state,summary,decision,approvalExpiresAt,runtimeState`等 |
| `POST /api/extensions/workflows/:id/decision` | `{decision:"approve"}` または `"reject"` |

同じrequestId/内容の受付は既存jobを返す。内容を変えた再送は409。受付の応答が失われても同じIDのinstanceを取得するため、別のWorkflowを無制限に増やさない。終了/失敗後に別の処理を始めるなら、新しいrequestIdで利用者が明示的に依頼する。

外部AIが成功した直後、結果をD1に保存する前にstepが停止した場合、retryで推論が重複する可能性は残る。**最終保存の冪等性は保証するが、外部AIへの課金がexactly-onceとは保証しない。** 各推論stepで永続jobの所有者/状態・設定/台帳・選択モデルを再確認し、再試行上限で費用を制限する。新受付はownerIdを固定し、旧jobId-onlyも所有者確認stepの結果を永続化する。承認待機後の保存も最新の台帳を検査する。生成内容/上流errorをWorkflowログに流さず、所有者確認のstep出力はsensitiveにし、要約stepの戻り値は状態のみとする。

根拠: [Workers APIとretry](https://developers.cloudflare.com/workflows/build/workers-api/)、[Events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/)。

## fal.ai: 画像1枚の非同期生成

この節は現行の実装済み画像サンプルの手順。2026-10-02に追加した[画像・動画・音声12 endpointと参照画像アップロードの初版設計](fal-画像動画音声-初版設計.md)は未実装で、下記の設定だけでは利用できない。

[M-0差分設計・保存条件](fal-メディア-M0差分設計.md)にはモデル別入力、素材ID/所有権、期限付き取得、結果回収、Range再生、旧画像ジョブ互換と追加table案を具体化した。参照画像7日/生成物30日/所有者1 GiBと初版の入力範囲は設計採用済み。R2/Accessの新構成、その他の上限値と上流の保存条件は採用確認または検証待ちで、現在のbucket/経路/0001〜0006は変更していない。

1. falアカウントの利用上限を設定し、生成対象モデル・料金を確認する。`FAL_KEY` は人間がSecrets手順に従って対象環境へ設定する。
2. `ENABLE_IMAGES: "true"` を設定する。サンプルの許可モデルは **`fal-ai/flux/schnell` のみ**。512角または1024角、1枚、4 steps、safety checker ON、PNGに固定して送信する。クライアントからendpoint・枚数・APIキーを指定できない。
3. 画像UIでプロンプトを送る。D1で受付を予約してからfal queueへ送信し、受付IDと検証済みqueue URLをサーバー側に保存する。キーやqueue URLをブラウザへ返さない。
4. 状態を取得して完了後の画像を表示する。取消ボタンはfalへ取消要求を送る。

| API | 入力/応答 |
| --- | --- |
| `POST /api/extensions/images` | `{requestId:UUID,model:"fal-ai/flux/schnell",prompt,size:"square"}`。`square_hd`も可 |
| `GET /api/extensions/images` | 所有者の直近50件 `{jobs:[...]}` |
| `GET /api/extensions/images/:id` | fal状態/結果取得。`image:{url,width,height}` またはnull |
| `POST /api/extensions/images/:id/cancel` | 取消要求。停止完了の保証ではない |

1所有者につき直近24時間10件・同時処理1件。D1の単一INSERTで枠を予約するため、同時の同一requestIdもfalへ1回だけ送る。受付応答を失った場合は `submission_unknown` として同時処理枠を維持する。同じrequestIdでの再送は既存状態を返し、別requestIdの新規生成も429で拒否する。実provider IDが不明なので、運営者がfal管理画面で履歴・費用と終端状態を照合するまで自動再作成しない。照合後の管理操作で状態を解決する必要があり、利用者向けの強制解除APIは設けない。

状態は `submitting/queued/running/completed/failed/submission_unknown/cancel_requested/timed_out`。10分を超えた未完了は `timed_out` だが、fal側の処理停止を意味しない。取得・取消は引き続き可能。取消受付202は `cancel_requested` とし、処理開始済みなら完成することがある。未完了/取消待ちジョブが残っている間は同時処理枠を保持する。provider側で消失したジョブを一律成功/取消完了にせず、運用者がfal履歴を確認して対処する。

各HTTP要求は15秒で打ち切り、falへの開始期限を120秒に設定する。開始期限は推論中の実行時間を止めるものではない。外部レスポンスの任意URLへSecretを転送しないよう、queueホスト/パスと結果のHTTPS fal.mediaドメインを検証し、redirectを追わない。

**fal.media画像URLは公開アクセス可能で保存期限がある。** このサンプルのAPI/job所有権はURL自体を非公開化しない。機密画像の保管や恒久保存が必要なら、専用の非公開R2への回収・認証配信・削除ポリシーを別途設計する。サンプルは元画像を永続保存したとは扱わない。

根拠: [fal queue/取消/timeout/公開media](https://fal.ai/docs/documentation/model-apis/inference/queue)、[FLUX.1 schnell仕様](https://fal.ai/models/fal-ai/flux/schnell/api)。

## 検証の区別

```sh
pnpm exec vitest run tests/extensions-rag.test.ts tests/extensions-images.test.ts tests/extensions-workflows.test.ts
```

- **実ローカルworkerd/D1/R2**: SQL所有権、同時重複、枠予約、R2 metadata、削除印と古い検索hitの除外。
- **実ローカルWorkflows**: native step/waitForEvent/sendEvent、所有者承認、拒否、timeout注入、step一時失敗からのretry。要約モデルだけ `local/demo` 固定応答。timeout注入時はMiniflareが固定 `WorkflowTimeoutError` を出力することがある。
- **外部境界fake**: AI Search検索レスポンスとfal HTTP。実索引のmetadata schema・外部provider課金・実画像品質を証明しない。
- **明示的なstep fake**: 保存stepの重複実行を故意に行い、SQL副作用が1回であることを確認。native復旧保証と混同しない。
- **未実施**: 実Cloudflare配備、クラウドWorkflowsの障害復旧、実AI Search索引での2所有者分離、実fal受付/生成/取消/利用料金。公開前の少数staging検証として別に実施する。
