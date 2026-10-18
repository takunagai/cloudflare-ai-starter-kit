# 現在地と次の作業

更新日: 2026-10-18。再開時の入口はこの文書。実クラウドの最終確認は2026-10-06で、今回再照会していない。2026-10-08にCodexからClaude Codeへ担当を引き継いだ。ローカルD1は0015まで適用済み。

## 成果物と残件

| 対象 | 確認済みの範囲 | 残件・制約 |
| --- | --- | --- |
| 共通スターター | 認証・モデル切替・チャット・履歴、Jevの判断API/画面、用途別の導入例を実装。D-2の当該版で複製を検証 | 全providerの実接続を完了した意味ではない |
| 任意拡張 | RAG・agent・Workflows・Polar・fal、メディア12モデルと素材/ジョブ管理を実装。M-5の当該版で統合/隔離複製を検証 | 実モデルの一律検証・通常生成の解放は未完了 |
| 工程Eの限定fal接続 | 10月6日の1要求で画像のprivate保存、本人品質、ACL/匿名拒否を確認。終了処理も完了 | 短期token・自然期限はunknown、M-0条件未達。最終費用・上流消去完了は未確定 |
| 失敗理由の診断 | 回収拒否と観測不明の固定分類を追加し、関連ローカル試験済み | 0014と診断修正は未配備。過去runの原因を後から確定できない |
| 最初の用途別複製 | 別プロジェクトへ複製し、本人1名・Access保護の通常stagingで実配備と受入まで完了（複製先の記録）。踏んだ注意点を[運用手順](operations.md#複製先の実配備で確認した注意点)へ、確認項目を[公開前チェック](launch-checklist.md)へ反映 | 複製先固有の機能・運用状態は複製先自身の文書で管理する。公開向け（Better Auth＋実メール）の実績はない |
| 複製先からの逆輸入 | private-rag-chat（2026-10-06複製、Ver.0.1運用中）の差分を分類。Wave 1（CIシェル修正、source-map-js/sharpのoverride、画像fixtureのbeforeAll）と Wave 2（チャット要求台帳・復旧: 0015で`inference_started`/`failure_code`、`GET /api/chat/requests/:id`、ブラウザの要求ID記録と再送抑止、`api()`の失敗分類）を取り込み、check・audit 0件・preview smokeを確認。復旧UIはdevのブラウザで、成功後の応答消失（再読込→確認カード→台帳照合→履歴復元）と推論前失敗（照合→「入力を再開」→記録消去→送信可能）の2経路を実測し、その際に見つけた受付記録APIの振り分け漏れを修正。通常stagingの`/help`をSSRにする`prerenderHelpFor`も採用。設計は[チャット設計](chat.md#要求台帳と再送2026-10-08複製先private-rag-chatから逆輸入)、根拠は[CI依存](../references/ci-dependencies-20261008.md) | RAG専用（rag-*、trial台帳、rag_sync、索引UI）は逆輸入しない。0015は実環境に未配備。複製先の`src/server/api.ts`にも同じ振り分け漏れがある見込みで、複製先のセッションで確認が要る |
| コード構成 | 共通の実行時ガードを`runtime-guards.ts`へ分離（2026-10-09、動作変更なし） | `ai-verification.ts`は旧検証の判定に加え、汎用の`chatSystemPrompt`と`VerificationEnv`（`RuntimeEnv`の別名）を持ち、chat・chat-store・providers・decisionsから参照される。旧検証の廃止は下のTODO。複製先とのファイル差分が増える。複製先へは同期しない |
| 依存 | 2026-10-18にaudit critical 2件（TanStack Startの反射型XSS、GHSA-qx66-fv34-fjm8）を受け、メジャー更新を除く直接依存を更新し、効いていないoverride 3件を削除。audit 0件、check（47ファイル929件）、preview smokeを確認。根拠は[依存更新の記録](../references/dependency-update-20261018.md) | 未commit・CI未確認・未配備。vitest 5、@polar-sh/sdk 1.0、`compatibility_date`は見送り。同じ版を使う複製先は未修正の見込み |
| 文書配置 | 2026-10-18に役目を終えた文書を[docs/archive/](archive/README.md)へ、工程Eの操作scriptを`scripts/archive/e/`へ移し、相対リンクを張り替えた（リンク切れ0件）。完了済みのhandover 2本は、複製先のVaultアーカイブに同一原文があることを確認してtrashした | `docs/plan.md`は被参照が多いため移動していない |

## 今回の改善と有効な許可

本人の2026-10-07「推奨の順序で進めて」に基づき、通常作業の終了条件、文書の分離、許可の再利用、質問/次の行動の案内、ソース名の誤検知、失敗時の診断手順を改善し、文書確認と保護フックの回帰検証を完了した。今回の変更は対象ごとのリポジトリで管理する。通常の実作業での時間短縮と応答品質の評価は残る。

クラウド変更、実AI/メール/決済、実Secret、旧runの再実行/枠復活、commit/pushは今回の改善範囲に含めない。以前の固定時刻・回数付きの実行許可は完了済みで、新しい実行へ流用しない。

共通のモデル設定は変更しない。Codex担当時の主な利用モデルは本人報告でGPT-6.1 Sol、高〜極高。2026-10-08以降はClaude Codeが担当する。今回の改善による時間短縮は実運用で評価し、設定ファイルや文書の変更だけで実証済みにしない。

## 次に進めること

### TODO

- [ ] 2026-10-18の依存更新と文書整理をcommitし、GitHub CIを確認する。commit/pushは本人の依頼を受けてから行う
- [ ] 旧検証モード（ai-verification）を廃止する（2026-10-18決定、次のセッションで実装）。本人の選択は「構造の分離にとどめず、旧検証モードを廃止する」。動作が変わる変更なので、次の手順と完了条件で進める
	1. 汎用品を移す: `chatSystemPrompt`はchat側へ、`VerificationEnv`は`RuntimeEnv`へ置き換える
	2. 旧検証の判定（`verificationScope`、`verificationSettings`、`checkVerificationInput`、`verificationStatus`）と`/api/ai-verification`を削除する。削除後の`/api/ai-verification`は未知APIとしてJSONの404を返す
	3. `runtime-policy.ts`の`verification`種別をなくし、`STAGING_POLICY`を省略したstaging（既存の`staging-local`を含む）を固定の理由コードでfail-closedにする。`AI_VERIFICATION_*`が残っている設定は、引き続き拒否する
	4. 着手前に本人へ確認する論点: 通常stagingの`requiresVerificationLedgerCheck`（0006の台帳がtableあり・行なしであることの確認）を残すか。0006のtableはmigrationなので削除しない
	5. tests（`ai-verification*.test.ts`、runtime-boundary・extension-boundary・providersの該当部分）、`scripts/app-smoke.mjs`、`wrangler.jsonc`の`AI_VERIFICATION_*`、README・operations・構成資料の旧検証の記述を更新する
	6. 完了条件: `pnpm check`、preview smoke、`/api/ai-verification`の404、`STAGING_POLICY`省略時のfail-closed、通常stagingとlocalの回帰をworkerdで確認する。配備済みの旧staging Workerは再配備するまで影響を受けず、再配備は別承認とする
- [ ] 複製先private-rag-chatへ、TanStack StartのXSS修正（react-start 1.168.60以上）と、受付記録APIの振り分け漏れの確認を伝える。複製先のセッションで実施する。必要なら複製先の`handover/`に指示書を置く
- [ ] 見送った更新（vitest 5、@polar-sh/sdk 1.0、`compatibility_date`）を、変更履歴とworkerdの動作変更を確認して別作業で行う
- [ ] 公開向け（Better Auth＋実メール）の最初の用途を決める（2026-10-09登録）。個人・社内向けは複製先で実配備まで済んだが、公開向けは実績がない。決まったら用途・provider・予算・送信ドメインを具体化し、工程E/F（公開向け）へ進む。入口は[公開サービス向けに準備する](presets/public.md)と[公開前チェック](launch-checklist.md)

今回の改善結果と検証は[開発運用の改善記録](development-workflow.md)を参照する。次は実際の通常作業で、担当エージェントが確認範囲・所要時間・再質問・手戻りを点検する。今回の変更を記録する場合は、本人からコミットの依頼を受けて各リポジトリの対象差分だけを扱う。測定のためだけのコミットや実接続は行わない。

工程Eを再実行する場合は、担当エージェントが[診断と次の確認](diagnostics.md)に沿って新しい対象・回数・費用・終了方法を具体化し、未許可の実操作だけ本人へ確認する。現状のOFF・閉鎖状態を維持する。

## 必要なときだけ読む資料

- 合意した仕様: [構成と受け入れ条件](architecture-proposal.md)。仕様変更時に該当節だけ読む。
- 設定・操作: [運用手順](operations.md)、[公開プリセットとbuild境界](公開プリセットとbuild境界.md)。対象環境を操作するときに読む。
- 証拠: [D-2](D2-実行記録と再開.md)、[M-5](M5-メディア統合と隔離複製検証.md)、[工程E](工程E-制御実装と隔離検証.md)。検証版や未解決の論点を照合するときに読む。
- 過去の経緯: [開発履歴](plan.md)、[構成資料の旧版](archive/architecture-history.md)、[READMEの旧版](archive/readme-history.md)。通常の再開では全文を読み直さない。

現在地は追記で積み重ねず、該当する行を更新する。履歴の許可待ち/未実施は当時の状態であり、現在の判断に使わない。GitのHEADや差分は必要時に実Gitで確認する。
