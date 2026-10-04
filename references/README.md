# 公式情報の参照索引

- [M-5の固定install・ローカル隔離手順](m5-local-isolation-20261004.md): pnpm12.6.0/Wrangler4.141.0の実help、frozen-lockfileとVite/Wranglerの専用状態。実クラウド・実上流の証拠ではない。

- [M-5のCodexモデル・エフォート選定](m5-codex-model-selection-20261004.md): GPT-6.1 Sol/Highと別セッションを推奨する公式根拠・判断。M-5の実行やモデル設定変更は行わない。

- [M-4音声4件・入力token・WAV/MP3の公式確認](m4-media-audio-20261004.md): 固定4 schema、単一/2話者・MP3設定・明示長さ、保守的受付の根拠/留保と隔離preview。実上流/生成品質/費用の証拠ではない。

- [M-4のCodexモデル・エフォート選定](m4-codex-model-selection-20261004.md): GPT-6.1 Sol/Highと別セッションを推奨する公式根拠・判断。M-4の実行やモデル設定変更は行わない。

- [M-3通常動画・private stream・Rangeの公式確認](m3-media-video-20261004.md): 固定4 schema、現在のduration/入力、R2 stream/隔離とHTTP境界。実fal/上流保持の証拠ではない。

- [M-2素材・画像4件の公式確認](m2-media-images-20261004.md): 固定画像schema、private回収、R2/WASM/decoderと隔離previewの根拠。実接続の証拠ではない。
- [M-3のCodexモデル選定](m3-codex-model-selection-20261004.md): GPT-6.1 Sol/Highを推奨する公式根拠と判断。実装許可やモデル設定変更ではない。

確認日: 2026-09-27。公式の事実と、このプロジェクトでの採用判断を区別する。構成は合意済み。調査時点の候補版と、第1段階で実際に導入した版・実行結果を分ける。

| 資料 | 内容・状態 |
| --- | --- |
| [B-4の公開設定とbuild境界](preset-build-boundary-20261002.md) | 2026-10-02。固定版Vite plugin/Wranglerと公式情報を照合。公開5例・mode/env/解決後境界・flatten/previewの合成検証。実設定/実接続なし |
| [製品・最近の更新](platform-landscape.md) | 公式一覧、関連する新機能、採否の初期分類 |
| [Workers・テスト・MCP](workers-tooling.md) | 配布元バージョン、Vitest互換性、開発支援MCPの導入候補 |
| [AI・モデル接続](ai-models.md) | AI SDK、Agents、Thinkの提供状況、モデル切替の候補 |
| [フロントエンド・認証・決済](frontend-auth-billing.md) | SSR/SSG比較、Better Auth、D1/Drizzle、Polar互換性 |
| [費用・運用](costs-operations.md) | 公開料金、Node/pnpm/UI候補版、環境分離・CI・更新方針 |
| [GitHub Actions](github-actions.md) | pnpm ActionとUbuntu runnerの固定版、移行警告への対応 |
| [staging配備](staging-deployment.md) | 環境別build、Custom Domain、D1復旧、費用、GitHubのprivate repo保護条件 |
| [GitHubメール設定とPR参照](github-email-and-pr-safety.md) | 2026-09-28確認。Webメール非公開、CLI push防止、ローカル作者設定、GitHub仮マージの検査範囲 |
| [Workers AI最小検証](workers-ai-minimal-verification.md) | 2026-09-28再確認。既存モデルの廃止、候補の提供状況、無料枠なしの料金見積りと制約 |
| [undici限定更新](undici-security-20260929.md) | 2026-09-29。2つの依存元だけ7.29.1へoverrideした根拠・検証範囲・解除条件 |
| [TypeSafe AI Jev](typesafe-jev-20261002.md) | 2026-10-02。共通標準判断基盤。B-1固定版設定とB-3J固定fetch/3型service/API/0007を実装しworkerd/D1＋fakeで検証。SDK/依存追加・実接続なし |
| [B-3JのJev APIと実装根拠](jev-service-contract-20261002.md) | 2026-10-02。API/3型を実装時再照合。固定版/料金/Legal・Confidence/既知の限界・Telemetry/backup/自動補充の調査履歴を保持。独自枠/本文なし台帳/90日/unknown停止は採用どおりローカル実装。上流実保持/unknown修復・料金・権限/品質は工程E前の未確認 |
| [fal画像・動画・音声の複数モデル対応](fal-multimodel-feasibility-20261002.md) | 2026-10-02。対象12 endpointの公式仕様、参照画像アップロードを含む初版設計へのリンクとモデル選定前の概算。追加機能は未実装・実接続なし |
| [fal M-0の入力・保存・取得契約](fal-media-contract-20261002.md) | 2026-10-02。詳細schema、マスク、queue/retry、CDN ACL/期限、R2/Access/Rangeの根拠。アプリ側推奨値と未検証を区別 |
| [B-2のD1台帳存在検査](runtime-boundary-20261002.md) | 2026-10-02。firstのnull/例外の扱い、内容を読まない固定SQL、ローカル検証と別Worker/DB前提 |
| [B-3の実行入口とWorkflow再開](runtime-entry-guards-20261002.md) | 2026-10-02。durable stepの所有者/状態、保存stepの再確認、AI SDK各step hook。直接adapter/署名webhookを含むローカル342テスト・最終build HTTP smoke |

[構成と受け入れ条件](../docs/architecture-proposal.md)で統合する。第1段階の固定版・検証結果は [検証記録](../docs/phase1-verification.md)、正確な依存は `package.json` と `pnpm-lock.yaml` を参照。採用候補の実在、peer dependencies、実行結果は別々に記録し、ドキュメントの記載だけで互換性を確定しない。

## 第2段階の実装へ反映した確認

現在の固定版は`package.json`とlockfile、現在の実動結果は[第2段階の検証記録](../docs/phase2-verification.md)を正本にする。以下の機能別文書に、確認日・公式URL・制約・実装との対応を追記した。

| 分野 | 実装判断と根拠 |
| --- | --- |
| 認証 | [Better Auth / Access / Email Service](../docs/auth.md)。Email Service Public Betaを追加合意。localのメール本文ログを避け、送信adapterはfakeで検証 |
| モデル | [provider接続](../docs/providers.md)。現行SDKのV4契約を実workerdで検証。Googleの利用可能性を踏まえたモデル選択、OpenRouterとLM Studio、Gateway例 |
| 拡張 | [AI Search / R2 / Workflows / fal](../docs/extensions.md)。新instance binding、metadata分離、nativeローカルWorkflow、取消と不明結果の制約 |
| 決済 | [Polar](../docs/billing.md)。2026-09の署名方式変更、新旧検証、単一商品、解約・再契約、署名状態による会員サンプルの認可 |
| 更新 | [依存監査対応](../docs/operations.md#2026-09-27の依存監査対応)。未使用CLI経由の旧esbuildだけを修正版へ固定 |
| Claude Code | [公式memory/import](https://code.claude.com/docs/en/memory#import-additional-files)に従い、CLAUDE.mdから同ディレクトリのAGENTS.mdを相対import。ルール本文は複製しない |

CVA / clsx / tailwind-mergeは今回の共有UIでは必要がなく未導入。React専用AI hookも、FetchのSSE consumerで足りるため依存に残さない。SQL migrationは明示的に管理し、Drizzleのschema自動pushや独自CLIを追加しない。
