# M-3のCodexモデル・エフォート選定

確認日: 2026-10-04。OpenAI Docsの公式本文を確認し、公開資料の読取りだけを行った。Codexのモデル設定変更・実API呼出し・M-3実装は未実施。

- 推奨はGPT-6.1 Sol（`gpt-6.1-sol`）/High（`high`）。この環境で提示された選択肢にあり、M-3の動画4endpoint・状態競合・bounded stream保存・Range/seek・カメラ入力の実装と検証に使う判断。モデル/エフォートを実行側が自動変更する指示ではない。
- [公式changelog](https://developers.openai.com/api/docs/changelog#september-2026)はGPT-6.1 Solを複雑なcodingと専門的な作業向けとして説明する。
- [公式reasoning effort](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)はHighを複雑なdebugging・計画・agentic coding向けに位置付ける。特定のM-3実装で比較評価した結果ではなく、工程の性質に基づく推奨。
- M-2の成果物・検証・制約は[設定メモ](../docs/M2-素材基盤と画像4モデル.md)と[進捗](../docs/plan.md)へ保存済み。次は別セッションを推奨し、M-3を実行する許可は人間が開始プロンプトを送った時点で確認する。新しいチャットを自動作成/送信しない。
