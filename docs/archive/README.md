# 役目を終えた文書

通常の再開では読まない。過去の判断や証拠を照合するときだけ参照する。ここにある文書の現在形の記述、件数、commit、許可は当時のもので、現在の仕様・状態・許可として扱わない。現在の入口は[docs の索引](../README.md)と[現在地](../current-state.md)。

## 開発履歴・作業ログ

| 文書 | 内容 |
| --- | --- |
| [plan.md](plan.md) | 2026-10-06までの開発計画と進捗の全履歴 |
| [staging-work-log.md](staging-work-log.md) | 旧staging（2026-10-19に削除済み）の作業ログ |
| [architecture-history.md](architecture-history.md) / [readme-history.md](readme-history.md) | 構成資料とREADMEの旧版 |
| [development-rules.md](development-rules.md) | 第1段階の開発ルール草案。正本は[AGENTS.md](../../AGENTS.md) |
| [phase1-verification.md](phase1-verification.md) / [phase2-verification.md](phase2-verification.md) | 第1・2段階の検証記録 |

## 実AI検証・旧検証モード（2026-09〜10-19に廃止）

| 文書 | 内容 |
| --- | --- |
| [実AI接続-最小検証計画.md](実AI接続-最小検証計画.md) | 本人限定stagingでの実AI最小検証の計画と結果 |
| [実AI検証-使用量と請求確認.md](実AI検証-使用量と請求確認.md) | 同検証の使用量・請求の確認 |
| [実AI検証制御-実装状況.md](実AI検証制御-実装状況.md) | 旧検証モードの実装と、2026-10-19の廃止の記録 |
| [staging-アクセス制限と公開設定.md](staging-アクセス制限と公開設定.md) | 旧stagingのAccess設定（推奨設定は[認証](../auth.md#cloudflare-accessを選ぶ場合)へ移した） |
| [staging-deployment-plan.md](staging-deployment-plan.md) | 初期のstaging配備計画 |
| [main取り込み-最終レビューと次の用途.md](main取り込み-最終レビューと次の用途.md) | main取り込み前のレビューと用途の選択肢 |

## 設計・工程の記録

| 文書 | 内容 |
| --- | --- |
| [用途別プリセット-開発計画.md](用途別プリセット-開発計画.md) | 3用途の設計と、通常stagingの制御案（現行は[実行時方針](../runtime-policy.md)） |
| [D2-複製許可リストと依存整理.md](D2-複製許可リストと依存整理.md) / [D2-実行記録と再開.md](D2-実行記録と再開.md) / [D2-複製元-内容識別.json](D2-複製元-内容識別.json) | 別名複製（D-2）の準備と実行の記録 |
| [M5-隔離複製検証の記録.md](M5-隔離複製検証の記録.md) | メディア12モデルの統合と隔離複製（M-5）の検証記録 |
| [fal-初版設計の工程計画と工数.md](fal-初版設計の工程計画と工数.md) | fal初版設計の工程計画と工数見積り |
| [リポジトリ公開情報の整理とPR運用の記録.md](リポジトリ公開情報の整理とPR運用の記録.md) | 2026-09-28の履歴整理とPR #1・#2の検査記録 |
| [旧プロジェクト-廃止記録.md](旧プロジェクト-廃止記録.md) | 旧プロジェクトの整理記録 |
| [保護フック誤検出-調査と修正案.md](保護フック誤検出-調査と修正案.md) / `proposals/secret-guard/` | ユーザー環境の保護フックの調査と修正案。アプリ本体では使わない |

## 工程Eの記録（専用経路は2026-10-19にコードから撤去）

| 文書 | 内容 |
| --- | --- |
| [工程E-用途と限定接続の事前整理.md](工程E-用途と限定接続の事前整理.md) | 限定実接続の事前整理 |
| [工程E-制御実装と隔離検証.md](工程E-制御実装と隔離検証.md) | 専用制御の実装、実接続、2026-10-19の資源削除 |

操作script（`工程E-*.py`）と設定例は[scripts/archive/e/](../../scripts/archive/e/)にある。

## 工程ごとの引き継ぎプロンプト

`*完了-次セッション開始プロンプト.md`（B-2〜D-1、CJの9本）、`D2-env依存-判断確認と次セッション.md`、`D2準備完了-次セッション開始プロンプト.md`は、各工程の引き継ぎ。記載された許可は当時のもので、流用しない。

## その他

`phase1-preview.png` / `phase2-preview.png`は第1・2段階の画面で、Git管理外のローカル専用ファイル。

Markdownの相対リンクは移動に合わせて張り替えた。GitHubのアカウント名は公開前に`OWNER`へ置換したため、`github.com/OWNER/…`のURLは辿れない（リポジトリ名と番号から探す）。本文に引用したgit statusの出力や、過去の開始プロンプトに書かれた`docs/…`のパスは当時の記録なので書き換えていない。
