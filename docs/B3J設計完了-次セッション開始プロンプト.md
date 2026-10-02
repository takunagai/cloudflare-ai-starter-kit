# B-3J実装前設計の引き継ぎと開始プロンプト

確認日: 2026-10-02。推奨モデル: **gpt-6.1-sol**、エフォート: **xhigh**。設計・契約確定時点の引き継ぎを保持する。後続の明示許可でB-3J実装/ローカル検証が完了した。現在の正本は[実装完了の引き継ぎ](B3J完了-次セッション開始プロンプト.md)。

## 最新: 実装完了の正本への引き継ぎ（2026-10-02）

開始実Gitは本書の43件・HEAD・indexと一致。採用契約を変更せず固定fetch/3種service・HTTP2経路・専用0007/ローカル適用を実装し、workerd/D1＋fake上流・check/build/HTTP smokeを確認した。SDK/依存追加・B-4以降・C-J画面・メディア・Git送信・実接続/配備は未実施。M-0未回答・工程E前の未検証条件は維持。最終件数・差分保持・未実施・次の開始プロンプトは上記の実装完了文書を参照。以下の「実装許可待ち」「未実装」は契約確定セッションの履歴。

## 採用回答確認と契約確定（2026-10-02・履歴）

後続セッション開始時の実Gitは初回設計終了と一致した。main、HEAD `901a4b9db3b1278de983acb5ceb5462899f0be79`、ローカルorigin/main `66fd90f3526a52083ae79f4bd60fa9b640843c26`、index空、変更29＋未追跡14＝43件。元40件＋初回追加3文書の一覧に不足/追加なし。remote再照会なし。共通ルール6文書を実読し、共通公開保護フックのstatus3項目ともtrueを確認。設定/例外/baselineは変更していない。

本人から次の3組の採用回答をそれぞれ受領し、[実装前契約](Jev-B3J-実装前契約.md)を採用済みへ変更した。

| 採用回答 | 確定した契約と影響 |
| --- | --- |
| 質問1: 固定4候補＋3種内部serviceを採用 | 技術相談/文章作成/計画整理/該当なしの初回分類、Choice/Score/Noul。任意の公開質問API/チャット自動接続は追加しない |
| 質問2: 契約表の独立枠・数値上限を採用 | 所有者20/UTC日・5/直近60秒・同時1、環境200/UTC日・同時3。入力2,000 code points/8,000 bytes、body16 KiB、fetch15秒/全処理20秒、retry0と契約表の他の全数値。既存チャット枠とは独立 |
| 質問3: 台帳・保持・unknown停止を採用 | 本文/結果/入力hashなし、終端90日、結果再表示なし、同キー再実行拒否。unknownは消費/同時枠を保持し自動再送/削除/解放しない。3件で環境停止し得る |

推奨案から数値・schema・API範囲の変更はなく、決定状態だけを確定した。公開公式ページでAPI/3型/固定版/料金/Legal/D1を再照合し、Confidenceページの取得成功、既知のモデル限界、Telemetry/backup保持・credit自動補充の条項を[公式記録](../references/jev-service-contract-20261002.md#採用回答再確認セッションでの再照合2026-10-02)へ追記した。input本文に含まれる情報は自動除去されず送信対象になること、日本語の否定/複合目的/分類誘導の評価が必要なことを契約へ補足した。

今回更新したのは11文書だけ: `README.md`、`docs/plan.md`、`docs/architecture-proposal.md`、`docs/用途別プリセット-開発計画.md`、`docs/providers.md`、`docs/operations.md`、`docs/Jev-B3J-実装前契約.md`、本書、`references/README.md`、`references/typesafe-jev-20261002.md`、`references/jev-service-contract-20261002.md`。新規ファイルは追加しない。B-2/B-3 handoff・M-0・コード/テストを編集しない。

残条件は**実装の別許可**と、**工程E前の実適用Order/DPA・上流の本文/派生情報/backup保持/削除・unknown照合/修復・実権限/日本語品質・料金/失敗課金/credit自動補充・利用人数/総予算/期間/終了方法**。3組の採用回答待ちは解消済みだが、上流確認待ちを解消したとは扱わない。M-0の構成/追加数値/ジョブ保持は回答未受領のまま、Jevへの回答を流用しない。

コード/SDK/migration、B-4以降、新メディア、Git送信、実接続・実メール/OTP/再認証/Secret、配備/remote migration/クラウド変更/automationは未実施。サーバーを起動せず、アプリcheck/build/HTTP smoke/画面/最新CI/別名複製も再実行していない。文書点検を新serviceのworkerd適合や実クラウド動作の証拠にしない。

### 最新セッションの最終点検

更新11文書の相対リンク237件・アンカー50件は欠落/未照合0、行末空白0。見出し照合は名指しの公開28文書だけ（本文を点検する11文書を含む）で、任意リンク先/秘密ファイルを開いていない。初回は既存の歴史記録の見出し未照合で停止し、追加の公開5文書の見出しだけを名指し検索して再照合を完了した。契約書のJSON例2件はparse・日付付きUUIDv4の47文字・確率合計の整合を確認した。confidenceの独自再計算はしていない。

開始/終了の内容識別比較で43件のうち変更は上記11文書だけ、他32件はbyte同一。B-2/B-3 handoff、M-0、全コード/テスト/smokeを保持。終了のmain/HEAD/ローカルorigin/main/index空・変更29＋未追跡14とファイル一覧は開始時と同一。Node指定/依存/lockfile/0001〜0006/公開配備設定/build設定のGit差分0、git diff --check / git diff --cached --check成功。index/履歴/remoteを操作していない。

最終内容点検で3組の採用状態、API/枠/保持/schema、unknown停止・長期保持、結果再表示なし、削除遅延/復元停止、上流確認待ち、M-0未回答、実装未許可、次の開始プロンプトを照合した。残っていた「採用回答待ち」「実装前に契約確定」の現行記述を採用済みへ揃え、過去の待機記録は履歴と明示して保持。許可範囲のやり残しはない。次の実装許可・工程E前の未検証・M-0の未回答は対象外の残条件であり、今回勝手に解消していない。更新内容へ秘密値・実運用ID/管理URL/個人情報を新たに記録せず、この文書点検をGit送信前の全履歴/ステージ/PR公開可否監査の代用にしない。

以下の3組の回答待ち、元40件、当時の検査件数は初回設計セッションの履歴。現在の採用状態・43件の保持条件はこの最新節を正本とする。

## 初回設計の成果物と未決（履歴）

設計・公開公式調査・文書更新だけを完了した。[Jev実装前契約](Jev-B3J-実装前契約.md)にservice/HTTP API、固定4候補の初回利用例、3型の検証、入力/質問/timeout、所有者/環境の独立原子的枠、CASによる送信1回、本文/結果/hashなしの要求台帳schema、日付付き要求キー、終端90日・unknown・削除/復元条件、次空き番号migration案、実装後の受け入れ条件を具体化した。[公式再確認](../references/jev-service-contract-20261002.md)には現行API/Choice/Score/Noul/固定版・料金・Legal/DPA/MCA/PrivacyとD1 batchを記録した。

次の3組を本人へ質問したが回答未受領。推奨案として保存し、採用へ読み替えていない。

| 確認事項 | 推奨案・主な影響 |
| --- | --- |
| 質問1 API/初回例 | 固定分類API（技術相談・文章作成・計画整理・該当なし）＋Choice/Score/Noulの内部service。任意の公開質問API/自動振分けは追加しない |
| 質問2 独立枠/上限 | チャットと別D1枠。所有者20/UTC日・5/直近60秒・同時1、環境200/UTC日・同時3。input2,000 code points/8,000 bytes、body16 KiB、fetch15秒・全処理20秒、retry0。他のservice上限は契約表を参照 |
| 質問3 台帳/保持 | owner/要求キー/状態/時刻/usage等だけ、本文/結果/入力hashなし。終端から90日。応答紛失時の結果再表示なし、全同キーを二度目から拒否 |

unknownは消費と同時枠を保持し、自動再送/削除/解放しない案。3件で環境全体が停止し得る。解決までの長期保持/削除要請、上流の照合・修復は実接続前に運用条件を確定する。90日目の物理削除を停止環境で保証せず、bounded保守の遅延と別承認の厳密な削除手順を区別する。上流の冪等性/取消/状態取得/通常契約の固定保存日数は未確認。日本語品質・権限・実価格/失敗課金・利用人数/総予算/期間/終了方法も未決/未検証。

構成を左右する回答が来たら、3組ごとに内容を解釈して本書・契約・plan・README/索引の状態を揃える。「推奨で完遂」だけで未回答を採用済みにせず、契約確定をコード実装の許可にしない。M-0への回答にも流用しない。

## 維持した境界

- B-1のJev標準基盤・全3用途・既定off・固定版remote・チャット独立を維持。チャットモデル一覧へ混ぜず、認可や副作用承認をJevへ委譲しない。
- B-2は当時17ファイル308テスト、B-3は最終18ファイル342テストを含むcheck/最終build HTTP smoke成功。今回の設計で再実行した証拠にしない。最新CI/別名クリーン複製も未確認。
- 認証/logout/所有者の会話CRUD回復、旧検証stagingの閉鎖・指定FP8/固定30分/総3回/単一所有者/失敗消費、通常staging別Worker/別DBと内容を読まない旧台帳存在検査を維持。旧台帳削除/更新/行なしcacheによる解除をしない。
- M-0は参照7日/生成30日/所有者1 GiBと初版除外を採用済みのまま。別private R2/短期取得経路、追加数値/ジョブ本文30日・本文なし利用台帳90日は回答未受領。fal側保持/ACL/Store-IO・権限/価格/品質は検証待ち。Directorは対象外。

Jev service/API/SDK/テスト/SQL、依存/lockfile、0001〜0006、実配備設定、生成物は今回変更なし。B-4以降、メディア、commit/push/PR/merge、実接続・実メール・OTP/再認証/Secret、配備/remote migration/クラウド変更/automationは対象外で未実施。サーバーを起動していない。

## 初回設計のGitと差分保持（履歴）

開始時の実Gitは[B-3引き継ぎ](B3完了-次セッション開始プロンプト.md#git状態と差分保持)と、HEAD・index・40件のファイル一覧まで一致。main、HEAD `901a4b9db3b1278de983acb5ceb5462899f0be79`、ローカルorigin/main `66fd90f3526a52083ae79f4bd60fa9b640843c26`、index空、変更29＋未追跡11。remote再照会・index操作なし。

| 今回の差分 | ファイル |
| --- | --- |
| 元40件のうち文書8件を更新 | `README.md`、`docs/plan.md`、`docs/architecture-proposal.md`、`docs/用途別プリセット-開発計画.md`、`docs/providers.md`、`docs/operations.md`、`references/README.md`、`references/typesafe-jev-20261002.md` |
| 新規文書3件 | `docs/Jev-B3J-実装前契約.md`、`references/jev-service-contract-20261002.md`、本書 |
| 元40件の他32件 | 内容の保持を点検。コード/テスト/既存B-2/B-3 handoff/M-0を今回編集しない |

終了も同じmain/HEAD/ローカルorigin/main/index空。変更29＋未追跡14（計43）で、元40件すべてを保持し、新規3文書だけが追加された。reset/checkout破棄・履歴書換え・force-push、保護フックの変更/迂回/例外/baseline追加は禁止。Git送信前の全履歴/ステージ/PR監査を今回の文書検査で代用しない。

## 初回設計の最終点検（履歴）

更新8＋新規3の公開11文書について相対リンク225件・アンカー46件の欠落/未照合0、行末空白0、契約書内のJSON例2件のparse・要求キー47文字・確率合計の整合を確認した。見出し照合は追加の名指し公開10文書だけで、任意リンク先/秘密ファイルの本文を開いていない。初回検査は古いリンク先の見出し3件が未読込で停止し、名指し公開資料として追加照合後に全件成功した。

開始/終了の内容識別比較で元40件のうち32件はbyte同一、変化した8件は上表の文書だけ。B-2/B-3 handoff・M-0・すべての引継ぎコード/テストを含む。依存/lockfile/Node指定/0001〜0006/公開配備設定/build設定のGit差分は0。`git diff --check` / `git diff --cached --check`成功。共通公開保護フックは開始時のstatus3項目ともtrueで、設定を変更していない。

内容レビューではUTC日付キー/古いID、hash非保存/全重複拒否、unknown停止・長期保持、物理削除の遅延、DB処理完了と待機deadlineの違い、backup復元停止、採用待ちと実装未許可を点検し、必要事項を契約へ追記した。許可された設計/公式調査/文書更新に未完項目はない。本人への3組の回答、上流の実契約/品質/権限/費用、実装許可は上記の残条件であり、勝手に解消していない。

アプリのcheck/build/HTTP smoke/画面操作は文書変更だけのため再実行しない。今回の点検を新serviceのworkerd動作・最新CI・別名複製・実接続/公開可否の全履歴監査の証拠にしない。次セッション開始時に実Gitと未回答の状態を再確認する。

## 次セッション用開始プロンプト

以下は**本人が次セッションでB-3Jのコード/必要migration/ローカル検証を新たに許可する場合のテンプレート**。文書の存在・今回の契約確定は実装許可ではない。本人が実際に送る前は着手しない。実装をまだ許可しない場合は、その許可行を採用済み契約の文書確認だけへ変更する。

```text
cloudflare-ai-starter-kitを引き継ぎ、日本語で応答してください。
docs/B3J設計完了-次セッション開始プロンプト.mdの最新節とdocs/Jev-B3J-実装前契約.mdを読み、元40件と追加3文書の計43件を保持してください。最初に実Gitとの差異をファイル一覧・HEAD・indexまで報告してください。
今回は採用済み契約に沿ったB-3Jだけのコード実装・必要migration追加/ローカル適用・ローカル検証・文書更新を新たに許可します。初回は固定fetch adapterとし、SDK/依存追加が必要なら理由と影響を具体化して確認してください。
B-4以降、C-J画面、新メディア、commit/push/PR/merge、実接続/実メール/OTP/再認証/Secret、配備/remote migration/クラウド変更/automationは対象外です。外部HTTPはfakeにし、工程E前の未決を実接続で解消しません。

AGENTS.mdと共通の実ファイルを読みます：
~/.claude/rules/env-inspection.md、secret-injection.md、repository-publication.md、project-settings-notes.md、~/.agents/security/docs/git-publication-guard.md、literal-search-guard.md。
README.md、docs/plan.md、architecture-proposal.md、用途別プリセット-開発計画.md、実AI検証制御-実装状況.md、Jev-B3J-実装前契約.md、B3J設計完了-次セッション開始プロンプト.md、B3完了-次セッション開始プロンプト.md、B2完了-次セッション開始プロンプト.md、auth.md、providers.md、extensions.md、billing.md、operations.md、リポジトリ-公開情報と履歴管理.md、fal-画像動画音声-初版設計.md、fal-メディア-M0差分設計.md。
references/jev-service-contract-20261002.md、typesafe-jev-20261002.md、runtime-entry-guards-20261002.md、runtime-boundary-20261002.md、fal-media-contract-20261002.md。
開始時の公開コードはsrc/server/runtime-policy.ts、ai-verification.ts、ai/catalog.ts、ai/providers.ts、chat-store.tsとtests/runtime-policy.test.ts、extension-boundary.test.tsを名指しで読みます。実装/統合に必要な追加の公開ファイルは対象と理由を説明してから読み、全実装再読・秘密探索を行いません。

src/server/env.ts、.wrangler.staging.local.jsonc、.publication-recovery/は閲覧・複製・別経路取得禁止。環境一覧・秘密ファイル・実認証情報を扱いません。検索はrg --no-config [-n] [-A 数値] [-B 数値] -- '検索語' 明示ファイル1件だけ。編集は対象別の構造化patch。保護フック変更/迂回/例外/baseline追加と拒否されたPython一括編集の再実行は禁止です。
引き継ぎGitはmain、HEAD 901a4b9db3b1278de983acb5ceb5462899f0be79、ローカルorigin/main 66fd90f3526a52083ae79f4bd60fa9b640843c26、index空、変更29＋未追跡14（計43）。remote再照会/送信、reset/checkout破棄、履歴書換えはしません。Node26.10.0/pnpm12.6.0、lockfile、0001〜0006、配備設定を維持します。

B-3Jの3組は2026-10-02の本人回答で採用済みです。固定4候補分類API＋3種内部service、独立枠（所有者20/UTC日・5/直近60秒・同時1、環境200/UTC日・同時3）、契約表の全数値、本文/結果/hashなし台帳の終端90日・結果再表示なしを再質問せず維持します。日付付き要求キーで古いキー再実行を拒否、CAS1claim、retry0、unknown消費/同時枠保持（3件で環境停止し得る）、削除の遅延/backup復元停止も採用契約です。上流保持/削除・unknown照合/修復・実権限/料金/失敗課金/credit自動補充/日本語品質は工程E前の別確認。採用済み値の変更が必要なら理由と影響を説明して確認し、勝手に緩めません。
本文/結果/hashを永続化せず、input内の情報がそのまま上流へ送られることを明示します。confidenceを精度/権限の保証や独自再計算値にしません。新migrationは既存0001〜0006を保持して次空き番号（現候補0007）へ追加し、M-0の番号を先取りしません。unknownの自動解除/再送、rollbackでの台帳DROP、GETからの要求状態更新は追加しません。
B-2の当時308/B-3最終342テストとcheck/HTTP smokeを履歴として保持し、新serviceの検証へ流用しません。認証/logout/所有者CRUD回復、旧検証staging閉鎖・指定FP8/30分/総3回/失敗消費、通常staging別Worker/DBと旧台帳の存在だけを読むguardを維持します。
Jevは全3用途の標準基盤・既定off・固定版remote・チャット独立。認可や副作用承認を委譲せず、自動チャット接続をしません。
M-0の採用済み7日/30日/所有者1GiBと初版除外は再質問せず維持。private R2/短期取得経路、追加数値/ジョブ保持は未回答、fal上流条件は検証待ち。Jevへの回答をM-0へ流用せず、Directorは対象外です。
契約書の実装後受け入れ条件に沿い、実workerd/D1とfake上流で入力/3型・所有権・並行枠/同キー1claim・日跨ぎ・不正応答/timeout/DB故障/unknown・保持/復旧を検証してください。統合変更後のpnpm checkと対象buildのHTTP smokeを確認し、終了時に起動したサーバーを停止します。新APIに必要なmigration/ローカル適用以外の後続工程へ広げません。
許可範囲のやり残しを点検し、文書/リンク/差分保持を完了してください。採用済み・M-0未回答・工程E前検証待ち・後続未許可を分け、最後に変更/検証/未実施/実Gitと次の開始プロンプト、推奨モデル/エフォートを添えて区切ってください。
```
