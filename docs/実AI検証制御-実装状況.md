# 実AI検証制御の実装状況

確認日: 2026-09-28。文書PR作成後の「進めて」を、[最小検証計画](実AI接続-最小検証計画.md)の段階A（FP8採用・制限実装・ローカル検証）の指示として作業を開始した。実AI・実配備・実D1変更・Secret投入・実メール・PRのmergeは許可範囲に追加していない。

## 現在の状態

**組込み・ローカル検証済み。実接続と実配備は未許可・未実施。** 文書のみのドラフトPR #2を維持し、別ブランチ`codex/workers-ai-verification-guards`の実装差分を、PR #2のブランチをbaseにする実装ドラフトPRへまとめる。送信・生成メタデータ・CIの結果は末尾に検証時点を明記する。

| 対象 | 状態 |
| --- | --- |
| モデル | 公開ID`workers-ai/llama-3.1-8b-fp8`・表示名・upstream IDをFP8版へ変更。旧IDは不明モデルとして拒否し、無言で転送しない |
| [検査モジュール](../src/server/ai-verification.ts) | staging・Access・拡張全OFF・固定30分窓・入力200 code units・system/履歴込み4,096 UTF-8 bytesをチャット経路で検査 |
| [migration 0006](../migrations/0006_ai_verification.sql) | 検証開始時刻・期限・所有者・消費数0〜3を保持する単一行テーブル。一時テストD1と既存のローカルD1へ適用。remote未適用 |
| 原子的な枠予約 | 会話lock・request/messages作成・総枠消費を同じD1 batch内で実施。最初の所有者に固定し、日付・会話削除・再有効化・設定開始時刻変更で枠を増やさない |
| 履歴・timeout・API | 直前の完了済みuser/assistant 2件または履歴0のみ。切詰めなし。推論直前に期限再確認し、中断は60秒と期限までの残り時間の短い方。認証済みGET `/api/ai-verification`はready/remaining/期限だけを返し、所有者IDは返さない |
| [独立テスト](../tests/ai-verification.test.ts)・[統合テスト](../tests/ai-verification-chat.test.ts) | レビューで4件追加し20件＋19件成功。全体checkは15ファイル197テスト・lint・型検査・build成功。fake binding限定 |
| Cloudflare・GitHub | 実環境操作は未実施。実装PRの作成・生成情報と最新CIの検査は今回の許可範囲 |

当初の一括編集は共通秘密保護フックに拒否された。原因調査と[限定修正案](保護フック誤検出-調査と修正案.md)のレビュー後、ユーザーが適用と構造化patchによる再開を明示承認。限定した読み取り検索だけを改善し、秘密ファイル判定・任意Pythonの判定・保護の登録・例外・baselineは維持した。設定型ソースは読まず、専用設定型を使って組み込んだ。

## 設定と影響

- `AI_VERIFICATION_ENABLED`: 明示的な`true`のみ有効候補。stagingでは未設定も拒否。公開テンプレートは`false`で、AI bindingも追加していない。
- `AI_VERIFICATION_START`: 正規のUTC ISO日時を指定し、開始から30分で失効。実開始日時は未設定。起動・再配備時の現在時刻で自動初期化しない。
- 新台帳は会話・利用者削除に連動して消さず、期限切れや日付変更でも自動削除しない。既存行と設定日時・所有者が異なると残枠0にする。初回予約transactionで行を作成して増分を記録する。管理者によるDB削除・改変まで防止するものではない。
- stagingの別provider・任意拡張経路を遮断。local/productionで検証設定を誤って有効化した場合も拒否する。検証設定なしの通常local/productionの挙動は保持する。stagingで今後別の検証を行うには、今回の制約を別途レビューして変更する必要がある。
- 管理場所は公開コード・migration・将来のWorker設定。本人限定Accessポリシーと実配備設定は引き続き本人管理とし、エージェントは実設定を閲覧・複製しない。
- 実D1への0006適用は未許可・未実施。後続の実接続許可には、この非破壊的なテーブル追加1件と適用先を含める。台帳の消去・リセットを再試行手順に含めない。

費用と対象は最小検証計画を維持する。Workers AIの`@cf/meta/llama-3.1-8b-instruct-fp8`のみ、最大3回、無料枠なしのAI約$0.016・基盤込み条件付き約$0.0353、申請目安$0.05。実測・硬い課金上限ではない。実環境・共有枠・現在の契約は未再確認。

## 検証結果と残る制約

4回目・並行4予約・残り1枠の並行予約・失敗/中断消費・会話削除・日付またぎ・設定の再適用/開始時刻変更・別所有者・旧会話・期限・入力超過・履歴超過を検証。60秒と期限直前の中断signalがfake bindingへ届き、retryしないことも確認した。予約後の履歴不適合・本文合計超過は上流0回でも枠を消費し、SSE errorで終了する。今回入力200超過・不正モデル等は予約前拒否。

ローカルpreviewのHTTP smokeは固定応答・保存・復元・同一requestのreplay・削除・logoutまで成功。ブラウザでもFP8表示/未設定、固定応答の送信、reload後の履歴復元、今回作った会話だけの削除と非復活を確認。既存会話は保持し、自分で起動したpreviewは終了した。クリック操作が反応しない場面ではキーボードで操作を確認した。実AIの逐次生成は未検証。

今回の変更25ファイルを本文の機械検査と文脈で確認し、未解決候補0件。相対リンク101件に欠落なし、`git diff --check`成功。ステージ・新コミット・外部送信は作成しておらず、今回コードのGitHub CIや生成メタデータ検査は未実施。文書PR #2の既存CI成功を今回のコードへ流用しない。

SDK中断は上流課金の即時停止保証ではない。stale予約は従来どおり120秒で失敗として回収できるが、消費数は戻らない。上流で中断が効かない場合の物理的な並行処理まで保証しない。残枠APIは状態参照用で、次の予約を確保するものではない。UIのavailable表示は設定・期限の判定であり、枠の空きや実アカウントの利用可能性を保証しない。

実接続へ進むには、実装完了後に本人の再認証、staging D1 migration 1件、AI有効化/終了時無効化の再配備計2回、最大3推論、テスト会話だけの作成/削除を別途許可する。必要なOTPメール最大1通も別途対象とする。今回のローカル作業ではいずれも実施しない。

## 2026-09-28 引き継ぎレビュー

開始時のHEADは`10329cfd3e81af38b578f6ae549e75d43e472c17`、ブランチは上記実装ブランチ。変更14件・未追跡11ファイルの計25件、ステージは空だった。既存変更を保持。GitHubはprivate、PR #1はmerge済み、PR #2はopen・draftで同じHEAD。共通Gitフックは有効、実効author/committerは`deb79d5`の匿名設定に一致し、値は表示していない。実設定と復旧フォルダは未追跡・ignore対象で、内容を扱っていない。

原子的予約、同一request IDの重複、期限前後、失敗時の消費、provider/拡張入口、local/productionへの影響をレビューした。追加4テストは並行重複の1枠消費、message書込み失敗時の台帳/lock/requestの一括rollback、履歴取得中の期限切れで上流0回、失敗履歴を省略せず拒否する動作。いずれも成功し、制限制御の追加修正は不要と判断した。transaction全体が失敗した場合は予約自体が成立せず、予約成立後の失敗では枠を返さないという区別を確認した。

Node.js 26.10.0・pnpm 12.6.0で`pnpm check`成功（lint57ファイル・型検査・197テスト/15ファイル・build）。UIコードは今回変更しておらず、ブラウザ操作は前回確認結果と区別する。公式モデル仕様・料金も再確認し、[見積り](../references/workers-ai-minimal-verification.md)を維持。共有枠・契約・実接続は未確認。

今回のbuildでローカルpreviewを起動し、HTTP smokeのSSR/asset/API、全拡張OFF、固定応答・保存・復元・replay・試験会話削除・logoutが成功。自分で起動したpreviewは停止した。通常テストは一時ローカルD1へ0006を含むmigrationを適用し、既存ローカルD1でもHTTP経路が成功。remoteへの適用は行っていない。

送信前の変更26ファイル（開始時25件と公式根拠の更新1件）を文脈と機械検査で確認し、未解決候補0件。開始HEADまでの全22コミットについて本文・メッセージと作者情報を別検査し、未解決候補0件。生成作者1件は以前の許可対象に一致。以後のステージ全体・新コミット・PR本文・新しい仮マージはそれぞれ追加検査する。検出0件を未知の非公開情報の不存在保証としない。

ステージ全体の検査で、保存用patchの空行contextが末尾空白として検出された。差分生成をcontextなしの形式へ変更し、提案の内容を維持して再生成。合成114判定と基準/候補の各12テストが成功し、設置済み共通フックのbyte一致・未変更を確認した。これは記録ファイルの整形で、フックの再適用ではない。変更文書の相対リンク106件は欠落0件。

## 実装PRの初回送信と生成情報・CI確認

実装を[65d2bb3](https://github.com/takunagai/cloudflare-ai-starter-kit/commit/65d2bb30f00bb7fe9259e9a879a29df6c095ee30)へcommitし、共通フックを通して通常push。[ドラフトPR #3](https://github.com/takunagai/cloudflare-ai-starter-kit/pull/3)を作成した。baseは文書PR #2の`codex/pr1-merge-verification`で、26ファイルの実装・関連記録差分。PR #2は先端`10329cf`・open/draftのまま、アプリ変更を混ぜていない。

| 検査の区分 | 初回headの結果 |
| --- | --- |
| ローカル公開可否 | ステージ全体、push前の全23コミットの本文・メッセージ、author/committer、PRタイトル/本文を別検査。未解決候補0件。匿名identityと共通フックを維持 |
| GitHub生成情報 | base・PR head・仮マージを新規fetchし、API先端と親・treeの一致を確認。仮マージを含む全24コミットの本文・メッセージ・作者情報は未解決候補0件。生成作者2件は既存の許可済みの同じ名前・account/service noreplyに一致 |
| ブランチCI | [push run](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36426994497)は上記実装headでcompleted・success |
| PR CI | [pull_request run](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36427029653)は同じheadでcompleted・success |

privateを再確認し、PRはdraft・未merge。実AI・Cloudflare変更・remote migration・実配備・Secret投入・実メールは今回すべて0件。次の承認対象は[最小検証計画の具体的な許可範囲](実AI接続-最小検証計画.md#レビュー完了後に求める実環境の許可範囲)へまとめた。

この結果記録の追加push後もhead/仮マージを取得し直し、同じ検査と最新headのブランチCI・PR CI確認を実施する。上記の件数・runは初回実装headの証拠であり、後続headへ流用しない。最終headの結果はPR Checksと作業完了報告で区別する。
