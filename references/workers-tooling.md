> 公開用の履歴整理により、実環境の識別子・個別URL・個人のパスはダミーへ置換しています。記載されたダミーは接続先・照合値として使えません。

# Workers・テスト・開発支援MCP: 事前調査

確認日: 2026-09-27。公式資料・公開npmレジストリの直接取得に基づく。下記は調査時点の記録。第1段階ではVite/Cloudflare/Vitest等の候補版を実際に固定・検証した。結果は [検証記録](../docs/archive/phase1-verification.md)。

## 公式の事実

- [Vite plugin GA告知](https://developers.cloudflare.com/changelog/post/2025-04-08-vite-plugin/)は2025-04-08。[現行ガイド](https://developers.cloudflare.com/workers/vite-plugin/)は2026-07-03更新。開発・previewでWorkers runtimeを利用する。
- [Static Assets](https://developers.cloudflare.com/workers/static-assets/): Workerと静的ファイルを一体で扱える。SPAのfallbackとAPI経路を区別する設定が必要。
- [Vitest plugin v1告知](https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/): 2026-08-19に旧 `@cloudflare/vitest-pool-workers` から `@cloudflare/vitest-plugin` へ改称。
- [現行テストガイド](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/): 2026-08-20更新。Vitest 4.1以上の案内。ただし配布パッケージのpeer上限も確認が必要。
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/): MiniflareによるローカルWorkers runtimeテスト、bindingsアクセス、テストファイルごとのストレージ分離。
- [既知制約](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/): V8 coverage非対応、DO WebSocketの分離制約、fake timersが一部ストレージの時刻へ影響しない点など。採用するテストに関係する制約を再確認する。

## 配布元の確認値

以下は確認時点のlatestタグ。製品の安定性や全依存の安全性を保証するものではない。

| パッケージ・配布元 | latest | 互換条件・候補 |
| --- | --- | --- |
| [vite](https://registry.npmjs.org/vite) | 8.3.1 | Node `^20.19.0 || >=22.12.0` |
| [Cloudflare Vite plugin](https://registry.npmjs.org/@cloudflare%2fvite-plugin) | 1.60.2 | Vite `^6.1.0 || ^7.0.0 || ^8.0.0`、Wrangler `^4.141.0` |
| [wrangler](https://registry.npmjs.org/wrangler) | 4.141.0 | Node >=22 |
| [vitest](https://registry.npmjs.org/vitest) | 5.0.2 | Cloudflare pluginのpeer範囲外。4系の候補は4.1.11 |
| [Cloudflare Vitest plugin](https://registry.npmjs.org/@cloudflare%2fvitest-plugin) | 1.2.8 | vitest / runner / snapshot が `^4.1.0` |
| [typescript](https://registry.npmjs.org/typescript) | 7.0.2 | 周辺ライブラリとの実動互換性は未検証 |
| [Biome](https://registry.npmjs.org/@biomejs%2fbiome) | 2.5.14 | 第1段階で採用。推奨ルール・整形・import検査が成功 |

**採用結果**: Vite 8.3.1 / Cloudflare Vite plugin 1.60.2 / Wrangler 4.141.0 / Vitest 4.1.11 / Cloudflare Vitest plugin 1.2.8を固定。Vitest 5.0.2を見送る具体的根拠はpeer範囲外であること。再検討条件はCloudflare pluginのVitest 5対応。

Node 26.10.0 / pnpm 12.6.0でstrict peer解決、Workersテスト、buildを確認。workerd 1.20260925.1に合わせcompatibility_dateは2026-09-25。確認した第1段階の機能を越えた互換性を保証しない。

## Cloudflare MCP

- [公式MCP案内](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/): 2026-07-28更新。新規接続はStreamable HTTPの `/mcp` を利用。
- Documentation MCP: `https://docs.mcp.cloudflare.com/mcp`。[公式README](https://github.com/cloudflare/mcp-server-cloudflare/tree/main/apps/docs-ai-search)で認証不要を確認。
- アカウントAPI MCP: `https://mcp.cloudflare.com/mcp`。OAuth同意時に権限を選択。bindings / builds / observabilityなどの個別サーバーもある。

**導入結果（2026-09-27）**: Claude Code の Cloudflare プラグインと同じ API / Docs / Bindings / Builds / Observability の5サーバーを Codex ユーザー設定に登録。Docs は公開 MCP 応答とツール一覧を確認し、新規 Codex プロセスから文書検索を実行した。API は `staging.example.invalid` のみを読み取り専用で認可し、新規 Codex プロセスから API 定義検索を実行した。Bindings / Builds / Observability も同アカウントで OAuth ログイン済み。Bindings の要求権限には Workers Write と D1 Write、Builds には Workers Read と Workers Builds Read、Observability には Workers Read と Workers Observability Read が含まれる。作るアプリが MCP client になる設定とは別。

上記の導入結果は別セッションの作業記録。ユーザーの再起動後、この会話でも5サーバーのツール反映と以下の読み取り疎通を確認した。接続設定の再登録は行っていない。Cloudflare Skills plugin一式の導入は別判断とする。

| サーバー | この会話での検証 | 結果 |
| --- | --- | --- |
| Docs | Workers Static Assetsの文書検索 | 公式URLと本文を取得 |
| API | Worker一覧のAPI定義検索、続いてGET実行 | HTTP 200、success=true |
| Bindings | workers_list | 一覧取得成功 |
| Builds | workers_list | 一覧取得成功 |
| Observability | workers_list | 一覧取得成功 |

確認日は2026-09-27。アカウント系4経路でWorker件数27が一致した。疎通確認に必要な一覧のみ取得し、Workerソース・環境変数・Secrets・ビルドログ・アプリログは取得していない。リソースの作成・変更・削除も実施していない。Builds固有のビルド取得、Observability固有のログ/メトリクス検索、書き込み操作の動作はこの確認の対象外。プロジェクトのGoalはpausedを維持した。
