# docs の索引

文書は役割で分けている。実装が正本で、文書と食い違ったらコードを優先し、文書を直す。状態の報告（何が済み、何が残るか）は[現在地](current-state.md)だけに書き、他の文書へ重ねない。

## 現在地

| 文書 | 役割 |
| --- | --- |
| [current-state.md](current-state.md) | 再開時の入口。実装・検証・実接続の範囲、残件、有効な許可 |

## 仕様・設計（現在の動作）

| 文書 | 内容 |
| --- | --- |
| [architecture-proposal.md](architecture-proposal.md) | 合意済みの構成と受け入れ条件 |
| [runtime-policy.md](runtime-policy.md) | 実行時の設定判定、通常stagingの制御、入口の判定順 |
| [auth.md](auth.md) | Better Auth・Cloudflare Accessの導入、Accessの推奨設定 |
| [chat.md](chat.md) | チャット・履歴・要求台帳・承認付きツール |
| [providers.md](providers.md) | 公開モデル一覧、モデル選択、LM Studio |
| [extensions.md](extensions.md) | RAG・Workflows・既存の画像生成 |
| [billing.md](billing.md) | Polar決済 |
| [Jev契約](Jev-B3J-実装前契約.md) / [Jev標準利用例](Jev標準利用例.md) | 型付き判断のAPI契約と分類画面 |
| メディア | [初版設計](fal-画像動画音声-初版設計.md) → [M-0 採用条件](fal-メディア-M0差分設計.md) → [M-1 ジョブ・保持](M1-共通メディアジョブと保持.md) → [M-2 素材・画像](M2-素材基盤と画像4モデル.md) → [M-3 動画](M3-通常動画4モデルとprivate再生.md) → [M-4 音声](M4-音声4モデルとprivate再生.md) → [M-5 統合](M5-メディア統合と隔離複製検証.md) |
| [theme.md](theme.md) | 配色・角丸・ダーク表示 |

## 手順・運用

| 文書 | 内容 |
| --- | --- |
| [operations.md](operations.md) | 環境分離、migration、依存更新、配備、復旧、複製先での注意点 |
| [公開プリセットとbuild境界.md](公開プリセットとbuild境界.md) | 公開設定5例とbuild modeの固定対応 |
| [presets/](presets/local.md) | 用途別の入口: [local](presets/local.md) / [個人・社内](presets/internal.md) / [公開サービス](presets/public.md) |
| [launch-checklist.md](launch-checklist.md) | 公開前チェックと、Cloudflare実配備の受入項目 |
| [diagnostics.md](diagnostics.md) | 失敗時の診断の順序、固定分類、既知の警告 |
| [リポジトリ-公開情報と履歴管理.md](リポジトリ-公開情報と履歴管理.md) | リポジトリの公開範囲と関連設定、実環境情報を公開用ソースから分ける方針、PR運用 |
| [development-workflow.md](development-workflow.md) | 開発作業の進め方と、評価の方針 |

## 履歴

[archive/](archive/README.md)に、役目を終えた文書を置く。開発履歴（[plan.md](archive/plan.md)、[staging作業ログ](archive/staging-work-log.md)）、実AI検証・工程E・D-2の記録、旧版の構成資料などで、通常の再開では読まない。過去の許可・未実施・件数・commitは当時の状態で、現在の判断に使わない。

公式根拠の調査メモは[references/](../references/README.md)にある。

## 文書を書くときの約束

- 仕様・手順の文書は現在形で書く。工程名や日付付きの経過（「M-3で追加」「D-2完了」）を冒頭へ積まない。経過は`archive/`へ移す。
- 決めたこと・変えたことは、仕様なら該当の文書の本文を更新し、状態なら[現在地](current-state.md)の該当行を更新する。追記で積み重ねない。
- テスト件数・commit hash・「未push」のような時点の値は、現在の仕様の文書に書かない。必要なら現在地に確認日付きで書く。
- 実ID・AUD・個別の管理URL・個人の絶対パス・アカウント名は書かない（[公開情報の方針](リポジトリ-公開情報と履歴管理.md)）。
