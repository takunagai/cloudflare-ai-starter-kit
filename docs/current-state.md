# 現在地と次の作業

確認日: 2026-10-21（コードと文書の突合）。再開時の入口はこの文書。実クラウドの最終確認は2026-10-06で、再照会していない。担当は2026-10-08にCodexからClaude Codeへ移った。ローカルD1は0016まで適用済み（2026-10-21）、実D1には未適用。

現在地は追記で積み重ねず、該当する行を更新する。履歴の許可待ち・未実施は当時の状態であり、現在の判断に使わない。GitのHEADや差分、テスト件数は必要時に実Gitと実行結果で確認する。文書の一覧は[docs の索引](README.md)。

## 成果物と残件

| 対象 | 確認済みの範囲 | 残件・制約 |
| --- | --- | --- |
| 共通スターター | 認証（Better Auth・Access）、モデル切替、チャット、履歴、要求台帳と再送、用途別の導入例5つ。別名・空DBへの複製で固定install・check・dev/preview・画面を検証済み（版ごと） | 全providerの実接続を完了した意味ではない |
| 任意拡張 | RAG・agent・Workflows・Polar・旧画像・メディア12モデル（素材/ジョブ管理）・Jev（型付き判断）を実装し、すべて既定OFF。ナビは`/api/session`の`features`でONのものだけ表示。ローカル/fakeで検証 | 実モデルの一律検証と通常生成の解放は未完了（`MEDIA_VERIFIED_*_MODELS`は既定で空）。ON時のナビ表示・拡張パネルの各タブ・素材/履歴のある一覧はブラウザで未確認（型検査・試験のみ） |
| 旧検証モードと旧staging | 旧検証モード（固定30分・総3回・指定FP8）は2026-10-19に廃止（`17470cb`）。`STAGING_POLICY`を省略したstagingは503 `missing_staging_policy`で全経路を閉じる。旧stagingのWorker・D1・Accessアプリと`staging-local` build modeは同日に削除。通常stagingの台帳存在検査は残した（[実行時方針](runtime-policy.md)） | 経緯は[廃止の記録](archive/実AI検証制御-実装状況.md#2026-10-19-旧検証モードの廃止)と[作業ログ](archive/staging-work-log.md#2026-10-19-旧stagingを削除) |
| 工程Eの限定fal接続 | 2026-10-06の1要求で画像のprivate保存、本人品質、ACL/匿名拒否を確認し、終了処理も完了。2026-10-19に工程Eの専用経路（`/api/media-probe`、画面、`ENABLE_MEDIA_PROBE`等の14ファイル）を撤去（`547f0d4`）し、新旧のWorker・D1・R2・Accessを本人判断で全削除。migration 0011・0012・0014は残し、tableとtriggerは0016で外した | 短期token・自然期限はunknown、M-0条件は未達。最終費用・上流消去の完了は未確定で、以後の照合はfal側の画面・請求明細だけで行う。再実行する場合は撤去前の実装（`a719d99`）を参照して実装し直す（[削除の記録](archive/工程E-制御実装と隔離検証.md#2026-10-19-工程eの資源を削除)） |
| 失敗理由の診断 | 画像回収拒否の固定分類（5種）が`image-driver.ts`に残る（[診断手順](diagnostics.md)） | 分類はAPIで返さず保存もしない。過去runの原因は後から確定できない |
| 最初の用途別複製 | 別プロジェクトへ複製し、本人1名・Access保護の通常stagingで実配備と受入まで完了（複製先の記録）。踏んだ注意点を[運用手順](operations.md#複製先の実配備で確認した注意点)、確認項目を[公開前チェック](launch-checklist.md)へ反映 | 複製先固有の機能・運用状態は複製先自身の文書で管理する。公開向け（Better Auth＋実メール）の実績はない |
| 複製先からの逆輸入 | 複製先の差分を分類し、Wave 1（CIシェル修正、overrides、画像fixture）とWave 2（チャット要求台帳・復旧: migration 0015、`GET /api/chat/requests/:id`、ブラウザの要求ID記録と再送抑止、`api()`の失敗分類）、通常stagingの`/help`SSRを取り込み済み。設計は[チャット設計](chat.md#要求台帳と再送) | RAG専用（rag-*、trial台帳、rag_sync、索引UI）は逆輸入しない。0015は実環境に未配備。工程E撤去により複製先とのファイル差分が増えるが、複製先へは同期しない |
| 依存・設定 | audit 0件。TanStack Startの反射型XSS（GHSA-qx66-fv34-fjm8）への対応、`compatibility_date`（2026-10-12）、Vitest 5.0.5、`@polar-sh/sdk` 1.0.2へ更新済み。根拠は[依存更新](../references/dependency-update-20261018.md)・[compatibility_date](../references/compatibility-date-20261019.md)・[Vitest 5](../references/vitest5-20261019.md)・[Polar SDK 1.0](../references/polar-sdk1-20261019.md) | 更新後の版は未配備。実Polarは未接続。同じ版を使う複製先は未修正の見込み |
| コード構成 | 実行時ガードを`runtime-guards.ts`へ分離。拡張ゲートを`app-api.ts`の`EXTENSION_GATES`表へ集約し、会話・agentのhandlerを別ファイル化。`chat.ts`は拡張をimportしない。UIの大きいファイル（拡張パネル・チャット・media）を部品へ分割 | 配置は[AGENTS.md](../AGENTS.md#ファイル配置)を参照 |
| 文書構成 | 2026-10-21に全文書を実装と突合し、仕様・手順・履歴に分けて再編。履歴は[archive](archive/README.md)、新設は[runtime-policy.md](runtime-policy.md)と[docs の索引](README.md) | 複製先の文書は対象外 |

## 有効な許可と担当

継続して有効な実行許可はない。クラウド変更、実AI/メール/決済、実Secret、公開範囲の変更、commit/pushは、そのつど対象・影響・費用を具体化して本人が許可する。以前の固定時刻・回数付きの実行許可は完了済みで、新しい実行へ流用しない。共通のモデル設定は変更しない。開発運用の評価方針は[開発運用の改善記録](development-workflow.md)。

## 次に進めること

- [ ] [cloudflare/workers-sdk#16331](https://github.com/cloudflare/workers-sdk/issues/16331)の修正版`@cloudflare/vitest-plugin`が出たら、`tests/setup.ts`の回避策（pluginと同じmigration適用処理）を`cloudflare:test`の`applyD1Migrations`呼び出しへ戻す。戻した後に`--maxWorkers=1`を含む`pnpm test`で全件成功を確認する。経緯は[Vitest 5の記録](../references/vitest5-20261019.md#3-既知の不具合と回避策)
- [ ] 2026-10-19の更新（`compatibility_date`、Vitest 5、`@polar-sh/sdk` 1.0.2）の配備と、Polar sandboxでの実接続確認（本人判断で保留）。旧stagingは削除済みで配備先がない。進めるときは、各段階の対象・費用を具体化して本人の承認を得る
  1. 新しい通常stagingのWorker・専用D1・Accessを決めて作る。migration 0001〜0012・0014〜0016を`scripts/d1-wire.ts`の`renderD1Wire`で生成した送信用SQLで1本ずつ適用し、SELECTで照合する（[運用手順](operations.md#複製先の実配備で確認した注意点)）
  2. 全拡張OFF・公開経路なしでbuild（`CLOUDFLARE_ENV=staging pnpm build --mode standard-staging-local`）→ dry-run → 配備し、Access保護とホスト接続を確認する
  3. 本人がPolar sandboxで組織・継続課金商品・tokenを作り、`POLAR_ACCESS_TOKEN`と`POLAR_WEBHOOK_SECRET`を会話外で投入する。`ENABLE_BILLING=true`・`POLAR_SERVER=sandbox`・`POLAR_PRODUCT_ID`を設定し、`/api/billing/webhook`をAccessで遮断しない（[決済](billing.md)）
  4. 購入→webhook→状態表示→Portalを確かめ、API版`2026-10`の実応答が`billing.ts`の応答検証を通ることを記録する（[SDK 1.0の記録](../references/polar-sdk1-20261019.md)の未確認項目）
- [ ] GitHub CIのHTTP smokeで`/api/media/*`（OFF時は認証前に404）が500を返した原因を特定する。CIで1度（docsだけの`204c6ba`のrun 1回目、再実行で成功）、ローカルのpreviewで1度（2026-10-21、`GET /api/media/models`が500）発生した。ローカルの500は本文が`internal_error`ではなく、Cloudflare Vite pluginのHTMLエラーページ（`TypeError: fetch failed`、miniflareの`dispatchFetch`）で、workerd側のログは空だった。直後の再要求5回とsmoke再実行3回は成功し、アプリ内の例外ではなくpreviewからworkerdへの接続断とみられる。`423c166`から、smoke失敗時にpreviewログの末尾と応答本文がCIログに出る。次は、previewを起動したままsmokeを繰り返して頻度を測り、workerdが再起動しているかを確かめる。それまで実装は変えない
- [ ] 公開向け（Better Auth＋実メール）の最初の用途を決める。個人・社内向けは複製先で実配備まで済んだが、公開向けは実績がない。決まったら用途・provider・予算・送信ドメインを具体化し、公開向けの準備へ進む。入口は[公開サービス向けに準備する](presets/public.md)と[公開前チェック](launch-checklist.md)
- [ ] リポジトリを公開する前に、公開基準での確認を全履歴・PR・Issueに対して行う。作業ツリーの文書に残っていたGitHubアカウント名は`OWNER`へ置換済み（2026-10-21）だが、過去のコミット・PR・CIログには残る

## 必要なときだけ読む資料

- 仕様: [構成と受け入れ条件](architecture-proposal.md)、[実行時方針](runtime-policy.md)、各機能の文書（[索引](README.md)）
- 設定・操作: [運用手順](operations.md)、[公開プリセットとbuild境界](公開プリセットとbuild境界.md)
- 失敗時: [診断と次の確認](diagnostics.md)
- 履歴: [archive](archive/README.md)。通常の再開では全文を読み直さない
