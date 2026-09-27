# 第1段階の検証記録

実施日: 2026-09-27。対象は開発基盤・最小画面・Worker API。認証・AI・DB・拡張の検証結果ではない。

## 固定した実行環境

- Node.js 26.10.0、pnpm 12.6.0。既存のグローバルNode 26.5.1 / pnpm 11.21.0は変更せず、一時ディレクトリの検証用toolchainを使った。プロジェクトファイルにはその絶対パスを埋め込んでいない。
- TanStack Start 1.168.58 / Router 1.170.39、React 19.3.0、Vite 8.3.1、Cloudflare Vite plugin 1.60.2、Wrangler 4.141.0。
- TypeScript 7.0.2、Biome 2.5.14、Vitest 4.1.11、Cloudflare Vitest plugin 1.2.8、Tailwind 4.3.3、Zod 4.6.5。
- workerd 1.20260925.1、compatibility_date `2026-09-25`、`nodejs_compat`。
- 直接依存はexact version、推移依存はpnpm lockfileで固定。strict peer解決。Vitest 5はCloudflare pluginのpeer範囲外のため見送り、対応後に再検討。
- SSR/事前生成はCloudflare公式Vite連携。RSCは有効化していない。TanStack内部依存にRSCパッケージが存在することと、アプリでその機能を使うことを区別する。

公式手順: [Cloudflare TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[TanStack最小構成](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch)、[Workers Vitest](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)。配布元は `https://registry.npmjs.org/` で直接確認した。

## 実行結果

| 項目 | 結果・範囲 |
| --- | --- |
| `pnpm install` | strict peerで成功、lockfile作成 |
| `pnpm install --frozen-lockfile` | 成功。package/lockfile一致 |
| `pnpm lint` | 成功。Biome推奨ルール・整形・import検査 |
| `pnpm typecheck` | 成功。binding型とroute型を生成後にTypeScript検査 |
| `pnpm test` | 実workerdで18件成功。APIモジュールが対象 |
| `pnpm build` | client/Worker両方成功。`/help`の1ページだけを事前生成、`/`はSSR |
| `pnpm dev` + `pnpm smoke 3000` | ローカル起動とHTTP正常/404/API/アセット配信を確認 |
| `pnpm preview` + `pnpm smoke` | ビルド済み成果物のworkerd配信で同じHTTP検証に成功 |
| ブラウザ | トップ画面を表示し、接続ボタンをEnterで操作→Worker正常応答の成功表示を確認 |
| staging/production build | 環境別Worker名、compatibility_date、公開無効の初期設定を生成結果で確認 |
| 両環境の `wrangler deploy --dry-run` | 生成済み設定を指定して成功。転送前のローカル検査のみ。配備していない |
| `pnpm audit` | 既知の脆弱性は報告なし（照会時点）。将来の安全性を保証するものではない |
| 分担レビュー | API振り分け、入力/本文サイズ制限、CI、秘密管理、ドキュメント区分を確認。重大な未解決指摘なし |

APIテストはhealth、HEAD、メソッド不一致、未知API、正しいJSON、不正JSON/型/長さ/余分なキー、非JSON、2KB超過、キャッシュ抑止を確認する。入力本文は返さず、保存もログ出力もしない。

HTTP smokeはSSR本文・meta、ヘルプ、未知ページの404、未知APIのJSON 404、health、正常POST、CSSと起動JSの配信形式を検証する。**ブラウザでのhydrationと操作は自動smokeの保証範囲外**で、上記の手動ブラウザ検証を別の証拠とする。

## 検証中に解消・切り分けた事項

- sandbox内ではローカルポートlistenがEPERMとなり、workerdテストと事前生成が失敗。許可されたローカル実行で再実行し成功した。
- Wranglerの標準ログ保存先がsandboxで書込不可。検証では `WRANGLER_LOG_PATH=.wrangler/logs` を使用。
- 自動の静的ルート検出ではトップも事前生成されたため、`autoStaticPathsDiscovery: false` と明示した`pages`でヘルプだけへ限定。
- Vite開発時のCSS HTTP検査はブラウザ同様の `Accept: text/css` を付けるよう修正。HTML fallbackを許容する変更ではない。
- ブラウザ操作ツールのクリック入力が単純なHTMLボタンでも反応しなかった。キーボード入力では動作し、アプリの接続表示も成功。一時診断ページは削除済み。
- Biomeの設定移行が `preset: none` を生成したため、最終設定を `preset: recommended` に修正して検査し直した。

## 残る警告・未検証事項

- route生成CLIで依存内の循環参照に関する `replaceRouteChunk` 警告が出る。生成・型検査・build・ブラウザ動作は成功。依存更新時に再確認し、警告を一律抑制していない。
- 環境別buildのprerender時、展開済み設定にstaging/production節がない旨の警告が出る。Worker名は意図した環境のもの、dry-runも成功。生成設定を手編集して警告を隠していない。
- クラウドへのアプリ配備・D1/R2/Workflows等の作成、実provider呼び出し、メール送信、Access/Better Auth実認証、Polar sandbox接続は未実施。課金処理なし。
- GitHub上のCIは未実行。設定を用意し、同等のチェックをローカルmacOSで実行した。Linux CI成功とは扱わない。
- 第3段階の機能実装後のクリーン複製・セットアップ検証は未実施。

## ユーザーの確認手順と停止

1. 起動中のローカルプレビュー `http://127.0.0.1:4173` を開く。停止している場合はREADMEの固定Node/pnpmで `pnpm build` → `pnpm preview`。
2. 接続確認ボタンで成功表示、ヘルプへの移動を確認する。
3. 必要に応じて `pnpm check` と、別ターミナルで `pnpm smoke`。
4. 環境を確認後、Codexで `/init 日本語で` を実行する。共通ルールの材料は [development-rules.md](development-rules.md)。
5. 第2段階の再開を明示する。その時点で生成された指示ファイルを読み直す。

第1段階完了後は元の指示に従ってGoalをpausedにする。Goal全体は未完了。AGENTS.md / CLAUDE.mdは先行生成しない。

（画面確認済み。画像は公開用履歴整理時に除外。）
