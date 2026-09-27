# フロントエンド・認証・データ・決済の比較

確認日: 2026-09-27。公式資料、公式リポジトリ、公開npmレジストリを確認。ユーザーとの構成合意を反映し、第1段階の構築を再開した。下記の比較調査は実動検証の代わりではなく、検証結果は別途記録する。

## フロントエンド

| 候補 | 公式の事実 | このプロジェクトでの判断案 |
| --- | --- | --- |
| React Router 8 Framework Mode | Workers / Vite公式連携あり。Cloudflare Vite plugin併用ではSPA modeとprerender非対応 | SSRで公開ページと認証後の画面を扱う案。公開ページの事前生成が必要なら制約になる |
| TanStack Start | WorkersでSSR・prerender対応。公式Overviewは調査時Release Candidate表記。RSCは別途Experimental | 採用合意済み。型付きルーティング・データ取得・サーバー関数の基本から始めて学習負荷を抑える。ExperimentalなRSCは導入しない |
| Next.js互換vinext | Cloudflare公式がWorkersでのNext.js実行方法として推奨。Vite上でNext.js APIを再実装。Beta。SSR/SSG/ISR/RSC対応、画像最適化は部分対応 | Next.jsのAPIやRSCを必要とするなら有力。完全互換とは扱わず使用機能の互換性を検証する |
| Astro | Cloudflare adapterでSSR、ページ別prerender対応。静的サイトはadapter不要 | 記事・ドキュメント中心なら有力。今回の対話的AIアプリ主体ではUI統合の設計が増えるため優先度を下げる判断 |
| SvelteKit | Cloudflare adapterあり。SvelteKitのページ設定でSSR/prerenderを選べる | 公開ページ・業務アプリ双方に使える。Svelteを選ぶ動機があるなら有力。ReactのUIをそのまま流用する構成ではない |
| React + Vite SPA | Workers APIとStatic Assetsを扱う公式手順あり | 公開ページのHTML生成を追加設計する必要があり、今回は第一候補にしない |

根拠: [Cloudflare React Router](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)、[React Router描画方式](https://reactrouter.com/start/framework/rendering)、[Cloudflare TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[TanStack Start提供状況](https://tanstack.com/start/latest/docs/framework/react/overview)、[React SPA公式例](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)。

SSGとSSRを混同しない。React Router自体がprerender対応でも、採用するCloudflare連携で動くという意味ではない。SSRのHTML応答・hydration・非公開ページのキャッシュ抑止を第1段階以降の実テストで確認する。

追加根拠: [TanStack prerender対応の公式発表](https://developers.cloudflare.com/changelog/post/2025-12-19-tanstack-start-prerendering/)、[Cloudflare Next.js / vinext](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)、[Cloudflare Astro](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)、[Cloudflare SvelteKit](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/)、[SvelteKit page options](https://svelte.dev/docs/kit/page-options)。公式ガイドと機能追加は投資の判断材料だが、将来の継続サポート保証とは扱わない。

Next.jsを選ぶ固有要件はまだない。[Cloudflare OpenNextガイド](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)は新規向けにvinextを案内しているため、過去のOpenNext推奨をそのまま流用しない。vinextの推奨は「Next.jsをWorkersで動かす方法」の範囲であり、Cloudflareが全用途で他のフレームワークより優先すると読み替えない。

公開ページはSSRだけでなく、ビルド時にHTMLを作るSSG/prerenderでも提供できる。更新頻度と公開/非公開の境界で描画方式を選ぶ。prerender時に非公開データや秘密を成果物へ焼き込まない。長時間処理の信頼性は主にWorkers/Workflows側の設計によるため、Cだけを理由にフロントエンドを選ばない。

## Better Auth / D1 / Drizzle

**公式の事実**:

- [Better Auth 1.5](https://better-auth.com/blog/1-5)でD1 binding直接接続を公式対応。D1の対話的transactionと通常SQL DBのtransactionを同一視しない。
- [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)を使用可能。[Database](https://better-auth.com/docs/concepts/database)のschema生成とmigrationの役割を区別する。adapterのruntime schema検査だけでは実DBへのmigration適用を証明しない。
- [メール・パスワード認証](https://better-auth.com/docs/authentication/email-password)は内蔵。メール確認・再設定の送信処理は別途必要。[ソーシャルログイン](https://better-auth.com/docs/basic-usage)は各providerのアプリ登録・callback・認証情報が必要。
- [セキュリティ](https://better-auth.com/docs/reference/security)、[Rate Limit](https://better-auth.com/docs/concepts/rate-limit): CSRF保護・trusted origins・Cookie設定・共有可能な制限保存先を考慮する。auth.apiの直接呼び出しへHTTP向け制限が自動適用されるとは限らない。

**判断案**: Better Auth + D1 + Drizzle。認証と履歴、拡張の所有権・ジョブ・契約情報を同じschema/migration方針にまとめる。D1直接接続＋SQLは依存を抑える代替だが、今回の機能数では型付きschemaを選ぶ価値がある。

ユーザーIDはセッションから導出し、会話一覧・読取・追加・削除の全経路で所有権を確認する。会話履歴はD1を第一候補とする。ストリーム再開やWebSocket永続状態が必須になった場合にAgents + AIChatAgent + DOを再評価する。

公開サービス向けにBetter Authを採用し、メール＋パスワードを標準、Googleログインを設定で追加可能にすることを合意済み。ローカル/CIは外部送信しないfakeを使い、確認URL・tokenをログに出さない。本番のメール送信providerを確定し、未設定なのに確認・再設定が成功したように扱わない。Googleは設定済みの場合だけ有効化し、標準起動にOAuth設定を要求しない。

## Cloudflare Accessの選択構成

社内・個人向けの複製ではCloudflare Accessを選べる構成を採用する。公開サービス向けBetter Authと利用者識別の入口を分けても、アプリ内の所有権・契約権限の確認は共通で必須とする。任意の利用者ヘッダーを信用せず、認証済みの主体だけをアプリ内IDへ対応付ける。

[Workers Access公式](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)はWorker全体とhostname/path単位の保護を区別している。公開トップ/ヘルプやPolar webhookを対話ログインで遮断しない範囲を選び、別の到達URLで認証を迂回できないことも確認する。webhookは対話ログインの対象外でもraw body署名検証を必須にする。[One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)は許可されたメールアドレスへCloudflareがコードを送るため、Accessのログイン自体にはアプリ用メール送信providerを要求しない。

第2段階の注意点: Worker直接呼び出しで利用できる `ctx.access` は、Static Assetsの内部routerやService Bindingを越えて伝播しない。公式はCloudflare Vite pluginがassetsを追加するTanStack Startも影響を受けると明記している。したがって本構成の利用者識別を `ctx.access` だけに依存させず、公式の署名付き認証情報の検証経路を実装前に確定し、未認証・偽造・期限切れ・audience不一致を検証する。Worker単位のAccessはWebSocket非対応のため、将来WebSocketを追加する場合はhostnameベースの方式を再検討する。ローカルの認証模擬を実Accessログイン成功と扱わない。

## Polarの任意拡張

**公式の事実**:

- [Sandbox](https://polar.sh/docs/integrate/sandbox)は本番とアカウント・organization・tokenを分離する。
- [Webhook delivery](https://polar.sh/docs/integrate/webhooks/delivery): raw bodyを署名検証して処理する。2026-09-08以降生成のsecretと、それ以前のsecretで署名キーの扱いが異なる。公式はSDK 1.0.0-alpha.19以降の両方式対応を案内する。
- [Customer State](https://polar.sh/docs/integrate/customer-state)を契約状態・権限同期に使用できる。

**採用範囲**: Polarのサブスクリプション拡張を合意済み。Checkout・Portal・契約状態・署名検証・永続的な重複排除を1拡張にする。通常の認証をPolar依存にせず、user.idとexternal_idで関連付ける。新規secretの署名方式をStandard Webhooksの公式実装で検証する案を含め、安定版SDKと整合する経路を実装前に確定する。独自暗号処理は作らない。

配布元のlatest値: `@polar-sh/sdk` 0.49.0、`@polar-sh/better-auth` 1.8.4。後者はSDK `^0.47.0`を要求するため0.49.0との組み合わせはpeer範囲外。専用Better Authプラグインは必須にせず、公式SDKを独立した決済モジュールから利用する案。alpha SDKを無断で採用しない。

検証ゲート: 正常/不正/期限切れ署名、重複・並行再送・順序逆転、処理失敗後の再送、sandboxでの契約変更反映。イベント受理を永続化する前に成功応答しない。イベントID一意制約と状態同期方針を設計し、古いイベントが後着して権限を巻き戻さないことをテストする。

## 配布元で確認した候補版

| パッケージ | 候補版 | 留保 |
| --- | --- | --- |
| react-router / @react-router/dev | 8.4.0 | Node >=22.22、Vite 7/8、TS 5/6/7 |
| react / react-dom | 19.3.0 | RRのpeer要件を満たす |
| better-auth | 1.7.6 | React 18/19、Drizzle 0.45.2系等 |
| drizzle-orm | 0.45.3 | latestは安定配布版。1.x RCを選ぶ必要なし |
| drizzle-kit | 0.31.11 | SQL生成と適用を別途検証 |
| @polar-sh/sdk | 0.49.0 | 新旧署名の取り扱いは第2段階の実装ゲート |

配布元: [RR dev](https://registry.npmjs.org/@react-router%2fdev/8.4.0)、[React](https://registry.npmjs.org/react/19.3.0)、[Better Auth](https://registry.npmjs.org/better-auth/1.7.6)、[Drizzle ORM](https://registry.npmjs.org/drizzle-orm/0.45.3)、[Drizzle Kit](https://registry.npmjs.org/drizzle-kit/0.31.11)、[Polar SDK](https://registry.npmjs.org/@polar-sh%2fsdk/0.49.0)、[Polar Better Auth plugin](https://registry.npmjs.org/@polar-sh%2fbetter-auth/1.8.4)。
