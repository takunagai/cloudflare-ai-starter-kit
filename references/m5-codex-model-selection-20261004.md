# M-5のCodexモデル・エフォート選定

確認日: 2026-10-04。OpenAI Docsの公式本文を確認した。モデル設定変更・API推論・M-5実行は行っていない。

- 推奨はGPT-6.1 Sol（`gpt-6.1-sol`）/High（`high`）。この環境の選択肢にあり、画像4・動画4・音声4の統合、所有権/保持/容量/復旧の回帰、隔離した別名複製とHTTP/Chrome検証に使う判断。
- [公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-6.1-sol)は複雑なcodingを対象とし、Highを含むreasoning effortを提供する。[公式reasoning effort](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)はHighを複雑なdebugging・計画・agentic workflowに位置付ける。M-5での比較評価ではなく工程の性質に基づく推奨。Xhigh以上を選ぶ明確な比較根拠はないため、既定では増やさない。
- M-4の検証済み差分をコミットしてから別セッションを推奨する。媒体別実装を終えたGitと文書を基準に、全体の受け入れ条件と複製を独立して検証しやすいため。このセッションで継続することも可能だが、M-5の実行は別の明示許可後。
- 開始プロンプトは会話内で提示する。新規チャット作成/送信・モデル設定変更は行わない。M-4のコミット許可をM-5、既存D-2の再実行/再複製、実接続/課金/クラウド/Secret/配備やGit送信の許可へ広げない。
