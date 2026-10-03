# C-J完了の引き継ぎと開始プロンプト

確認日: 2026-10-02。推奨モデル: **gpt-6.1-sol**、エフォート: **xhigh**。今回の明示許可はC-Jの標準利用例と必要なローカル検証・文書整合だけ。Git操作/送信を対象外とする具体的指示を優先し、末尾の一般的なコミット依頼からstage/commit許可を拡張していない。次のD-1は別の明示許可後で、本書の存在を着手許可にしない。

## 最初の実Git照合と差分の由来

開始時は[C-1最終記録](C1完了-次セッション開始プロンプト.md#最終git2026-10-02の終了点)とbranch・HEAD・ローカルorigin/main・ahead/behind・index・変更/未追跡一覧が完全一致し、差異なしと最初に報告した。main、HEAD `1acca438b77eb3fa3f8fe4c347f9a8e16b3de0ee`、ローカルorigin/main `66fd90f3526a52083ae79f4bd60fa9b640843c26`、ahead5/behind0、index空、変更9＋未追跡4＝13件。remoteは再照会していない。

元71件はC-1開始時・B-4実装完了時の履歴で、現在の未commit一覧ではない。その後の別操作4commitは`3958b54`→`48662c7`→`210fc0a`→`1acca438`。13件には同時commitから残ったB-2〜B-4文書差分とC-1が共存する。これらとC-1コミット範囲の未回答を保持し、今回分だけと誤認したcommit・差分破棄・履歴書換えは行わない。

共通実ファイルenv-inspection.md、secret-injection.md、repository-publication.md、project-settings-notes.mdとgit-publication-guard.md、literal-search-guard.mdの6ルールを実読した。保護フックstatusの3項目はtrue。最初のルール一括読込はPreToolUseの環境表示判定で実行前に停止したため、security READMEで規則Markdownの扱いを確認し、同じ実ファイルを名指しで個別に読み取った。秘密ファイルへ対象を変えず、フック・例外・baseline・設定は変更していない。

## 完成した範囲

| 対象 | 内容と理由 |
| --- | --- |
| `/decisions` | チャットと独立した固定4候補分類画面。既存API/serviceを使用。noindex/nofollow・no-store・no-referrer、事前生成なし |
| 合成fixture | 計画整理・該当なし・不確実の固定3例。推論や台帳登録なし、実精度/confidence計算/usageではないと表示。API OFF/失敗へ代替しない |
| 結果表示 | 選択・全4候補確率/confidenceを値のまま表示。常に人の確認、閾値による自動採用/拒否なし。認可/副作用承認へ委譲しない |
| API依頼 | 既存ログインと入力検証後、明示操作でUTC日付きキーを1つ作り1回POST。二重操作抑止、redirect/retry/fallbackなし。未接続を説明 |
| 回復 | 手動本人GETだけ、5秒以内連続確認抑止・自動pollなし。応答紛失/処理中/unknownはロック。同じキーのsucceeded/failed以外はロック解除なし、結果再表示不可 |
| 保存 | 本文・結果・要求キーは画面メモリのみ。ブラウザstorage/URL/チャット履歴へ保存なし。再読み込み/画面移動で非復元。別依頼には明示確認と再課金の可能性を表示 |
| 文書 | [標準利用例と設定メモ](Jev標準利用例.md)、README、plan、構成資料、用途別計画、3用途文書を整合。C-1の過去証拠と今回を区別 |

実装は`src/routes/decisions.tsx`、`src/components/decision-example.tsx`、`src/lib/decision-example.ts`、ナビへの入口は`src/routes/__root.tsx`。`src/server.ts`は新画面のno-storeだけ、`src/styles.css`は分類表示とナビの狭幅対応、`scripts/smoke.mjs`はSSR/非共有確認を追加。既存`src/routes/app.tsx`のC-2差分は追加していない。

B-3JのAPI/数値/固定版/独立枠/1claim/台帳/保持は不変。Node26.10.0/pnpm12.6.0、依存/lockfile/override、0001〜0007、公開5例・実設定は保持。既定OFF・キーなし起動、チャットへの自動呼出しやモデル切替なし。GETパスは検証済み要求キーをそのまま使い、日付区切りをencodeして既存routeの照合を壊さない。

## 検証と終了点検

今回の版で`WRANGLER_LOG_PATH=.wrangler/logs pnpm check`が成功。lint81、型生成/型検査、実workerd22ファイル473テスト（C-J追加21）＋合成build/HTTP7試験、client/Worker build・helpだけ事前生成。初回はsandboxのlisten EPERMでテスト開始前に停止し、許可されたローカル実行で成功した。従来のsourcemap/循環依存警告、Workflow故障注入の固定例外は既存試験のもの。

最終視覚点検で分類確認欄の幅の崩れを見つけ、分類画面だけのCSSで修正した。対象lintと最終buildを再確認し、同じ最終成果物のpreviewでHTTP smokeを行った。画面は現在のChromeで、合成3例・確率/confidence・Jev OFF/未接続・1回POST後のロック・手動GET/不存在説明・再読み込み/画面移動後の非復元を確認。狭幅設定の実測viewportは416pxで横はみ出しなし、確認欄18px・ナビ/fixtureの折返しを視覚確認し、viewport指定を解除した。合成成功/不正/unknown・lost responseのfake試験を実日本語品質の証拠にしない。

HTTP smokeはSSR/help/新画面no-store/no-referrer/noindex/404/asset/API、架空登録、Jev OFF/metadata、固定応答・履歴/replay/削除/logout。通常ローカルDBに架空アカウント/利用台帳が残るが、既存DBや旧台帳を削除・再migrationしていない。テスト用一時D1の0001〜0007適用は既存test setupによるもの。

最終版のdevでもHTTP smokeとChromeのfixture操作が成功した。既存の3000番プロセスを変更せず、今回のdevは4173番で起動して同一originの認証条件を確認した。設定ファイルは変更していない。自身が起動したpreview/devだけを停止し、4173番の接続拒否を確認。今回作成した確認用Chromeタブも閉じ、既存タブ・セッションは保持した。

文書15件の相対リンク368件・Markdownアンカー90件は欠落/未照合0、行末空白0。公開候補の名指し文書15件とコード/試験8件に対する内容ルール検査は候補0。開始時に内容識別した公開45ファイルは34件一致・11件差異で、差異は今回更新した既存文書7件とコード4件だけ。開始13件のうち6件は内容一致、7件へC-Jを追記した。B-3J本体・既存app・依存/lockfile/override・0001〜0007・設定を保持し、`git diff --check`と`git diff --cached --check`も成功した。検査対象は名指しの公開ファイルだけで、任意のリンク先本文や禁止対象を読み取らない。秘密の不存在・既存全履歴の公開可否を保証する検査ではない。

## 最終Git

main、HEAD `1acca438b77eb3fa3f8fe4c347f9a8e16b3de0ee`、ローカルorigin/main `66fd90f3526a52083ae79f4bd60fa9b640843c26`、index空、ahead5/behind0（ローカル参照間）。未stage変更13＋未追跡10＝23件。開始13件に新しく現れた10件を加えた状態で、開始文書の一部へC-Jを重ねている。最終一覧は以下。stage/commit・Git送信/remote再照会・作者/フック/履歴の変更はない。

```text
 M README.md
 M docs/architecture-proposal.md
 M docs/auth.md
 M docs/operations.md
 M docs/plan.md
 M docs/providers.md
 M docs/リポジトリ-公開情報と履歴管理.md
 M docs/公開プリセットとbuild境界.md
 M docs/用途別プリセット-開発計画.md
 M scripts/smoke.mjs
 M src/routes/__root.tsx
 M src/server.ts
 M src/styles.css
?? docs/C1完了-次セッション開始プロンプト.md
?? docs/CJ完了-次セッション開始プロンプト.md
?? docs/Jev標準利用例.md
?? docs/presets/internal.md
?? docs/presets/local.md
?? docs/presets/public.md
?? src/components/decision-example.tsx
?? src/lib/decision-example.ts
?? src/routes/decisions.tsx
?? tests/decision-example.test.ts
```

## 残条件と次の単位

C-Jの許可範囲を再点検し、見つかった表示・文書の不整合に対応して再確認した。許可範囲のやり残しはない。C-2/D、メディア、Git操作/送信、実設定・実AI/Jev/メール/OTP/再認証/Secret、配備/remote migration/クラウド変更/automation、CI/audit再照会は今回の対象外。次は別の明示許可後のD-1統合検証だけを推奨。D-2別名複製と必要な場合だけのC-2を同時に許可扱いにしない。

M-0は参照7日/生成30日/所有者1 GiB・初版除外を保持。private R2/短期取得経路・追加数値/ジョブ保持は回答未受領、fal上流の保持/ACL/Store-IO/実価格/権限/品質は未検証。Jev回答を流用せず、Directorは対象外。

工程E前の実適用Order/DPA・本文/派生情報/backup保持/削除・unknown照合/修復/削除要請・実権限/日本語品質・実料金/失敗課金/credit自動補充・人数/総予算/期間/終了方法は未確定。回数枠は硬い請求額上限ではなく、abortは上流停止/未課金の証拠ではない。Jevの本文/結果/hash非保存・終端90日/結果再表示なし・unknown消費/同時枠保持・自動再送/削除/解放なし・GET要求状態更新なし・復元直後の再有効化禁止を維持する。

## 次セッション用開始プロンプト

以下は本人が次のD-1だけを明示許可して送るテンプレート。送る前は未許可。推奨モデルgpt-6.1-sol、エフォートxhigh。C-Jを重複実施しない。

```text
cloudflare-ai-starter-kitを引き継ぎ、日本語で応答してください。
AGENTS.md、docs/CJ完了-次セッション開始プロンプト.md、docs/C1完了-次セッション開始プロンプト.md、docs/B4完了-次セッション開始プロンプト.md、docs/plan.md、docs/architecture-proposal.md、docs/用途別プリセット-開発計画.md、docs/公開プリセットとbuild境界.md、docs/Jev-B3J-実装前契約.md、docs/Jev標準利用例.md、READMEとdocs/presets/の3文書を読んでください。
最初に実Gitのbranch・HEAD・ローカルorigin/main・ahead/behind・index・変更/未追跡一覧をC-J引き継ぎの最終Gitと照合し、差異を報告してください。終了点はmain、HEAD1acca438b77eb3fa3f8fe4c347f9a8e16b3de0ee、ローカルorigin/main66fd90f3526a52083ae79f4bd60fa9b640843c26、index空、ahead5/behind0、変更13＋未追跡10＝23件です。開始13件には残るB-2〜B-4文書差分とC-1が共存し、元71件はC-1開始時の履歴。その後の別操作4commitと今回のC-J追加分を区別して保持してください。C-1の未回答commit範囲を自動確定せず、同時Git操作があれば照合してください。

今回はD-1のローカル統合検証だけを新たに許可します。用途別計画の受け入れ条件と実ファイルの証拠を点検し、両認証方式・所有権・設定不備/旧台帳拒否時の回復・Jev未接続/合成fixture/応答紛失/unknown停止・既存チャット/拡張OFF・公開例/build境界の不足に限り、意味のあるfake/workerd/D1試験と必要最小限の修正・文書整合を行ってください。既存の十分な試験を重複追加せず、今回対象版のcheck・必要なHTTP smoke・現在のChromeの画面操作を確認してください。C-Jの473 workerd＋7合成build/HTTPや過去CIを新変更の証拠にしません。
C-2の既存画面変更、D-2別名複製、メディア、Git操作/送信/remote再照会、実設定/実AI/Jev/メール/OTP/再認証/Secret、配備/remote migration/クラウド変更/automation・CI/audit再照会は対象外です。D-1で契約変更やC-2が不可欠なら対象と理由を具体化し、その依存部分へ進まず別判断を求めてください。

共通実ファイルenv-inspection.md、secret-injection.md、repository-publication.md、project-settings-notes.md（~/.claude/rules/）とgit-publication-guard.md、literal-search-guard.md（~/.agents/security/docs/）を実読してください。src/server/env.ts、.wrangler.staging.local.jsonc、.publication-recovery/は閲覧/複製/別経路取得禁止。新しい管理外設定も実値を扱いません。環境一覧・秘密ファイル・実認証情報の閲覧/投入・フック迂回・例外/baseline変更は禁止。検索はrg --no-config [-n] [-A 数値] [-B 数値] -- '検索語' 明示ファイル1件だけ。対象別の構造化patchで編集してください。reset/checkout破棄・履歴書換えなし。Node26.10.0/pnpm12.6.0・固定依存/lockfile/override・0001〜0007・公開5例/build対応と実設定は保持します。local/旧検証/通常staging/productionとDBの境界を維持し、旧台帳を読み集めたり削除/更新して通常へ転換しません。

B-3JのAPI/数値/固定版/独立枠/1claim、本文/結果/hash非保存・終端90日/結果再表示なし、unknown消費/同時枠保持、自動再送/削除/枠解放なし、GET要求状態更新なし、復元直後の再有効化禁止を維持してください。チャット自動呼出し・モデル切替・判断への認可/副作用承認の委譲、応答紛失を新キー/自動再送で救済する仕組みは追加しません。fixtureを実APIの代替結果や日本語品質の証拠にしません。
M-0未回答、工程E前の実契約/保持/unknown修復/実権限/日本語品質/実料金/失敗課金/自動補充/人数/総予算/期間/終了方法は解消しません。Jev回答をM-0へ流用せず、Directorは対象外です。

許可範囲のやり残しを点検し、不整合に推奨で対応して再点検してください。自身が起動したサーバーだけ停止し、変更/検証/未実施/最終Git、次の開始プロンプトと推奨モデル/エフォートを添えて区切ってください。Gitのstage/commitは別の明示許可がなければ実行しません。
```
