# M-4のCodexモデル・エフォート選定

確認日: 2026-10-04。OpenAI Docsの公式本文を確認した。モデル設定変更・API推論・M-4実装は行っていない。

- 推奨はGPT-6.1 Sol（`gpt-6.1-sol`）/High（`high`）。この環境で提示された選択肢にあり、音声4 endpoint、単一/2話者とtoken境界、MP3/WAV検査、private保存/Range、保持・状態競合の実装/ローカル検証に使う判断。
- [公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-6.1-sol)は複雑なcodingを対象とし、Highを含むreasoning effortを提供する。[公式reasoning effort](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)はHighを複雑なdebugging・計画・agentic workflowに位置付ける。M-4での比較評価ではなく、工程の性質に基づく推奨。
- M-3と正常系補強をローカルコミットしてから別セッションを推奨する。音声の契約と検証へ集中し、M-3のコード・709 workerd＋7合成試験の結果・制約をGitと文書で引き継ぐため。新規チャットの作成/送信やモデル設定変更は行わない。
- 次セッション用の開始プロンプトは会話内に提示する。実行許可は本人が送った時点の対象・範囲と適用指示で確認する。現在のコミット依頼をM-4や実接続/クラウド変更の許可に広げない。
