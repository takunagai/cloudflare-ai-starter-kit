# M-5のCodexモデル・エフォート選定

確認日: 2026-10-04。OpenAI Docsの公式本文を確認した。モデル設定変更・API推論・M-5実行は行っていない。

- 推奨はGPT-6.1 Sol（`gpt-6.1-sol`）/High（`high`）。この環境の選択肢にあり、画像4・動画4・音声4の統合、所有権/保持/容量/復旧の回帰、隔離した別名複製とHTTP/Chrome検証に使う判断。
- [公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-6.1-sol)は複雑なcodingを対象とし、Highを含むreasoning effortを提供する。[公式reasoning effort](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)はHighを複雑なdebugging・計画・agentic workflowに位置付ける。M-5での比較評価ではなく工程の性質に基づく推奨。Xhigh以上を選ぶ明確な比較根拠はないため、既定では増やさない。
- M-4の検証済み差分をコミットしてから別セッションを推奨する。媒体別実装を終えたGitと文書を基準に、全体の受け入れ条件と複製を独立して検証しやすいため。このセッションで継続することも可能だが、M-5の実行は別の明示許可後。
- 開始プロンプトは会話内で提示する。新規チャット作成/送信・モデル設定変更は行わない。M-4のコミット許可をM-5、既存D-2の再実行/再複製、実接続/課金/クラウド/Secret/配備やGit送信の許可へ広げない。

## M-5完了後の次セッション

2026-10-04、本人のコミット/引き継ぎ依頼に合わせて[公式モデル案内](https://learn.chatgpt.com/docs/models#gpt-61-sol)と[reasoning effort](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)を本文で再確認した。GPT-6.1 Solの選択肢と、Mediumが計画/判断の品質・遅延・費用の均衡点、Highが深い計画/複雑な課題向けという説明を確認。

次は新しいセッションで、工程Eの事前整理からGPT-6.1 Sol/Mediumを推奨する。M-5の長い実行履歴から区切り、確定したGit/文書を基準に用途・接続対象・上流条件・費用/回数/終了方法の未決だけへ集中するため。これは工程の性質に基づく判断で、モデル間の比較試験や速度保証ではない。実装や複雑な境界レビューへ進む場合のHighは、その段階で必要性を判断する。

開始プロンプトは会話内で提示する。M-5/D-2の再実行・再複製や無変更のcheckを要求せず、実接続/課金/クラウド/Access/R2/Secret/配備・Git送信は個別の別承認まで停止する。用途や費用を未回答のまま採用せず、質問は必要な1〜3件へ絞る。チャット作成/送信・モデル設定変更は行っていない。
