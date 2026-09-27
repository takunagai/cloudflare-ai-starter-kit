# AI・モデル接続: 事前調査

確認日: 2026-09-27。公式資料と公開npmレジストリで確認。ThinkのExperimental記述も公式本文で照合済み。標準/任意機能の範囲は [構成資料](../docs/architecture-proposal.md)で合意済み。AI依存のインストール・Workers実行・モデル呼び出しは第2段階であり未実施。

## 公式の事実と参考資料からの補正

- [AI SDK 7公式リリース](https://vercel.com/changelog/ai-sdk-7): 2026-06-25正式メジャー公開。Node >=22、ESM要件。SDK全体のリリースと、個別Experimental機能を区別する。
- [Cloudflare AI SDK v6/v7対応](https://developers.cloudflare.com/changelog/post/2026-07-23-ai-sdk-v6-v7-support/): 2026-07-23。AI SDK 7はReact SDK v4、AI SDK 6はReact SDK v3の組み合わせ。
- [Think](https://developers.cloudflare.com/agents/harnesses/think/): `runTurn()`節にExperimental表記があり、ThinkがExperimentalを卒業する前にAPIが進化しうる旨を明記。参考資料の「新規Agentの標準候補」を安定性の保証とは扱わない。
- [Agentsのモデル接続](https://developers.cloudflare.com/agents/runtime/operations/using-ai-models/): Workers AI、外部provider、OpenAI互換API、任意のGateway統合を確認。
- [AI Gateway](https://developers.cloudflare.com/ai-gateway/): 全プランで提供。Dynamic routing、Spend limits、DLP、Guardrails、BYOK保管、Custom ProvidersなどはBeta表示を含む。参考資料の「Stable Core」は機能ごとに分解して再評価する。

## 配布元の確認値

latestタグはGA宣言と別。agents / AIChatAgent全体の明示的GA宣言は今回未確認。

| パッケージ | latest | 互換性の確認点 |
| --- | --- | --- |
| [ai](https://registry.npmjs.org/ai/latest) | 7.0.117 | Node >=22 / ESM |
| [agents](https://registry.npmjs.org/agents/latest) | 0.24.0 | AI SDK `^6 || ^7` |
| [@cloudflare/ai-chat](https://registry.npmjs.org/@cloudflare%2fai-chat/latest) | 0.12.0 | agents `>=0.23 <1`、AI SDK `^6 || ^7`、React 19対応 |
| [@cloudflare/think](https://registry.npmjs.org/@cloudflare%2fthink/latest) | 0.19.0 | agents `>=0.24 <1`、AI SDK `^6 || ^7` |
| [workers-ai-provider](https://registry.npmjs.org/workers-ai-provider/latest) | 4.0.0 | AI SDK `^7` |

各providerの確認値: `@ai-sdk/react` 4.0.120、`@ai-sdk/openai` 4.0.78、`@ai-sdk/anthropic` 4.0.65、`@ai-sdk/google` 4.0.82、`@ai-sdk/openai-compatible` 3.0.57。採用時には必要なproviderだけを選び、解決したlockfileと実行検証を正本とする。

## 設計比較と代替案

| 構成候補 | 解決する要件 | 主な制約 |
| --- | --- | --- |
| Worker + AI SDK + provider選択境界 | 単発生成、簡単なチャット、モデル切替 | 履歴・再接続などは別途設計 |
| 上記 + Agents + AIChatAgent + Durable Objects | 永続チャット、接続管理、ストリーム再開 | DO設定・migration・ユーザーごとの認可が必要 |
| Think + Agents + Durable Objects | Memory、Tool loop、Sub-agent等 | Experimental採用への合意が必要 |
| AI Gateway追加 | 推論の観測・制御 | 有料推論、ログ保存、機能ごとのBeta・利用条件を確認 |

標準チャットはAI SDKのHTTP streamingとD1履歴を採用する。Agents採用を履歴保存の唯一の方法と決めつけない。

## OpenRouter / fal.ai / LM Studio

- **要件訂正**: ユーザーが最初の指示のOpenCodeをOpenRouterへ訂正し、fal.aiを追加した。以前のOpenCode Zen / OpenCode Harness連携の検討は採用対象から外す。
- [OpenRouter公式provider](https://github.com/OpenRouterTeam/ai-sdk-provider): npm配布元では `@openrouter/ai-sdk-provider` 3.1.0、AI SDK `^7.0.0`、Node >=22、Zod `^3.25.76 || ^4.1.8`、ESMを確認。古い検索結果の3.0.0を最新と扱わない。チャット接続を今回の基本サンプルにする案。
- [fal provider](https://ai-sdk.dev/providers/ai-sdk-providers/fal): `@ai-sdk/fal` 3.0.50の配布型定義ではimage/transcription/speech/videoがあり、language modelはない。video型はExperimental。画像1枚のサンプルを提案する。[fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue)はsubmit/status/result/cancelを提供する。処理開始後の取消が推論停止・請求取消を保証するとは扱わない。
- [LM Studio OpenAI互換API](https://lmstudio.ai/docs/developer/openai-compat): ローカルHTTPサーバー経由のResponses / Chat Completions / Embeddings等。

**設計上の判断**: LM Studioはまずローカル開発の接続候補。公開Workerから開発PCのlocalhostへ直接到達できないため、クラウド利用は別途ネットワーク・認証・稼働条件の設計が必要。外部公開やTunnel作成は実施していない。

## 次の確認

再開後の調査で `ai` latest 7.0.118を確認（初期調査の7.0.117から変更）。まだ固定前の候補であり、lockfile固定後に新リリースへ無条件追従しない。[ai配布元](https://registry.npmjs.org/ai/7.0.118)、[OpenRouter配布元](https://registry.npmjs.org/@openrouter%2fai-sdk-provider/3.1.0)、[fal配布元](https://registry.npmjs.org/@ai-sdk%2ffal/3.0.50)。

RAGは [AI Search + R2](https://developers.cloudflare.com/ai-search/configuration/data-source/r2/)を任意拡張として採用合意済み。AI SearchはOpen Beta。[料金と制限](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)を踏まえ、実利用時の操作・費用は別途具体化する。検索→共通モデルへ文脈を渡す構成でモデル切替を維持する。新しい `ai_search` / `ai_search_namespaces` bindingと旧AutoRAG APIを混同しない。

Agentは明示したAI SDK tools、長時間処理は [Workflows](https://developers.cloudflare.com/workflows/get-started/durable-agents/)を用いる案。具体サンプル・受け入れ条件は [統合提案](../docs/architecture-proposal.md)に記載。ThinkのAPI留保は上記初期調査で確認済みであり、別ページで表記を見つけられないことをGAの根拠にしない。

未検証: 各providerのWorkersバンドル・実行、実モデル利用可否/単価、AI Search索引、LM Studio/fal実接続。認証等の比較は [別資料](frontend-auth-billing.md)に整理済み。
