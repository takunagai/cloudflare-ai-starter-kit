# main取り込み前の最終レビューと次の用途

確認日: 2026-09-29（JST）。作成時は未承認の具体案でしたが、同日、本人がPR #2/#3の通常merge・PR #3の必要なbase変更・main同期/検査を明示承認しました。追加配備・実AI再開は含みません。全工程の現在地は[進捗](plan.md)、費用は[使用量・請求確認](実AI検証-使用量と請求確認.md)を正本とします。

## 取り込みの実行記録

PR #2はhead `10329cfd3e81af38b578f6ae549e75d43e472c17`を保ったままreadyにし、実merge `9b175082537438b96dac5401e7bce0d7a842beed`でmainへ取り込みました。実mainの全到達23コミットの検査は未解決候補0件。親は旧mainと確認済みheadに一致し、全履歴・レビューした仮マージのtree・許可済み生成作者を保持しています。[実main CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36505841198)は最後のauditで失敗し、install・check・local migration・HTTP smokeは成功しました。CI生ログは取得せず、具体的な指摘は未確認です。この版は後続のundici限定修正を含まないため、PR #3の新base CIと取り込み後main CIが成功するまで完了扱いにしません。

PR #3はbaseをmainへ調整し、この文書追記のheadで両CI・新しい仮マージ・生成情報を再確認してから通常mergeします。merge後の実main CI・履歴・tree・生成作者・手元main同期の最終結果は[PR #3本文](https://github.com/takunagai/cloudflare-ai-starter-kit/pull/3)に記録します。この文書を含むPR #3がmainに取り込まれ、同記録で完了を確認した後は、費用再照合と用途選択が残作業です。以下の対象表と「未実行」の手順見出しは取り込み前のレビュー時点の記録です。

## レビュー対象と結論

| 対象 | 現在の状態・差分 |
| --- | --- |
| main | `4f091e3698034305a77f7782d58b80559938eef9`。PR #1 merge済み |
| [文書PR #2](https://github.com/takunagai/cloudflare-ai-starter-kit/pull/2) | base main、head `10329cfd3e81af38b578f6ae549e75d43e472c17`。12文書、open・draft。初期計画とPR #1のmerge検査記録 |
| [実装PR #3](https://github.com/takunagai/cloudflare-ai-starter-kit/pull/3) | base `codex/pr1-merge-verification`、headは`codex/workers-ai-verification-guards`。引き継ぎhead `f2f7847c117b16e40222042b2140202ef7be6ade`の32ファイルと、今回の文書整理をレビュー対象にする |
| 実AI検証ソース | `7abc1696980c8d88e05452ad1ae370558a920553`。後続のundici更新は実配備していない |

最終レビューでは、限定した検証制御を妨げる追加のコード不具合は見つかりませんでした。現在状態と旧計画が混在する文書、および複製後のstaging制約の説明を修正しました。費用は取得した事実と未確認項目を分けて記録しています。PR #2単独は当時の計画の保存であり、現在の完成版の説明としてはPR #3の更新まで併せて取り込む必要があります。PR #2のheadや本文は変更しません。

| 観点 | 確認内容・結論 |
| --- | --- |
| API入口 | 状態APIを実dispatchへ登録。入口を通る200/401/405、OFF状態、近似パス404とbuild済みWorker smokeの回帰証拠がある |
| 予約・所有権 | 単一所有者・開始/終了日時・総3回を同じD1 batchで確定。並行要求・同一ID重複・message書込失敗の一括rollbackを既存テストで確認 |
| 消費・期限 | 成立した予約の失敗/中断/不適合履歴は消費を保持。会話削除・日付変更・設定の再適用で枠を復活させない。履歴取得後にも期限を再確認 |
| 外部境界 | stagingは指定FP8のみ、全拡張OFF、200 code units/4,096 bytes/1往復/1,024 output tokens、retry 0・step 1。SDK中断を課金停止保証にはしない |
| 通常構成 | 検証設定のないlocal/productionは通常経路。stagingは常に検証制約の対象で、フラグfalseでも通常運用へ解除されない |
| migration | 0006は独立テーブル追加、既存schemaを破壊しない。remote追加は既に1件完了、台帳保持。再適用・リセット不要 |
| 依存 | 2つの依存元のみundici 7.29.1へoverride。直接依存・Node/pnpm・監査方針は維持。上流修正後にoverrideの要否を再評価 |
| 文書 | 古い見出し/アンカーと履歴を保持し、現在の工程表・次作業・検証版の区別・READMEの導線を追加。旧「後処理中」見出しは完了本文へのリンクを維持 |

## 検証証拠と残る制約

- 引き継ぎhead `f2f7847c`の[push CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36498907896)・[PR CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36498912029)は同じheadでcompleted・successを再取得して確認。固定install、check（201テスト/15ファイル）、local migration、HTTP smoke、auditが対象です。
- PR #2のhead `10329cf`も[push CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36386816438)・[PR CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36386821028)成功を現在のAPIで確認しました。
- 引き継ぎの新規fetchではmain/#2/#3と両仮マージの全到達30コミットを現行検査実装で検査。本文・メッセージ・PRタイトル/本文・作者の未解決候補0件、生成情報3コミットは以前許可された同じ作者情報に一致。両PRのAPI先端・親・tree・生成作者との一致、匿名identityと共通フック有効も確認しました。後続pushの新しい検査は別に実施します。
- 今回は文書変更のため、既に成功した全アプリテスト・build・実AI・実メールを理由なく再実行しません。lint・空白・リンク/アンカー・公開可否検査を行い、追加push後は最新headの両CIを確認します。上記runを追加commitの成功証拠へ流用しません。
- 文書整理後のローカルlintは57ファイル成功、`git diff --check`成功。追跡文書と今回の新規文書36ファイルで相対リンク236件・アンカー44件の欠落0件を確認しました。これらは文書の検査で、最新ソースのクリーン複製や新しい実接続の証拠ではありません。
- 過去のクリーン複製は157テスト・0001〜0005の版です。最新HEADのクリーン複製成功とは扱いません。後続CIのfresh checkoutとfrozen install・6 migration・Worker smokeは、名称変更した別プロジェクトのブラウザ検証とは区別します。
- 実token数、他provider、Better Authの実メール/Google OAuth、任意拡張の実接続、productionは未検証です。未選択項目は今回の取り込みを一律に妨げる条件にはしません。
- 費用の未解決点は、AIのモデル別/課金対象Neuronsが内訳不明、Analyticsが対象日/試験窓でデータなし、対象期の確定請求が未取得であることです。共有Workers/D1の課金対象量と途中従量コストは確認できましたが、試験単独の最終費用は分離不能・未確定として保持します。後日の読み取り条件は費用記録へ明記しました。

## 複製手順への影響

READMEのローカル起動順は維持します。最新ソース・`pnpm-workspace.yaml`・lockfile・0001〜0006を一緒に持ち込み、frozen installと空のローカルDBへのmigrationを実施します。0006だけを手で抜いたり、overrideを落として旧undiciへ戻したりしません。既存の実配備設定・復旧フォルダ・DB・生成物・Secretsは複製しません。

モデルの公開IDはFP8へ変更済みで、旧IDへの無言fallbackはありません。複製先のstagingも今回の固定検証制約が適用されます。標準チャットや任意拡張を継続的にstagingで試す用途では、新しい検証方針をコード・費用・認証境界と共に設計し、local/fakeで確認してから実環境操作を別途承認します。今の台帳を削除・開始日時を変える方法で回避しません。

最新版の複製を実施する時点で、固定install→名称変更/format→6 local migration→check→dev/smokeと必要な画面操作を確認します。その用途が選ばれる前に全検証を繰り返すことは必須にしません。

## 推奨する取り込み順（未実行）

この見出しは旧リンク・手順の保存用です。2026-09-29に承認を受領して実行へ移っており、現在の確定結果は冒頭の実行記録とPR #3本文を参照してください。

1. 本人が**PR #2とPR #3の通常merge、PR #3の必要なbase変更、main同期/検査**の具体的範囲を承認します。private・匿名作者・履歴保持・ブランチ保持を前提とし、Cloudflare変更や実AI再開は含めません。
2. 直前にmain/#2/#3のheadを再取得。レビューしたheadに変化があれば追加差分をレビューします。最新仮マージを新しい検査refへ取得し、本文・メッセージ・作者・API先端/親/treeと両CIを確認。必要なら承認範囲でdraftをreadyへ変更し、生成情報を再確認します。
3. PR #2を確認済みheadの一致条件付きで通常のmerge commitとしてmainへ取り込みます。squash/rebase/force-pushは用いません。実mergeの親、main先端、履歴保持、生成作者とmain push CIを別検査します。
4. PR #3のbaseを再取得します。GitHubがmainへ変更している場合もAPIで確認し、旧文書ブランチのままなら**承認されたbase変更**をmainへ実施します。baseが文書ブランチのままmergeするとmainへの取り込みにならないため、その状態ではmergeしません。ブランチ削除に依存しません。
5. base調整後の差分が実装と今回の整理に限定されること、head不変、最新仮マージ/生成情報、PR CIと同じheadのpush CIを再確認します。新baseでのPR CI未生成・未完了・失敗なら取り込みを保留します。
6. PR #3を確認済みheadに限定して通常merge。main・PR参照を新規取得し、実mergeの親/履歴、レビュー済みtreeとの一致（mainの並行変更があればその解決を再レビュー）、本文・メッセージ・作者・実main先端のpush CIを検査します。手元mainは検査済み先端へfast-forwardのみで同期します。

未解決の公開候補・検査不能・CI失敗・予期しない先端変更は停止条件です。取り込み後の追加配備は自動実行しません。現在のローカル`dist/`は公開テンプレートのローカル検証用で、staging配備成果物へ流用しません。

## 取り込み後の用途別選択肢

| 最初の用途 | 次に具体化する作業 | 今は実施しない接続 |
| --- | --- | --- |
| ローカル学習・個人試作 | 最新版を別名へ複製し、全拡張OFF・固定応答で画面/履歴を確認。必要ならLM Studioのlocalhost実接続を選ぶ | 外部AI・配備・実メールは不要 |
| 個人/社内利用（Access） | 許可する利用者・保護範囲・セッション・所有権・1つのprovider・予算を設定メモに確定。新しいstaging方針をレビューし、承認された最小接続のみ検証 | 現在の残り1枠、追加OTP/配備を自動で使わない |
| Better Authの公開サービス | 複製先の送信ドメイン・本人によるSecret投入・実メールの回数/宛先、登録/確認/再設定/ログアウト/認可を検証。Googleは必要時だけ追加 | production公開・DNS・実送信は別承認 |
| 必要な任意拡張 | RAGの実索引/削除、tool承認と実モデル選択、Workflows復旧、Polar sandbox、fal.ai画像1枚から必要なものだけ選ぶ | 全拡張・全providerの一括実接続は不要 |

用途選択は別プロジェクトの公開・契約・課金・リソース作成の包括許可ではありません。選んだ接続のモデル・回数・期間・費用・終了方法を具体化して進めます。
