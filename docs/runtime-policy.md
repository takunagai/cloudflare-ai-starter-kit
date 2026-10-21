# 実行時方針と通常stagingの制御

実装は`src/server/runtime-policy.ts`（設定だけを見る純粋な判定）と`src/server/runtime-guards.ts`（入口から呼ぶ実行時ガード）。設定の成功は契約への適合だけで、認証・DB・資格情報・実接続の確認ではない。

## 設定キー

| キー | 値 | 備考 |
| --- | --- | --- |
| `APP_ENV` | `local` / `staging` / `production` | 完全一致。ほかは503 `invalid_application_environment` |
| `APP_ORIGIN` | 単一のorigin | localはloopbackの`http`/`https`、非localはHTTPS。違反は503 `invalid_application_origin`。実要求との照合は`guardRequestEnvironment`が別に行う（非localは要求originが`APP_ORIGIN`と不一致なら503 `invalid_application_origin`、localをloopback以外のホストで使うと503 `unsafe_local_configuration`） |
| `STAGING_POLICY` | stagingで`standard`必須 | 省略は503 `missing_staging_policy`、未知値は`invalid_staging_policy`。local/productionで指定しても`invalid_staging_policy` |
| `AI_MODE` | `off` / `local-demo` / `selected` | 省略時は、localかつ`LOCAL_DEMO="true"`のときだけ`local-demo`、それ以外は`off`。未知値は`invalid_ai_mode` |
| `LOCAL_DEMO` | `"true"` / `"false"` | `local-demo`のときだけ`"true"`、ほかは`"false"`の明示が必須。不一致、非localの`local-demo`は`invalid_local_demo` |
| `AI_ALLOWED_MODELS` | モデルIDのJSON配列 | `selected`だけ非空・重複なし・公開catalogの既知IDのみ。`off`/`local-demo`は省略か`[]`のみ。違反は`invalid_allowed_models`。非localで`lm-studio/local`を含むと`local_model_forbidden` |
| `JEV_MODE` / `JEV_MODEL` | `off` / `remote`、固定版`jev-1.13.0` | `off`は`JEV_MODEL`を指定できない。`remote`は固定版のみ。違反は`invalid_jev_mode` / `invalid_jev_model`。詳細は[Jev契約](Jev-B3J-実装前契約.md) |
| `AI_VERIFICATION_ENABLED` / `AI_VERIFICATION_START` | 指定しない | 2026-10-19に廃止した旧検証モードの名残。`"false"`と空以外が残っていると503 `legacy_verification_settings`で拒否する |

値の比較は完全一致で、空白除去・大文字小文字の変換・不明値の既定化はしない。エラーは固定コードだけを返し、入力値・URL・JSON解析例外を含めない。`boundary`（環境）が不適合なら`chat`と`jev`も同じ理由で不適合になる。`boundary`が適合している限り、チャットとJevの結果は互いに独立しており、片方の不備で他方や認証・履歴操作を止めない。

`AI_MODE`が管理するのは、チャットとWorkflows要約など共通のモデルadapterを使う生成だけ。AI Search、fal.ai、決済、実メールは各拡張のフラグと認証設定で別に制御する。

## 入口の判定順

1. 環境・originを確認する（`guardRequestEnvironment`）。
2. stagingで`STAGING_POLICY=standard`がなければ、任意拡張の入口をすべて404 `feature_disabled`で閉じる（`isStagingWithoutStandardPolicy`）。認証より先に判定する。
3. 任意拡張はフラグがOFFなら認証前に404。表は`app-api.ts`の`EXTENSION_GATES`が唯一の定義。
4. ONの入口は、認証 → method・入力・所有権 → `checkRuntimeBoundary`（環境と台帳）→ 必須設定 → 外部処理の順。実行直前と関連更新の直前にも同じガードを再確認する。決済webhookは署名検証の後、DB更新の前に適用し、不適合は再送が必要な503にする。
5. チャット生成はさらに`checkChatRuntimePolicy`でモデル選択を確認する。モデル一覧は、不適合のとき全件`available:false`になる。

公開ページ・認証・session・会話の一覧と削除は、AI OFFやモデル設定の不備だけでは遮断しない。`/api/session`の`features`は、環境が適合し、かつ各フラグがONのものだけtrueになる。

## 通常stagingの台帳確認

stagingでは`requiresCleanLedgerCheck`がtrueになり、認証後の実行入口で`ai_verification`（migration 0006）の行の**存在だけ**を確認する。別用途に使ったD1の再利用を拒否するための境界で、行の内容は読まず、削除や更新もしない。

| 結果 | 応答 |
| --- | --- |
| tableがあり、行がない | 続行する |
| 行がある | 503 `legacy_verification_ledger` |
| tableがない、またはSQL・通信の失敗 | 503 `verification_ledger_unavailable` |

「行なし」の結果はcacheしない。理由コードは配備済みの記録と照合できるよう旧名のまま維持している。0006のtableはmigrationなので削除しない。新しい通常環境は専用のWorker・D1で始め、台帳のDBを流用しない。

## 通常経路の上限

チャットの上限は[チャット設計](chat.md)に従う。これらは利用者ごとの回数・同時実行・入出力の制限で、利用者全体の費用の上限ではない。実接続を有効にする前に、人数・回数・期間・provider側の予算制御・終了操作を決める（[運用手順](operations.md)の停止条件）。

## 変更時の注意

- 入口の分類を変えるときは`EXTENSION_GATES`の表だけを更新する。表にない`/api/*`はJSONの404になる。
- 認証方式を変えても、同じメールで所有者を統合しない。IDは`access:<team>:<sub>`と`better-auth:<id>`で分離している（[認証](auth.md)）。
- 経緯は[旧検証モードの廃止](archive/実AI検証制御-実装状況.md#2026-10-19-旧検証モードの廃止)と[当時の設計](archive/用途別プリセット-開発計画.md#工程a-通常stagingの制御案)にある。現在の動作はこの文書とコードを正とする。
