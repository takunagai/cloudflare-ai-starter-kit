# TypeSafe AI Jevの標準基盤採用と公式調査

確認日: 2026-10-02。公式公開文書の読み取りのみ。SDK導入・APIキー取得・実推論・クラウド操作はしていない。

## 公式仕様と適用判断

| 根拠 | 確認した内容 | このスターターでの判断 |
| --- | --- | --- |
| [Introduction](https://docs.typesafe.ai/introduction) | Jevはstateと型付き質問から構造化された判断を返す。Choiceは選択、Scoreは採点、Noulは肯定の確率 | 自由文のstreaming回答を生成する既存チャットproviderとは契約が異なる。専用の型付き判断serviceを共通スターターの標準基盤として採用 |
| [HTTP API](https://docs.typesafe.ai/api) | POST `/v1/systemone`にmodel・state・questionsを送り、answersとusageを受ける。Bearer認証。429/529等がある | Workerのサーバー側HTTP adapterで接続できる見込み。ただしworkerdで未検証。固定接続先・入出力検証・timeout・呼出し上限を持たせる |
| [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) | `@typesafe-ai/sdk`、Node.js 20以上、ESM/CJSとTypeScript型を案内 | Node要件の充足をWorkers互換性と扱わない。初回はfetchによる小さなadapterを推奨し、依存追加を必須にしない |
| [Models](https://docs.typesafe.ai/models) | 確認時点は`jev-1.13.0`。latest/previewは移動する別名。英語以外も扱うが品質は同等でなく対象データでの検証が必要 | 実装時に提供状況を再確認して版を固定。日本語の分類精度・確率に基づく閾値を実接続時に評価する。型の正しさを判断の正しさと同一視しない |
| [RAG passages cookbook](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) | 検索候補を複数観点で評価し、回答モデルへ渡す内容をコードで決める例 | RAG候補の評価にも使えるが、初回からRAGを必須依存にしない |

HTTP接続の実装可能性はAPI仕様と既存サーバー構成からの設計判断であり、公式によるCloudflare Workers互換性保証を確認したという意味ではない。SDKの既定retryをそのまま採用せず、初回は自動retryなしを基準に別途契約化する。

## 採用方針と最小実装範囲

2026-10-02の本人の明示指示により、全3用途へコード・テスト・利用例・手順を標準搭載する。先に提示した「B〜D完了後の任意拡張」という推奨は撤回し、工程B〜Dの計画に含めた。設定契約の正本は[用途別開発計画](../docs/用途別プリセット-開発計画.md#標準基盤-typesafe-ai-jev2026-10-02)。チャット用モデル一覧には混ぜず、既存の認証・所有権・利用制限と接続する。

初回サンプルは「入力をサーバーで定義した候補へ分類し、選択結果と確率を表示」に絞る案。該当なしを候補に含め、判定を使う自動外部操作やチャットモデルの自動切替は追加しない。認可・所有権・人間承認をJevの判断へ委譲しない。

計画に含めた実装単位:

1. B-1/B-4: `JEV_MODE=off|remote`（既定off）、固定版`JEV_MODEL`、サーバー側`TYPESAFE_API_KEY`の設定契約と公開例。APIキーだけでは接続しない。全用途でキーなし起動を維持する。チャット用AI_MODEとは独立した停止手順を明記する。
2. B-3J/C-J: fetch adapterとZod等による応答検証、認証/所有権/利用枠を持つ最小API・分類サンプルを実装する。クライアント指定の任意endpointや無制限の質問を受け付けない。serviceのAPI・入力/質問数/利用枠の数値・要求台帳のschema/必要migrationはB-3J実装前に確定する。
3. D: workerdで外部HTTPをfake化し、OFF・未設定・不正応答・timeout・429/529・利用枠・二重送信・別所有者・他providerへのfallbackなしを検証する。旧検証専用stagingではJevも常に拒否する。別名複製で未接続時の起動と合成fixtureを確認する。
4. E: 用途・日本語評価用データ・モデル版・回数/期間・料金・送信データの扱い・終了方法を確定してから、別承認で実接続する。アカウントの利用権限、SDK依存を採る場合の固定版/ライセンス/peer、料金条件・データ保持条件は今回未評価で、実接続前に確認する。

標準搭載の方針を採用済みだが、現在の作業範囲は設計・文書更新まで。コード実装・依存導入・実接続は未実施。初回の分類サンプルは推奨案で、最初の業務用途は未選択。型付き応答の検証と、実データでの判断品質の評価を分ける。
