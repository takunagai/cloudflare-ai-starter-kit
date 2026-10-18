# M-1実装用Codexモデルの選定

確認日: 2026-10-04。公式OpenAI Docsの公開本文と、この環境で提示されたモデル/エフォート一覧を確認。アカウント設定やモデル設定は変更していない。

推奨はGPT-6.1 Sol（`gpt-6.1-sol`）/High（`high`）。公式の一般的な選択指針に加え、M-1のD1競合予約・冪等性・状態遷移・受付不明保持の検討に十分な推論量を確保するという作業上の判断。モデル比較実験・実装成功率・処理時間/費用の実測に基づく推奨ではない。

| 根拠 | 確認した内容と制約 |
| --- | --- |
| [Models: GPT-6.1 Sol](https://learn.chatgpt.com/docs/models#gpt-6.1-sol) | Codex desktop/CLIでの対象プランとモデルID、モデル/エフォートの設定がプラン・クライアント・workspace設定等に依存することを確認。この環境ではhighを含む選択肢が提示されているが、別環境の利用可否は保証しない |
| [Model selection](https://developers.openai.com/api/docs/guides/model-selection#when-to-consider-gpt-61-sol) | 費用も考慮する複雑なプロジェクトでSolを検討し、Astraとは同じ課題で比較して品質/費用を判断する指針。今回その比較試験は行っていない |

別セッションでの開始方法と作業範囲はM-1指示書（`handover/指示書_M1共通ジョブ開始.md`、Vaultへアーカイブ済み）を参照。選定記録だけでM-1の実装や外部操作の許可を与えない。

## M-1完了後のM-2向け再確認

2026-10-04。本人が次セッションのモデル/エフォート推奨を求めたため、[Models](https://learn.chatgpt.com/docs/models)と[reasoning.effortの指針](https://developers.openai.com/api/docs/guides/deployment-checklist#set-up-reasoningeffort)を公式ツールで再読した。GPT-6.1 Solは複雑なcodingや長時間の作業の推奨候補で、Highは計画・診断・コード検討に適する設定の1つ。M-2の素材検査・容量・取得権限の境界をまとめて考える作業上の判断として、同じGPT-6.1 Sol/Highを推奨する。モデル比較/evalの実測ではなく、モデル・設定・アカウントの変更や新しいチャット作成も行っていない。
