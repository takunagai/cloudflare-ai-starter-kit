# B-3J実装完了の引き継ぎと開始プロンプト

2026-10-02・後続B-4の別許可後: [B-4完了引き継ぎ](B4完了-次セッション開始プロンプト.md)へ現在地を引き継いだ。本書の54件・B-3J契約/検証結果とB-4開始テンプレートは当時の記録として保持する。現在の設定/buildは[設定メモ](公開プリセットとbuild境界.md)を参照。C以降・M-0/工程Eの残条件は未解消。

確認日: 2026-10-02。推奨モデル: **gpt-6.1-sol**、エフォート: **xhigh**。次はB-4の別の明示許可後。本文書の存在を後続工程の許可にしない。

## 実装・設定の管理

本人の別の実装許可に基づき、[採用済み契約](Jev-B3J-実装前契約.md)のB-3Jコード・必要migration/ローカル適用・検証・文書更新を完了した。3組を再質問せず、上限/保持/API範囲を変更していない。SDK/依存は追加していない。

| 対象 | 実装と理由・管理場所・変更時の影響 |
| --- | --- |
| 固定adapter/3型 | `src/server/decisions/adapter.ts`と`contracts.ts`。固定endpoint・jev-1.13.0・Bearer/JSON、redirect拒否、retry0。Choiceの最大確率/全候補/分布、Scoreのlegend/加重平均、Noulを検査し必要項目だけへ投影。confidenceを再計算せず、精度/認可の保証へ使わない |
| serviceの唯一受付 | `service.ts`の`evaluateDecision`。検証済みIdentity、登録済みstarter-intent/clarity/request、検証済みinputだけ。共有環境/旧台帳・独立Jev設定/Secret・本人/DB/状態/deadlineを予約前/claim前/送信前/結果保存前に再確認。全3型へ同じ制限を適用 |
| HTTP | `api.ts`/`app-api.ts`から`routes.ts`へ接続。分類POSTは固定4候補1問だけ、初回成功はreviewRequired=true。本人GETはmetadata/resultAvailable=falseだけ、Jev OFF/不備/旧台帳不適合でも回復。要求台帳はGETで更新しない。private/no-store、実origin/loopback安全検査を維持 |
| 枠/冪等性 | `ledger.ts`のD1 batch内保守と条件付きINSERT、CAS1claim、終端CAS。所有者20/UTC日・5/直近60秒・同時1、環境200/UTC日・同時3。日付付きUUIDv4の同キーは本文を比較せず二度目を拒否。終端DB保存の成功確認前に200を返さない |
| 本文なし台帳 | `0007_decision_requests.sql`の1table/18列/index/CHECK。入力/結果/hash/上流raw/鍵なし、auth_user削除cascadeなし。終端から90日、unknownは無期限の未解決状態として同時枠保持。unknown3件で環境停止し得る。自動再送/削除/解放/修復APIなし |
| timeout/保守/復旧 | 全処理20秒、fetchは15秒と残時間−5秒の短い方。DB書込みを取り消す保証はなく、遅着後にfetchを開始しない。未送信reservedだけfailed、送信claim後の不明はunknown。期限保守100件・終端削除100件を認証済み新規POSTの予約transactionで実施。停止環境の物理削除遅延、backup復元時のOFF/受付停止・照合まで再有効化禁止を維持 |

設定の正本は`runtime-policy.ts`とJev契約。JEV_MODE既定off、remote時だけ固定JEV_MODELとTYPESAFE_API_KEYが必要。資格情報だけではONにならず、上限は自由な環境変数へ公開しない。設定/定義を変える場合は契約・テスト・運用資料も更新する。実設定/実Secret投入は未実施で、管理画面の実値や個人情報を記録していない。

上流へ送るstateは検証済み`{input}`だけで、owner/requestKey/認証情報/履歴を付加しない。利用者が本文へ書いた情報は送信対象になる。型/サイズ検査は秘密・個人情報の自動除去ではない。今回は合成fixtureだけをfakeへ渡した。コードは要求/結果/識別子をログへ出さないが、ローカル開発サーバーのHTTPアクセス表示や実クラウドのログ/trace設定は別で、工程E前の確認条件を維持する。

## 検証結果と制約

Node26.10.0/pnpm12.6.0。最終`pnpm check`はexit 0、lint69ファイル・binding/route型生成と型検査・実workerd20ファイル422テスト・client/Worker build・`/help`事前生成が成功した。既存342件にB-3Jの80件を追加した。短縮した全service timeout、共通origin guardの拒否時もprivate/no-storeで認証/上流0の回帰を含む。既存のsourcemap/circular dependency警告と、Workflowの期待する故障fixture出力は残るが、検査失敗はない。

その最終buildで`pnpm smoke`はexit 0。起動したpreviewはすべてCtrl-Cで停止（exit 130）し、最終の127.0.0.1:4173へ接続不能も確認した。文書だけの最終追記後にアプリ検証を重複実行しない。

- 実workerd/D1＋fake上流: 3型/数値/未知キー/候補/版/usage、不正UTF8/単独surrogate/NUL、実body byte数、同キー並行1fetch、所有者分離、20/21・5/6・200/201・同時1/3、日跨ぎ/古いキー、401/422/429/529/redirect/5xx/64KiB/切断/Abort/timeout。
- 故障注入: 予約/claim/終端書込み前後のDB例外・応答紛失、各guard拒否、遅着予約/応答でfetch/成功0、5秒余裕確保、unknown枠保持、再POST/再読込で追加推論0。
- 保持: 90日期限後のGET404・期限延長なし、lease失効の読取表示だけ、unknown除外、保守100件/残件拒否・削除100件/残件の遅延。実backup復元やunknown照合/修復は未実施。
- migration: 別々の一時D1で空DB0001〜0007、0006からの追加適用/再適用、合成の既存会話/旧検証消費保持とCHECKを検証。既存ローカルD1へ0007だけ1件適用し、再適用0件。remote適用なし。
- build済みWorkerのHTTP smoke: SSR/help/404/asset/API、架空登録、Jev OFFとmetadata GET入口、demoチャット/stream/履歴/replay/削除/logout成功。HTTP smokeはhydration/画面操作/実Jevを保証しない。ローカルDBに架空ユーザー/利用台帳が残り、一時テストD1とは区別する。

最初のAPI試験でdispatch登録漏れを検出し修正した。空DB/追加適用試験のDB共有を検出し、専用の2つの一時bindingへ分離した。終了点検で共通origin guard拒否時のprivate指定漏れも修正し、回帰を含めて最終check/build/smokeを行った。sandboxのlisten EPERMは許可された実行方式で対処。秘密ファイルの存在確認コマンドは共通PreToolUse保護フックのsensitive-pathで拒否され、別経路で確認せず停止した。秘密ファイル本文の閲覧/複製/投入、フック/例外/baseline変更はしていない。

画面未変更でブラウザ操作なし。SDK/依存追加、audit再照会、最新CI、別名クリーン複製、B-4/C-J以降、新メディア、Git送信、実AI/メール/OTP/再認証/Secret、配備/remote migration/クラウド変更/automationは未実施。B-2の308/B-3の342テストと旧CI/旧複製結果を新実装の証拠へ流用しない。

## 差分保持と実Git

開始は設計引き継ぎと一致: main、HEAD `901a4b9db3b1278de983acb5ceb5462899f0be79`、ローカルorigin/main `66fd90f3526a52083ae79f4bd60fa9b640843c26`、index空、変更29＋未追跡14＝43件。remote再照会なし。開始43件の公開ファイルの内容識別を記録し、必要な箇所だけへ変更を重ねた。

| 今回の対象 | ファイル |
| --- | --- |
| 新規コード/SQL/テスト8件 | `migrations/0007_decision_requests.sql`、`src/server/decisions/contracts.ts`、`adapter.ts`、`ledger.ts`、`service.ts`、`routes.ts`、`tests/decisions.test.ts`、`tests/decision-faults.test.ts` |
| 既存コード/検証4件 | `src/server/api.ts`、`src/server/app-api.ts`、`scripts/app-smoke.mjs`、`vitest.config.ts`。既存B-2/B-3の条件・smokeを保持してAPI経路/合成検証を追加 |
| 既存文書12件 | `README.md`、`docs/plan.md`、`docs/architecture-proposal.md`、`docs/用途別プリセット-開発計画.md`、`docs/providers.md`、`docs/operations.md`、`docs/実AI検証制御-実装状況.md`、`docs/Jev-B3J-実装前契約.md`、`docs/B3J設計完了-次セッション開始プロンプト.md`、`references/README.md`、`references/typesafe-jev-20261002.md`、`references/jev-service-contract-20261002.md`。設計/採用時点の履歴を保持し現在地を区別 |
| 新規文書1件 | 本書。READMEと設計引き継ぎからリンク |

最終Gitはmain、HEAD/ローカルorigin/mainは開始と同じ、index空、ahead 1/behind 0（ローカル参照間）。変更31＋未追跡23＝54件。開始43件のうち29件はSHA-256が一致し、必要な14件だけへ追記/接続を重ねた。新しくstatusへ現れた11件は既存追跡2件（api.ts/vitest.config.ts）と新規9件（コード/SQL/テスト8件と本書）。index/commit/remote/履歴を操作せず、既存43件の削除/破棄なし。Node指定・依存/lockfile・0001〜0006・公開配備/build設定は保持。生成物はコマンドで生成し手編集なし。

今回更新した文書13件の相対リンク276件・Markdownアンカー60件は欠落0、行末空白0。`git diff --check`とindexの空を確認した。禁止ファイルのリンク先を開かず、公開文書/明示した公開ソースのリンクだけを検査した。

### 最終Git一覧（54件）

```text
 M README.md
 M docs/architecture-proposal.md
 M docs/auth.md
 M docs/billing.md
 M docs/extensions.md
 M docs/fal-画像動画音声-初版設計.md
 M docs/operations.md
 M docs/plan.md
 M docs/providers.md
 M docs/実AI検証制御-実装状況.md
 M docs/用途別プリセット-開発計画.md
 M references/README.md
 M references/fal-multimodel-feasibility-20261002.md
 M references/typesafe-jev-20261002.md
 M scripts/app-smoke.mjs
 M src/server/agent-tools.ts
 M src/server/ai-verification.ts
 M src/server/ai/providers.ts
 M src/server/api.ts
 M src/server/app-api.ts
 M src/server/billing.ts
 M src/server/chat-store.ts
 M src/server/chat.ts
 M src/server/extensions/images.ts
 M src/server/extensions/rag.ts
 M src/server/extensions/routes.ts
 M src/server/extensions/workflows.ts
 M tests/agent-tools.test.ts
 M tests/billing-sdk.test.ts
 M tests/providers.test.ts
 M vitest.config.ts
?? docs/B2完了-次セッション開始プロンプト.md
?? docs/B3J完了-次セッション開始プロンプト.md
?? docs/B3J設計完了-次セッション開始プロンプト.md
?? docs/B3完了-次セッション開始プロンプト.md
?? docs/Jev-B3J-実装前契約.md
?? docs/fal-メディア-M0差分設計.md
?? migrations/0007_decision_requests.sql
?? references/fal-media-contract-20261002.md
?? references/jev-service-contract-20261002.md
?? references/runtime-boundary-20261002.md
?? references/runtime-entry-guards-20261002.md
?? src/server/ai/catalog.ts
?? src/server/decisions/adapter.ts
?? src/server/decisions/contracts.ts
?? src/server/decisions/ledger.ts
?? src/server/decisions/routes.ts
?? src/server/decisions/service.ts
?? src/server/runtime-policy.ts
?? tests/decision-faults.test.ts
?? tests/decisions.test.ts
?? tests/extension-boundary.test.ts
?? tests/runtime-boundary.test.ts
?? tests/runtime-policy.test.ts
```

## 残条件と次の単位

B-3Jの許可範囲にやり残しはない。点検で見つかったdispatch・試験DB分離・timeout・cache header・古い次工程案内は対応し、影響に応じて再検証した。次の推奨はB-4の設定例/build境界だが、別の明示許可が必要。Jev全例OFF、キーなし起動、既存の旧検証staging閉鎖・通常staging別Worker/別DBを維持する。C-Jの画面/導入例、Dの複製、Eの実接続は分ける。

M-0は採用済み参照7日/生成30日/所有者1GiB・初版除外を維持。[private R2/短期取得経路、追加数値/ジョブ保持の回答未受領](fal-メディア-M0差分設計.md#b-2時点の採用確認と検証待ち)、fal上流のACL/保持/Store-IO/実価格/権限/品質は未解消。Director対象外。Jev採用回答を流用しない。

工程E前は実適用Order/DPA・本文/派生情報/backup保持/削除・unknown照合/修復/削除要請・実権限/日本語品質・料金/失敗課金/credit自動補充・人数/総予算/期間/終了方法を確認する。回数枠は硬い請求額上限ではなく、abortは上流停止/未課金の証拠ではない。今回は解消していない。

## 次セッション用開始プロンプト

以下は本人がB-4だけを別に許可して送るテンプレート。送る前は未許可。推奨モデルgpt-6.1-sol、エフォートxhigh。

```text
cloudflare-ai-starter-kitを引き継ぎ、日本語で応答してください。
docs/B3J完了-次セッション開始プロンプト.md、docs/Jev-B3J-実装前契約.md、AGENTS.md、docs/plan.md、docs/用途別プリセット-開発計画.mdを読み、最初に実Gitとの差異をHEAD・index・ファイル一覧まで報告してください。最新引き継ぎの差分54件を保持してください。

今回はB-4の公開設定例とbuild境界だけの実装・ローカル検証・文書更新を新たに許可します。正本の5例、wrangler.jsonc、vite.config.ts、必要時だけ.gitignore/Biome除外を対象に、合成設定で通常/旧modeの互換・未知mode/環境不一致/必要ファイル不在の拒否と、全例Jev OFF・キーなし起動を検証してください。固定依存を維持し、SDKを追加しません。
C-J/C以降、メディア、Git送信、実接続/実メール/OTP/再認証/Secret、配備/remote migration/クラウド変更/automationは対象外です。

共通実ファイルenv-inspection.md、secret-injection.md、repository-publication.md、project-settings-notes.md（~/.claude/rules/）とgit-publication-guard.md、literal-search-guard.md（~/.agents/security/docs/）を実読してください。
src/server/env.ts、.wrangler.staging.local.jsonc、.publication-recovery/は閲覧/複製/別経路取得禁止。環境一覧・秘密ファイル・実認証情報を扱わず、フック拒否を別経路で迂回しません。検索はrg --no-config [-n] [-A 数値] [-B 数値] -- '検索語' 明示ファイル1件だけ。対象別の構造化patchを使い、保護フック/例外/baselineを変更しません。禁止対象への変更が不可欠なら対象/理由/影響だけを提示し、無断で触りません。
Gitはmain、HEAD901a4b9db3b1278de983acb5ceb5462899f0be79、ローカルorigin/main66fd90f3526a52083ae79f4bd60fa9b640843c26、index空。remote再照会/送信、reset/checkout破棄、履歴書換えなし。Node26.10.0/pnpm12.6.0、lockfile、0001〜0007を保持します。

B-3Jは固定fetch/3型service・分類POST/metadata GET・独立原子的枠/1claim・本文/結果/hashなし台帳/終端90日/unknown停止を採用どおり実装し、workerd/D1＋fakeとcheck/build/HTTP smokeを検証済み。チャット自動接続/判断への認可委譲なし。unknownの自動再送/削除/解放、GETの要求状態更新、rollbackでの台帳DROP、復元直後の再有効化を追加しません。
B-2/B-3の認証/logout/所有者CRUD回復、旧検証staging閉鎖・固定FP8/30分/総3回/単一所有者/失敗消費、通常staging別Worker/別DBと旧台帳の内容を読まない存在guardを保持します。実環境の旧台帳を削除/更新しません。
M-0未回答と工程E前の実契約/保持/unknown修復/権限/日本語品質/実料金/自動補充/予算/人数/期間/終了方法は未解消です。Jev回答をM-0へ流用せず、Directorは対象外です。
許可範囲のやり残しを点検・対応し、必要なローカルcheck/対象buildのHTTP smoke・文書/リンク/差分保持を確認してください。起動サーバーを停止し、変更/検証/未実施/最終Gitと次の開始プロンプト、推奨モデル/エフォートを添えて区切ってください。
```
